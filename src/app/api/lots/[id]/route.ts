// @polsia:user-owned — /api/lots/[id] detail endpoint. Single round-trip
// returns the lot + its recent message thread so the detail page can boot
// with one fetch. The lot row is enriched with `postedByHandle` so the page
// can link to /u/[handle] for the seller profile when one exists.
//
// Visibility enforcement (see prisma/schema/lots.prisma#LotVisibility and
// @/lib/business/lot-visibility):
//   - PUBLIC / ANONYMOUS: anyone can read; ANONYMOUS scrubs the seller.
//   - VERIFIED_COMPANIES_ONLY: viewer must be VERIFIED — otherwise 404.
//   - MY_NETWORK: viewer must be paired with the poster — otherwise 404.
//   - SELECTED_COMPANIES: viewer must be in `selectedCompanyIdentifiers` —
//     otherwise 404.
// Existence is never hinted; the resolver is shared so every API route
// gates consistently.
//
// PATCH (added): broker-controlled visibility change on a lot the caller
// owns (or the platform admin). The brief is server-side confidentiality
// with broker controls; this is the corresponding sole recovery path if
// the poster mistakenly posted a sensitive lot as PUBLIC. Each successful
// change stamps an audit row carrying the from/to visibility tier.
import 'server-only';
import { Prisma } from '@prisma/client';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { touchLotBump } from '@/lib/business/lot-lifecycle';
import {
  ANONYMOUS_SCRUB,
  lotBlockedResponse,
  resolveVisibilityViewer,
} from '@/lib/business/lot-visibility';
import { type LotRow, lotRowToWire } from '@/lib/business/profiles';
import { documentDownloadUrl } from '@/lib/contracts/documents';
import { DocumentList, LotDetailResponse, LotVisibilityEnum } from '@/lib/contracts/lots';
import { prisma } from '@/lib/db';
import { extractIp, recordAudit } from '@/lib/security/audit';
import { checkLimit, extractIp as headerIp, rateBucketFor } from '@/lib/security/rate-limit';

export const dynamic = 'force-dynamic';

function asStringArray(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === 'string') {
    try {
      const parsed: unknown = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x));
    } catch {
      // ignore — return []
    }
  }
  return [];
}

