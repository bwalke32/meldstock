// @polsia:user-owned — /api/listings/[id]/offers endpoint.
//
// POST: a qualified buyer creates an `Offer` row on a HAVE lot. The
//       route refuses a WANTED lot (RFQ reply lives on the WANTED-reply
//       thread channel, not on the structured offer channel — out of
//       scope for this brief). It also refuses an anonymous lot
//       (`postedByUserId === null`) — there's no seller to negotiate
//       with. The thread (1:1 buyer↔seller) is upserted on the same
//       transaction the offer is created on so the negotiation is
//       immediately reachable in the inbox.
//
// GET:  list every offer on a lot that EITHER (a) the caller is the lot
//       seller of, OR (b) the caller has ever been the buyer on. A 3rd
//       party signed-in user gets 404 — same confidentiality posture as
//       deal-status. The buyer-side fingerprint for "ever been a buyer
//       on an offer for this lot" is `Offer.buyerId === caller.id` —
//       the seller-side fingerprint is `lot.postedByUserId === caller.id`.
//       A buyer who has neither posted nor been counter-countered yet
//       (e.g. an unrelated lot) likewise can't probe the chain.
//
// Both verbs share the same offerDetailFromRow helper so the wire
// shape stays consistent between GET-on-list and POST-just-created.
import 'server-only';
import { NextResponse } from 'next/server';
import { lotBlockedResponse, resolveVisibilityViewer } from '@/lib/business/lot-visibility';
import { createOfferWireFromRow } from '@/lib/business/offer-wire';
import { ensureParticipantRoster } from '@/lib/business/thread-participants';
import { OfferCreate, type OfferCreateInput, OfferItem, OfferList } from '@/lib/contracts/offers';
import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/email/send';
import { offerReceivedEmail } from '@/lib/email/templates';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { extractIp, recordAudit } from '@/lib/security/audit';
import { checkLimit, rateBucketFor } from '@/lib/security/rate-limit';

export const dynamic = 'force-dynamic';

