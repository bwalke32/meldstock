// @polsia:user-owned — /api/lots/[id]/messages thread endpoint.
// GET returns the 50 most-recent messages (oldest first so the thread reads
// chronologically). POST persists a new message and returns it.
//
// Visibility gate: a viewer MUST be allowed to read the source lot before
// the thread is exposed — otherwise the messages URL would let a curious
// non-member confirm a private row's existence by hitting the URL.
//
// Rate-limit (G4, G9): POST is anonymous-heavy (a viewer may submit a
// message WITHOUT a session) so we cap per-IP-per-lot at 5/minute. The
// audit row stamps `LOT_MESSAGE_POSTED` so a curious senior reviewer
// can later count brute-force attempts. GET is in the lot messaging
// preset (60/min/userId-or-IP) — symmetric with the dashboard reads.
import 'server-only';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { lotBlockedResponse, resolveVisibilityViewer } from '@/lib/business/lot-visibility';
import {
  CreateLotMessage,
  LotMessageList,
  LotMessage as LotMessageSchema,
} from '@/lib/contracts/lots';
import { prisma } from '@/lib/db';
import { extractIp, recordAudit } from '@/lib/security/audit';
import { checkLimit, extractIp as headerIp, rateBucketFor } from '@/lib/security/rate-limit';

export const dynamic = 'force-dynamic';

async function gateLot(id: string): Promise<NextResponse | null> {
  // Shared gate reused by both verbs on this endpoint — returns null when
  // visible, a 404 response when blocked.
  const session = await auth.api.getSession({ headers: await headers() });
  const lot = await prisma.lot.findUnique({
    where: { id },
    select: {
      id: true,
      visibility: true,
      postedByUserId: true,
      selectedCompanyIdentifiers: true,
    },
  });
  if (!lot) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }
  const viewer = await resolveVisibilityViewer(session?.user?.id ?? null);
  return lotBlockedResponse(lot, viewer);
}

async function applyRateLimit(
  req: Request,
  lotId: string,
  userId: string | null,
): Promise<NextResponse | null> {
  const ip = extractIp(req) ?? headerIp(req);
  const limit = checkLimit('lotMessagesPost', rateBucketFor(req, userId, `lot:${lotId}:message`));
  if (limit.allowed) return null;
  await recordAudit({
    userId,
    action: 'RATE_LIMITED',
    resourceType: 'Lot',
    resourceId: lotId,
    metadata: { route: '/api/lots/[id]/messages:POST' },
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

async function applyReadRateLimit(
  req: Request,
  lotId: string,
  userId: string | null,
): Promise<NextResponse | null> {
  const limit = checkLimit('listRead', rateBucketFor(req, userId, `lot:${lotId}:messages-read`));
  if (limit.allowed) return null;
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

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const blocked = await gateLot(id);
    if (blocked) return blocked;
    const session = await auth.api.getSession({ headers: await headers() });
    const readLimited = await applyReadRateLimit(_req, id, session?.user?.id ?? null);
    if (readLimited) return readLimited;

    const rows = await prisma.lotMessage.findMany({
      where: { lotId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json(
      LotMessageList.parse({
        items: rows
          .slice()
          .reverse()
          .map((m) => ({
            id: m.id,
            lotId: m.lotId,
            senderName: m.senderName,
            body: m.body,
            createdAt: m.createdAt.toISOString(),
          })),
      }),
    );
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const blocked = await gateLot(id);
    if (blocked) return blocked;
    const session = await auth.api.getSession({ headers: await headers() });
    // An anonymous sender on an ANONYMOUS-visibility lot is intentional;
    // they may not have a session. We let the rate-limit bucket by IP so
    // a brute-force flood is still capped.
    const rateLimited = await applyRateLimit(req, id, session?.user?.id ?? null);
    if (rateLimited) return rateLimited;

    const raw = await req.json().catch(() => ({}));
    // The form sends the lotId separately; the URL is the truth. Inject it
    // before parse so a race in the client cannot target the wrong lot.
    const merged = { ...(raw as Record<string, unknown>), lotId: id };
    const parsed = CreateLotMessage.safeParse(merged);
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      const errors: Record<string, string> = {};
      for (const [field, messages] of Object.entries(fieldErrors)) {
        const message = messages?.[0];
        if (message) {
          errors[field] = message;
        }
      }
      return NextResponse.json({ errors }, { status: 400 });
    }

    const created = await prisma.lotMessage.create({
      data: {
        lotId: id,
        senderName: parsed.data.senderName,
        body: parsed.data.body,
      },
    });

    await recordAudit({
      userId: session?.user?.id ?? null,
      action: 'LOT_MESSAGE_POSTED',
      resourceType: 'Lot',
      resourceId: id,
      metadata: { messageId: created.id, lotId: id },
      ip: extractIp(req) ?? headerIp(req),
    });

    return NextResponse.json(
      LotMessageSchema.parse({
        id: created.id,
        lotId: created.lotId,
        senderName: created.senderName,
        body: created.body,
        createdAt: created.createdAt.toISOString(),
      }),
      { status: 201 },
    );
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