function normaliseIdentifiers(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of raw) {
    const t = e.trim().toLowerCase();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const [session, lot] = await Promise.all([
      auth.api.getSession({ headers: await headers() }),
      prisma.lot.findUnique({ where: { id } }),
    ]);
    if (!lot) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }
    const viewerUserId = session?.user?.id ?? null;
    const viewer = await resolveVisibilityViewer(viewerUserId);
    const blocked = lotBlockedResponse(lot, viewer);
    if (blocked) return blocked;

    const isAnonymous = lot.visibility === 'ANONYMOUS';
    const [messages, profile, documents] = await Promise.all([
      prisma.lotMessage.findMany({
        where: { lotId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      lot.postedByUserId && !isAnonymous
        ? prisma.profile.findUnique({
            where: { userId: lot.postedByUserId },
            select: { handle: true, verificationStatus: true, role: true },
          })
        : Promise.resolve(null),
      prisma.document.findMany({
        where: { lotId: id },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const thread = messages
      .slice()
      .reverse()
      .map((m) => ({
        id: m.id,
        lotId: m.lotId,
        senderName: m.senderName,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
      }));
    const scrubbed = isAnonymous
      ? { ...lot, ...ANONYMOUS_SCRUB, profile: null }
      : { ...lot, profile };
    // Documents — opaque relative URL (replaced from the raw R2 CDN URL
    // in the G1 hardening pass). The download proxy re-checks the lot
    // viewer gate so the URL can't be probed by an unauthorised caller.
    const documentItems = documents.map((d) => ({
      id: d.id,
      lotId: d.lotId,
      type: d.type,
      filename: d.filename,
      url: documentDownloadUrl(d.lotId, d.id),
      mimeType: d.mimeType,
      createdAt: d.createdAt.toISOString(),
    }));
    return NextResponse.json(
      LotDetailResponse.parse({
        lot: lotRowToWire(scrubbed as unknown as LotRow),
        messages: thread,
        documents: DocumentList.parse({ items: documentItems }),
      }),
    );
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

const PatchLot = z.object({
  visibility: LotVisibilityEnum.optional(),
  // When `selectedCompanyIdentifiers` is provided, the value REPLACES the
  // existing list. Empty array clears the list. Other visibility tiers
  // persist the column as `null` so lookups stay cheap.
  selectedCompanyIdentifiers: z.array(z.string().min(1).max(120)).max(50).optional(),
  // Inventory-lifecycle patch fields (added with the lifecycle brief).
  // Either can be set in isolation, or alongside a visibility change —
  // owner confidentiality must not be the only knob the PATCH knows about.
  quantityRemaining: z
    .number()
    .min(0, 'Quantity remaining cannot be negative')
    .optional()
    .nullable(),
  // `refresh: true` is the PATCH shortcut for POST /api/lots/[id]/refresh
  // — same backend stamp + the same `lastNudgedAt` clear.
  refresh: z.boolean().optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;

    const session = await auth.api.getSession({ headers: await headers() });
    const userId = session?.user?.id ?? null;
    const userRole = (session?.user as { role?: string } | undefined)?.role;
    const ip = extractIp(req) ?? headerIp(req);

    // Per-user rate-limit on broker mutations. The recorder also stamps
    // `RATE_LIMITED` audit rows so spikes are observable.
    const limitBucket = rateBucketFor(req, userId, `lot:${id}:patch`);
    const limit = checkLimit('userMutation', limitBucket);
    if (!limit.allowed) {
      await recordAudit({
        userId,
        actor: userRole === 'admin' ? 'ADMIN' : 'USER',
        action: 'RATE_LIMITED',
        resourceType: 'Lot',
        resourceId: id,
        metadata: { route: '/api/lots/[id]:PATCH', reason: 'rate_limit' },
        ip,
      });
      return NextResponse.json(
        { error: 'rate_limited' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil((limit.retryAfterMs ?? 1000) / 1000)),
          },
        },
      );
    }

    const parsed = PatchLot.safeParse(await req.json());
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const [field, messages] of Object.entries(parsed.error.flatten().fieldErrors)) {
        const message = messages?.[0];
        if (message) errors[field] = message;
      }
      return NextResponse.json({ errors }, { status: 400 });
    }

    const lot = await prisma.lot.findUnique({
      where: { id },
      select: {
        id: true,
        postedByUserId: true,
        visibility: true,
        selectedCompanyIdentifiers: true,
        quantityLb: true,
        status: true,
      },
    });
    if (!lot) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }
    const isOwner = userId !== null && lot.postedByUserId === userId;
    const isAdmin = userRole === 'admin';
    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (
      parsed.data.visibility === undefined &&
      parsed.data.selectedCompanyIdentifiers === undefined &&
      parsed.data.quantityRemaining === undefined &&
      !parsed.data.refresh
    ) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    // Inventory-lifecycle: clamp `quantityRemaining` against `quantityLb`
    // so a 5kg request can never publish more than the lot's total weight.
    // Decimal prisma columns accept a JS number; coerce on the boundary.
    let quantityRemainingValue: number | undefined;
    if (parsed.data.quantityRemaining !== undefined && parsed.data.quantityRemaining !== null) {
      const totalLb = Number.parseFloat(lot.quantityLb.toString());
      quantityRemainingValue = Math.min(parsed.data.quantityRemaining, totalLb);
    }

    const nextVisibility = parsed.data.visibility ?? lot.visibility;
    // Compute the persisted identifier-list shape once and let Prisma
    // see the right tagged value: a JSON array of strings when the
    // visibility tier requires it, or an explicit DB-null sentinel
    // (`Prisma.JsonNull`) when the tier is no longer SELECTED_COMPANIES
    // AND we received an update body that includes the identifiers.
    let identifiersValue: Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined;
    if (parsed.data.selectedCompanyIdentifiers !== undefined) {
      if (nextVisibility === 'SELECTED_COMPANIES') {
        identifiersValue = normaliseIdentifiers(parsed.data.selectedCompanyIdentifiers);
      } else {
        identifiersValue = Prisma.JsonNull;
      }
    }

    // Lifecycle side-effects — the PATCH is the only place a single
    // request can touch visibility + qty.remaining + refresh.
    const wantsRefresh = parsed.data.refresh === true;
    const bumpsTimestamp = quantityRemainingValue !== undefined || wantsRefresh;

    const updated = await prisma.lot.update({
      where: { id },
      data: {
        ...(parsed.data.visibility ? { visibility: parsed.data.visibility } : {}),
        ...(identifiersValue !== undefined ? { selectedCompanyIdentifiers: identifiersValue } : {}),
        ...(quantityRemainingValue !== undefined
          ? { quantityRemaining: quantityRemainingValue }
          : {}),
        ...(bumpsTimestamp ? touchLotBump() : {}),
        ...(wantsRefresh ? { lastNudgedAt: null } : {}),
      },
    });

    const fromVis = lot.visibility;
    const toVis = parsed.data.visibility;
    const identifierCount = Array.isArray(identifiersValue) ? identifiersValue.length : 0;
    if (toVis && toVis !== fromVis) {
      await recordAudit({
        userId,
        actor: isAdmin ? 'ADMIN' : 'USER',
        action: 'LOT_VISIBILITY_CHANGED',
        resourceType: 'Lot',
        resourceId: id,
        metadata: {
          from: fromVis,
          to: toVis,
          identifierCount,
        },
        ip,
      });
    } else if (parsed.data.selectedCompanyIdentifiers !== undefined) {
      await recordAudit({
        userId,
        actor: isAdmin ? 'ADMIN' : 'USER',
        action: 'LOT_VISIBILITY_CHANGED',
        resourceType: 'Lot',
        resourceId: id,
        metadata: {
          identifiersOnly: true,
          identifierCount,
          visibility: nextVisibility,
        },
        ip,
      });
    }
    if (wantsRefresh) {
      await recordAudit({
        userId,
        actor: isAdmin ? 'ADMIN' : 'USER',
        action: 'LOT_REFRESHED',
        resourceType: 'Lot',
        resourceId: id,
        metadata: { via: 'PATCH' },
        ip,
      });
    }

    return NextResponse.json({
      id: updated.id,
      visibility: updated.visibility,
      selectedCompanyIdentifiers: asStringArray(updated.selectedCompanyIdentifiers),
      quantityRemaining: updated.quantityRemaining?.toString() ?? '0',
      status: updated.status,
      lastUpdatedAt: updated.lastUpdatedAt.toISOString(),
    });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