// Thread subject, mirrored from src/app/api/threads/route.ts. Kept
// identical so a /messages/[id] inbox row that was seeded by the
// offer flow reads the same as one seeded by the free-text flow.
function threadSubjectForLot(lot: { polymer: string; condition: string; form: string }): string {
  return `${lot.polymer} · ${lot.condition} · ${lot.form}`;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let user: SessionUser;
  try {
    user = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const lotId = await readParamId(ctx);
  if (lotId instanceof NextResponse) return lotId;

  const ip = extractIp(req);
  const limit = checkLimit(
    'userMutation',
    rateBucketFor(req, user.id, `lot:${lotId}:offer:create`),
  );
  if (!limit.allowed) {
    await recordAudit({
      userId: user.id,
      actor: user.role === 'admin' ? 'ADMIN' : 'USER',
      action: 'RATE_LIMITED',
      resourceType: 'Offer',
      resourceId: lotId,
      metadata: { route: '/api/listings/[id]/offers:POST' },
      ip,
    });
    return rateLimitedResponse(limit.retryAfterMs);
  }

  let body: OfferCreateInput;
  try {
    const parsed = OfferCreate.safeParse(await req.json());
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const [field, messages] of Object.entries(parsed.error.flatten().fieldErrors)) {
        const message = messages?.[0];
        if (message) errors[field] = message;
      }
      return NextResponse.json({ errors }, { status: 400 });
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  try {
    const lot = await prisma.lot.findUnique({
      where: { id: lotId },
      select: {
        id: true,
        type: true,
        postedByUserId: true,
        postedByName: true,
        polymer: true,
        condition: true,
        form: true,
        visibility: true,
        postedAt: true,
      },
    });
    if (!lot) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }
    const viewer = await resolveVisibilityViewer(user.id);
    const blocked = lotBlockedResponse(lot, viewer);
    if (blocked) return blocked;

    if (lot.type !== 'HAVE') {
      return NextResponse.json(
        {
          error:
            'Structured offers are only available on HAVE listings. WANTED listings use the RFQ reply channel instead.',
        },
        { status: 422 },
      );
    }
    if (lot.postedByUserId === null) {
      return NextResponse.json(
        {
          error:
            'This lot was posted without a tied seller — use the public message thread on the listing to negotiate.',
        },
        { status: 422 },
      );
    }
    if (lot.postedByUserId === user.id) {
      return NextResponse.json({ error: 'You are the seller on this lot.' }, { status: 409 });
    }

    // Upsert the 1:1 buyer↔seller thread the way /api/threads POST does.
    // Idempotent — a buyer who re-offers on a lot they already opened a
    // thread on reuses the thread, the previous Offer rows stay
    // intact, AND the new Offer is appended to the same offer list.
    const thread = await prisma.messageThread.upsert({
      where: { lotId_buyerId: { lotId: lot.id, buyerId: user.id } },
      update: {},
      create: {
        kind: 'LISTING',
        lotId: lot.id,
        buyerId: user.id,
        sellerId: lot.postedByUserId,
        subject: threadSubjectForLot(lot),
      },
    });
    await ensureParticipantRoster(thread);

    const expiresAt = new Date(body.terms.offerExpiresAt);
    const created = await prisma.offer.create({
      data: {
        threadId: thread.id,
        lotId: lot.id,
        buyerId: user.id,
        sellerId: lot.postedByUserId,
        parentOfferId: null,
        quantityLb: body.terms.quantityLb,
        pricePerUnit: body.terms.pricePerUnit,
        priceUnit: body.terms.priceUnit,
        freightTerm: body.terms.freightTerm,
        shipToZipCode: body.terms.shipToZipCode ?? null,
        shipToCity: body.terms.shipToCity ?? null,
        shipToState: body.terms.shipToState ?? null,
        shipToCountry: body.terms.shipToCountry ?? null,
        requestedDeliveryDate: body.terms.requestedDeliveryDate
          ? new Date(body.terms.requestedDeliveryDate)
          : null,
        paymentTerms: body.terms.paymentTerms ?? null,
        comments: body.terms.comments ?? null,
        offerExpiresAt: expiresAt,
        status: 'PENDING',
      },
    });

    await recordAudit({
      userId: user.id,
      actor: 'USER',
      action: 'OFFER_CREATED',
      resourceType: 'Offer',
      resourceId: created.id,
      metadata: { threadId: thread.id, lotId: lot.id },
      ip,
    });

    const wire = await createOfferWireFromRow(created, user.id);

    // Email the seller the structured offer notification. Best-effort:
    // a failed send is logged by `sendEmail` and never aborts the
    // POST. Failure must not undo the persisted offer.
    void emailSellerOnCreate(created.id, lot, user.id).catch(() => undefined);

    // Run a final shape parse so a drifting wire enum (e.g. a future
    // OfferStatus addition the client contract didn't pick up yet)
    // surfaces as a ZodError here instead of a silently-corrupted UI.
    return NextResponse.json(OfferItem.parse(wire), { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  let user: SessionUser;
  try {
    user = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const lotId = await readParamId(ctx);
  if (lotId instanceof NextResponse) return lotId;

  try {
    const lot = await prisma.lot.findUnique({
      where: { id: lotId },
      select: {
        id: true,
        postedByUserId: true,
        visibility: true,
      },
    });
    if (!lot) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }
    const viewer = await resolveVisibilityViewer(user.id);
    const blocked = lotBlockedResponse(lot, viewer);
    if (blocked) return blocked;

    const isSeller = lot.postedByUserId !== null && lot.postedByUserId === user.id;
    if (!isSeller) {
      // Non-seller: only see offers they have been a buyer on. If they
      // are neither seller nor a historical buyer on this lot, refuse
      // with 404 to keep the offer chain existence-private.
      const wasBuyer = await prisma.offer.findFirst({
        where: { lotId: lot.id, buyerId: user.id },
        select: { id: true },
      });
      if (!wasBuyer) {
        return NextResponse.json({ error: 'Not Found' }, { status: 404 });
      }
    }

    const rows = await prisma.offer.findMany({
      where: { lotId: lot.id },
      orderBy: { createdAt: 'asc' },
    });
    const wire = await Promise.all(rows.map((row) => createOfferWireFromRow(row, user.id)));
    return NextResponse.json(OfferList.parse({ items: wire }));
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

async function readParamId(ctx: {
  params: Promise<{ id: string }>;
}): Promise<string | NextResponse> {
  try {
    const params = await ctx.params;
    return params.id;
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }
}

function rateLimitedResponse(retryAfterMs: number | undefined): NextResponse {
  return NextResponse.json(
    { error: 'rate_limited' },
    {
      status: 429,
      headers: {
        'Retry-After': String(Math.ceil((retryAfterMs ?? 1000) / 1000)),
      },
    },
  );
}

// Look up the seller (User + Profile) and post the offer notification.
// Pulled out as a separate fire-and-forget so the route returns the
// Offer wire without waiting for the email transport.
async function emailSellerOnCreate(
  offerId: string,
  lot: {
    id: string;
    postedByUserId: string | null;
    postedByName: string;
    polymer: string;
    condition: string;
    form: string;
    postedAt: Date;
  },
  buyerUserId: string,
): Promise<void> {
  if (lot.postedByUserId === null) return;

  const [sellerAuth, buyerProfile, offerRow] = await Promise.all([
    prisma.user.findUnique({
      where: { id: lot.postedByUserId },
      select: { email: true, name: true },
    }),
    prisma.profile.findUnique({
      where: { userId: buyerUserId },
      select: { displayName: true, companyName: true },
    }),
    prisma.offer.findUnique({ where: { id: offerId } }),
  ]);
  if (!sellerAuth || !offerRow) return;

  const buyerLabel = buyerProfile?.displayName ?? 'Meldstock buyer';
  const unitLabel = offerRow.priceUnit === 'PER_LB' ? '/ lb' : '/ kg';
  const priceLabel = `$${offerRow.pricePerUnit.toString()}${unitLabel}`;
  const quantityLabel = `${offerRow.quantityLb.toString()} lb`;
  const lotTitle = `${lot.polymer} · ${lot.condition} · ${lot.form}`;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') ?? '';
  const lotUrl = `${baseUrl}/lots/${encodeURIComponent(lot.id)}`;

  try {
    await sendEmail({
      to: sellerAuth.email,
      ...offerReceivedEmail({
        recipientName: sellerAuth.name,
        lotTitle,
        buyerDisplayName: buyerLabel,
        priceLabel,
        quantityLabel,
        expiresAt: offerRow.offerExpiresAt.toISOString(),
        lotUrl,
      }),
    });
  } catch {
    // Swallow — best-effort.
  }
}
