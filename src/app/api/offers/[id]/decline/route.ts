// @polsia:user-owned — /api/offers/[id]/decline — decline a PENDING offer.
//
// Auth: caller MUST be the COUNTERPART of the row's author (initial buyer
// offer ⇒ seller declines; seller counter ⇒ buyer declines). Same-party
// self-decline is rejected because the offering party either withdraws
// (USe their own row) or lets their offer expire (the next sweep).
//
// On success: status flips to DECLINED + `declinedAt` is stamped; the
// offering party receives an `offerDeclinedEmail` so they can decide
// whether to re-offer.
import 'server-only';
import { NextResponse } from 'next/server';
import { assertOfferParty } from '@/lib/business/offer-visibility';
import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/email/send';
import { offerDeclinedEmail } from '@/lib/email/templates';
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
  const limit = checkLimit('userMutation', rateBucketFor(req, user.id, `offer:${offerId}:decline`));
  if (!limit.allowed) {
    await recordAudit({
      userId: user.id,
      actor: user.role === 'admin' ? 'ADMIN' : 'USER',
      action: 'RATE_LIMITED',
      resourceType: 'Offer',
      resourceId: offerId,
      metadata: { route: '/api/offers/[id]/decline:POST' },
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
      return NextResponse.json({ error: 'Only pending offers can be declined.' }, { status: 409 });
    }
    const authorIsBuyer = current.parentOfferId === null;
    const isBuyer = current.buyerId === user.id;
    const isSeller = current.sellerId === user.id;
    const counterpartIsCaller = (authorIsBuyer && isSeller) || (!authorIsBuyer && isBuyer);
    if (!counterpartIsCaller) {
      return NextResponse.json(
        { error: 'You cannot decline your own offer; withdraw instead.' },
        { status: 403 },
      );
    }

    const now = new Date();
    await prisma.offer.update({
      where: { id: current.id },
      data: { status: 'DECLINED', declinedAt: now },
    });

    await recordAudit({
      userId: user.id,
      actor: 'USER',
      action: 'OFFER_DECLINED',
      resourceType: 'Offer',
      resourceId: current.id,
      metadata: { threadId: current.threadId, lotId: current.lotId },
      ip,
    });

    void emailDeclined(current.id, user.id).catch(() => undefined);

    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

async function emailDeclined(offerId: string, whoDeclined: string): Promise<void> {
  const current = await prisma.offer.findUnique({ where: { id: offerId } });
  if (!current) return;
  // Offerer (the AUTHOR) gets the decline alert — the counterpart is
  // whoDeclined.
  const authorId = current.parentOfferId === null ? current.buyerId : current.sellerId;
  if (authorId === whoDeclined) return;
  const [authorAuth, lotRow, decedentProfile] = await Promise.all([
    prisma.user.findUnique({ where: { id: authorId }, select: { email: true, name: true } }),
    prisma.lot.findUnique({
      where: { id: current.lotId },
      select: { id: true, polymer: true, condition: true, form: true },
    }),
    prisma.profile.findUnique({
      where: { userId: whoDeclined },
      select: { displayName: true },
    }),
  ]);
  if (!authorAuth || !lotRow) return;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') ?? '';
  const lotUrl = `${baseUrl}/lots/${encodeURIComponent(lotRow.id)}`;
  const lotTitle = `${lotRow.polymer} · ${lotRow.condition} · ${lotRow.form}`;
  const byDisplayName = decedentProfile?.displayName ?? 'Meldstock trader';

  try {
    await sendEmail({
      to: authorAuth.email,
      ...offerDeclinedEmail({
        recipientName: authorAuth.name,
        lotTitle,
        byDisplayName,
        lotUrl,
      }),
    });
  } catch {
    // best-effort
  }
}
