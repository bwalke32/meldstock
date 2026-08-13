// @polsia:user-owned — /api/offers/[id]/withdraw — withdraw a PENDING offer.
//
// Auth: caller MUST be the AUTHOR (parent row's authorship predicate).
// The counterpart can't withdraw — that's `decline`. Status flips to
// WITHDRAWN + `withdrawnAt`; the counterpart receives an `offerWithdrawnEmail`.
import 'server-only';
import { NextResponse } from 'next/server';
import { assertOfferParty } from '@/lib/business/offer-visibility';
import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/email/send';
import { offerWithdrawnEmail } from '@/lib/email/templates';
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
  const limit = checkLimit(
    'userMutation',
    rateBucketFor(req, user.id, `offer:${offerId}:withdraw`),
  );
  if (!limit.allowed) {
    await recordAudit({
      userId: user.id,
      actor: user.role === 'admin' ? 'ADMIN' : 'USER',
      action: 'RATE_LIMITED',
      resourceType: 'Offer',
      resourceId: offerId,
      metadata: { route: '/api/offers/[id]/withdraw:POST' },
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
      return NextResponse.json({ error: 'Only pending offers can be withdrawn.' }, { status: 409 });
    }
    const authorIsBuyer = current.parentOfferId === null;
    const isBuyer = current.buyerId === user.id;
    const isSeller = current.sellerId === user.id;
    const authorIsCaller = (authorIsBuyer && isBuyer) || (!authorIsBuyer && isSeller);
    if (!authorIsCaller) {
      return NextResponse.json(
        { error: 'You can only withdraw an offer you created.' },
        { status: 403 },
      );
    }

    const now = new Date();
    await prisma.offer.update({
      where: { id: current.id },
      data: { status: 'WITHDRAWN', withdrawnAt: now },
    });

    await recordAudit({
      userId: user.id,
      actor: 'USER',
      action: 'OFFER_WITHDRAWN',
      resourceType: 'Offer',
      resourceId: current.id,
      metadata: { threadId: current.threadId, lotId: current.lotId },
      ip,
    });

    void emailWithdrawn(current.id, user.id).catch(() => undefined);

    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

async function emailWithdrawn(offerId: string, whoWithdrew: string): Promise<void> {
  const current = await prisma.offer.findUnique({ where: { id: offerId } });
  if (!current) return;
  const counterpartId = current.buyerId === whoWithdrew ? current.sellerId : current.buyerId;
  const [counterpartAuth, lotRow, withdrawerProfile] = await Promise.all([
    prisma.user.findUnique({
      where: { id: counterpartId },
      select: { email: true, name: true },
    }),
    prisma.lot.findUnique({
      where: { id: current.lotId },
      select: { id: true, polymer: true, condition: true, form: true },
    }),
    prisma.profile.findUnique({
      where: { userId: whoWithdrew },
      select: { displayName: true },
    }),
  ]);
  if (!counterpartAuth || !lotRow) return;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') ?? '';
  const lotUrl = `${baseUrl}/lots/${encodeURIComponent(lotRow.id)}`;
  const lotTitle = `${lotRow.polymer} · ${lotRow.condition} · ${lotRow.form}`;
  const byDisplayName = withdrawerProfile?.displayName ?? 'Meldstock trader';

  try {
    await sendEmail({
      to: counterpartAuth.email,
      ...offerWithdrawnEmail({
        recipientName: counterpartAuth.name,
        lotTitle,
        byDisplayName,
        lotUrl,
      }),
    });
  } catch {
    // best-effort
  }
}
