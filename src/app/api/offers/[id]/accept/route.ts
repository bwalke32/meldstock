// @polsia:user-owned — /api/offers/[id]/accept — accept a PENDING offer.
//
// The plan's authorisation rule: the caller MUST be the COUNTERPART of
// the row's author (initial-buyer offer ⇒ seller accepts; seller counter
// ⇒ buyer accepts). Same-party self-accept is rejected — the author who
// wants to "accept their own offer" doesn't make contact semantics.
//
// On success, ONE Prisma transaction stamps:
//   * `Offer.status = ACCEPTED` + `acceptedAt`
//   * `MessageThread.dealStatus = 'ACCEPTED'` + `dealStatusUpdatedAt` +
//     `dealStatusAdvancedBy = caller.id`
// so the existing deal-stepper (already rendered on the lot detail page
// when a participant thread exists) ticks forward to ACCEPTED without
// any new UI from this feature.
import 'server-only';
import { NextResponse } from 'next/server';
import { assertOfferParty } from '@/lib/business/offer-visibility';
import { createOfferWireFromRow } from '@/lib/business/offer-wire';
import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/email/send';
import { offerAcceptedEmail } from '@/lib/email/templates';
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
  const limit = checkLimit('userMutation', rateBucketFor(req, user.id, `offer:${offerId}:accept`));
  if (!limit.allowed) {
    await recordAudit({
      userId: user.id,
      actor: user.role === 'admin' ? 'ADMIN' : 'USER',
      action: 'RATE_LIMITED',
      resourceType: 'Offer',
      resourceId: offerId,
      metadata: { route: '/api/offers/[id]/accept:POST' },
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
        parentOfferId: true,
      },
    });
    const gate = assertOfferParty(current, user.id);
    if (gate) return gate;
    if (!current) return NextResponse.json({ error: 'Not Found' }, { status: 404 });

    if (current.status !== 'PENDING') {
      return NextResponse.json({ error: 'Only pending offers can be accepted.' }, { status: 409 });
    }

    const authorIsBuyer = current.parentOfferId === null;
    const isBuyer = current.buyerId === user.id;
    const isSeller = current.sellerId === user.id;
    const counterpartIsCaller = (authorIsBuyer && isSeller) || (!authorIsBuyer && isBuyer);
    if (!counterpartIsCaller) {
      return NextResponse.json(
        { error: 'You cannot accept your own offer; withdraw instead.' },
        { status: 403 },
      );
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const accepted = await tx.offer.update({
        where: { id: current.id },
        data: { status: 'ACCEPTED', acceptedAt: now },
      });
      await tx.messageThread.update({
        where: { id: current.threadId },
        data: {
          dealStatus: 'ACCEPTED',
          dealStatusUpdatedAt: now,
          dealStatusAdvancedBy: user.id,
        },
      });
      return accepted;
    });

    await recordAudit({
      userId: user.id,
      actor: 'USER',
      action: 'OFFER_ACCEPTED',
      resourceType: 'Offer',
      resourceId: updated.id,
      metadata: { threadId: current.threadId, lotId: current.lotId },
      ip,
    });

    // The advance of `MessageThread.dealStatus → ACCEPTED` is the
    // signal the lot detail's <DealStepper/> re-hydrates via its
    // existing /api/lots/[id]/deal-status re-fetch path. The client's
    // lot detail island listens for `deal-status:invalidate` and refires
    // the GET — that closes the loop without any new live-event primitive.

    const wire = await createOfferWireFromRow(updated, user.id);

    void emailAccepted(updated.id, user.id).catch(() => undefined);

    return NextResponse.json(wire);
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

async function emailAccepted(offerId: string, whoAcceptedId: string): Promise<void> {
  const acceptedRow = await prisma.offer.findUnique({ where: { id: offerId } });
  if (!acceptedRow) return;
  const [buyerAuth, sellerAuth, lotRow, accepterProfile] = await Promise.all([
    prisma.user.findUnique({
      where: { id: acceptedRow.buyerId },
      select: { email: true, name: true },
    }),
    prisma.user.findUnique({
      where: { id: acceptedRow.sellerId },
      select: { email: true, name: true },
    }),
    prisma.lot.findUnique({
      where: { id: acceptedRow.lotId },
      select: { id: true, polymer: true, condition: true, form: true },
    }),
    prisma.profile.findUnique({
      where: { userId: whoAcceptedId },
      select: { displayName: true },
    }),
  ]);
  if (!buyerAuth || !sellerAuth || !lotRow) return;

  const lotTitle = `${lotRow.polymer} · ${lotRow.condition} · ${lotRow.form}`;
  const unitLabel = acceptedRow.priceUnit === 'PER_LB' ? '/ lb' : '/ kg';
  const priceLabel = `$${acceptedRow.pricePerUnit.toString()}${unitLabel}`;
  const quantityLabel = `${acceptedRow.quantityLb.toString()} lb`;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') ?? '';
  const threadUrl = `${baseUrl}/messages/${encodeURIComponent(acceptedRow.threadId)}`;

  await Promise.allSettled(
    [buyerAuth, sellerAuth].map(async (recipient) => {
      try {
        await sendEmail({
          to: recipient.email,
          ...offerAcceptedEmail({
            recipientName: recipient.name,
            lotTitle,
            acceptedByDisplayName: accepterProfile?.displayName ?? 'Meldstock trader',
            finalPriceLabel: priceLabel,
            quantityLabel,
            threadUrl,
          }),
        });
      } catch {
        // best-effort
      }
    }),
  );
}
