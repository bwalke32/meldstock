// @polsia:user-owned — /api/offers/[id]/counter — seller COUNTER endpoint.
//
// The plan constrains COUNTER to seller-only: a buyer who wants to
// reframe an offer submits a fresh `Offer` row (parentOfferId === null)
// on the same thread instead of "countering" the seller row. This keeps
// the chain semantics unambiguous: every counter ROW is seller-authored,
// so the chain alternates Buyer → Seller → Buyer-submitted-as-new-...
// and any node's authorship can be derived from ancestor parity alone.
//
// On a valid POST:
//   1. The current row transitions to COUNTERED (its `counteredAt`
//      timestamp stamped once);
//   2. A NEW `Offer` row is created with parentOfferId = current row,
//      `status = 'PENDING'`, and the seller-supplied terms;
//   3. Both the buyer AND seller receive an `offerCounteredEmail` (so
//      the buyer sees the seller's terms without opening the lot page).
//
// All counter-side state lives in one Prisma transaction so a concurrent
// action on the same offer can't slip a partial write.
import 'server-only';
import { NextResponse } from 'next/server';
import { assertOfferParty } from '@/lib/business/offer-visibility';
import { createOfferWireFromRow } from '@/lib/business/offer-wire';
import { OfferCounter, type OfferCounterInput } from '@/lib/contracts/offers';
import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/email/send';
import { offerCounteredEmail } from '@/lib/email/templates';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { extractIp, recordAudit } from '@/lib/security/audit';
import { checkLimit, rateBucketFor } from '@/lib/security/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let user: SessionUser;
  try {
    user = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  let offerId: string;
  try {
    const params = await ctx.params;
    offerId = params.id;
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  const ip = extractIp(req);
  const limit = checkLimit('userMutation', rateBucketFor(req, user.id, `offer:${offerId}:counter`));
  if (!limit.allowed) {
    await recordAudit({
      userId: user.id,
      actor: user.role === 'admin' ? 'ADMIN' : 'USER',
      action: 'RATE_LIMITED',
      resourceType: 'Offer',
      resourceId: offerId,
      metadata: { route: '/api/offers/[id]/counter:POST' },
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

  let body: OfferCounterInput;
  try {
    const parsed = OfferCounter.safeParse(await req.json());
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
    const current = await prisma.offer.findUnique({
      where: { id: offerId },
      select: {
        id: true,
        threadId: true,
        lotId: true,
        buyerId: true,
        sellerId: true,
        status: true,
      },
    });
    const gate = assertOfferParty(current, user.id);
    if (gate) return gate;
    if (!current) return NextResponse.json({ error: 'Not Found' }, { status: 404 });

    if (user.id !== current.sellerId) {
      return NextResponse.json(
        { error: 'Only the seller can counter this offer.' },
        { status: 403 },
      );
    }
    if (current.status !== 'PENDING') {
      return NextResponse.json({ error: 'Only pending offers can be countered.' }, { status: 409 });
    }

    const now = new Date();
    const counter = await prisma.$transaction(async (tx) => {
      await tx.offer.update({
        where: { id: current.id },
        data: { status: 'COUNTERED', counteredAt: now },
      });
      return await tx.offer.create({
        data: {
          threadId: current.threadId,
          lotId: current.lotId,
          buyerId: current.buyerId,
          sellerId: current.sellerId,
          parentOfferId: current.id,
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
          offerExpiresAt: new Date(body.terms.offerExpiresAt),
          status: 'PENDING',
        },
      });
    });

    await recordAudit({
      userId: user.id,
      actor: 'USER',
      action: 'OFFER_COUNTERED',
      resourceType: 'Offer',
      resourceId: counter.id,
      metadata: { threadId: current.threadId, lotId: current.lotId, parentOfferId: current.id },
      ip,
    });

    const wire = await createOfferWireFromRow(counter, user.id);

    void emailCountered(counter.id, user.id).catch(() => undefined);

    return NextResponse.json(wire, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// Notify BOTH parties when a counter is stamped. The plan mandates
// "Email both parties" — the seller-side mail confirms their own
// action persisted, the buyer-side mail tells them the new terms.
async function emailCountered(counterOfferId: string, whoCountered: string): Promise<void> {
  const counterRow = await prisma.offer.findUnique({ where: { id: counterOfferId } });
  if (!counterRow) return;
  const [buyerAuth, sellerAuth, lotRow, whoCounteredProfile] = await Promise.all([
    prisma.user.findUnique({
      where: { id: counterRow.buyerId },
      select: { email: true, name: true },
    }),
    prisma.user.findUnique({
      where: { id: counterRow.sellerId },
      select: { email: true, name: true },
    }),
    prisma.lot.findUnique({
      where: { id: counterRow.lotId },
      select: { id: true, polymer: true, condition: true, form: true },
    }),
    prisma.profile.findUnique({
      where: { userId: whoCountered },
      select: { displayName: true },
    }),
  ]);
  if (!buyerAuth || !sellerAuth || !lotRow) return;

  const lotTitle = `${lotRow.polymer} · ${lotRow.condition} · ${lotRow.form}`;
  const byDisplayName = whoCounteredProfile?.displayName ?? 'Meldstock trader';
  const unitLabel = counterRow.priceUnit === 'PER_LB' ? '/ lb' : '/ kg';
  const priceLabel = `$${counterRow.pricePerUnit.toString()}${unitLabel}`;
  const quantityLabel = `${counterRow.quantityLb.toString()} lb`;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') ?? '';
  const lotUrl = `${baseUrl}/lots/${encodeURIComponent(lotRow.id)}`;

  await Promise.allSettled(
    [buyerAuth, sellerAuth].map(async (recipient) => {
      try {
        await sendEmail({
          to: recipient.email,
          ...offerCounteredEmail({
            recipientName: recipient.name,
            lotTitle,
            byDisplayName,
            priceLabel,
            quantityLabel,
            expiresAt: counterRow.offerExpiresAt.toISOString(),
            lotUrl,
          }),
        });
      } catch {
        // best-effort
      }
    }),
  );
}
