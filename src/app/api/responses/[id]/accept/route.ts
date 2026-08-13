// @polsia:user-owned — /api/responses/[id]/accept — buyer ACCEPT endpoint
// on the WANTED side. Mirror of `/api/offers/[id]/accept`.
//
// The BUYER (= RFQ poster) accepts the seller's structured response.
// The plan's authorisation rule: caller MUST be `buyerId` (the RFQ
// poster — same rule as on the Offer side but with the role identity
// flipped). Same-party self-accept is rejected because the author who
// wants to "accept their own response" doesn't make contact semantics.
//
// On success, ONE Prisma transaction stamps:
//   * `WantedResponse.status = ACCEPTED` + `acceptedAt`
//   * `MessageThread.dealStatus = 'ACCEPTED'` + `dealStatusUpdatedAt`
//     + `dealStatusAdvancedBy = caller.id`
// so the existing deal-stepper (already rendered on the lot detail page
// when a participant thread exists) ticks forward to ACCEPTED without
// any new UI from this feature — and the existing MarkCompletedButton /
// RatingSection pipeline takes over from there once the seller flips
// the closeout.
import 'server-only';
import { NextResponse } from 'next/server';
import { assertWantedResponseParty } from '@/lib/business/wanted-response-visibility';
import { createWantedResponseWireFromRow } from '@/lib/business/wanted-response-wire';
import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/email/send';
import { wantedResponseAcceptedEmail } from '@/lib/email/templates';
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

  let responseId: string;
  try {
    const params = await ctx.params;
    responseId = params.id;
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  const ip = extractIp(req);
  const limit = checkLimit(
    'userMutation',
    rateBucketFor(req, user.id, `response:${responseId}:accept`),
  );
  if (!limit.allowed) {
    await recordAudit({
      userId: user.id,
      actor: user.role === 'admin' ? 'ADMIN' : 'USER',
      action: 'RATE_LIMITED',
      resourceType: 'WantedResponse',
      resourceId: responseId,
      metadata: { route: '/api/responses/[id]/accept:POST' },
      ip,
    });
    return NextResponse.json(
      { error: 'rate_limited' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((limit.retryAfterMs ?? 1000) / 1000)) },
      },
    );
  }

  try {
    const current = await prisma.wantedResponse.findUnique({
      where: { id: responseId },
      select: {
        id: true,
        threadId: true,
        lotId: true,
        buyerId: true,
        sellerId: true,
        status: true,
      },
    });
    const gate = assertWantedResponseParty(current, user.id);
    if (gate) return gate;
    if (!current) return NextResponse.json({ error: 'Not Found' }, { status: 404 });

    if (current.status !== 'PENDING') {
      return NextResponse.json(
        { error: 'Only pending responses can be accepted.' },
        { status: 409 },
      );
    }
    // On the WANTED side accept is BUYER-only (the buyer is the
    // RFQ poster; they accept the seller's response). The seller
    // authorised themselves by initiating the response; they cannot
    // accept their own submission.
    if (current.buyerId !== user.id) {
      return NextResponse.json(
        { error: 'Only the buyer (the RFQ poster) can accept this response.' },
        { status: 403 },
      );
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const accepted = await tx.wantedResponse.update({
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
      action: 'WANTED_RESPONSE_ACCEPTED',
      resourceType: 'WantedResponse',
      resourceId: updated.id,
      metadata: { threadId: current.threadId, lotId: current.lotId },
      ip,
    });

    const wire = await createWantedResponseWireFromRow(updated, user.id);

    void emailAccepted(updated.id, user.id).catch(() => undefined);

    return NextResponse.json(wire);
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

async function emailAccepted(responseId: string, whoAcceptedId: string): Promise<void> {
  const acceptedRow = await prisma.wantedResponse.findUnique({
    where: { id: responseId },
  });
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
          ...wantedResponseAcceptedEmail({
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
