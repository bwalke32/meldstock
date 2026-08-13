// @polsia:user-owned — /api/responses/[id]/withdraw — author WITHDRAW
// endpoint on the WANTED side. Mirror of `/api/offers/[id]/withdraw`.
//
// Auth: caller MUST be the AUTHOR. Author = seller (respondent) for
// root rows (parentResponseId === null); author = buyer (RFQ poster)
// for counter rows — alternating by induction since counter is
// buyer-only here. The counterpart can't withdraw — that's decline.
import 'server-only';
import { NextResponse } from 'next/server';
import { assertWantedResponseParty } from '@/lib/business/wanted-response-visibility';
import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/email/send';
import { wantedResponseWithdrawnEmail } from '@/lib/email/templates';
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
    rateBucketFor(req, user.id, `response:${responseId}:withdraw`),
  );
  if (!limit.allowed) {
    await recordAudit({
      userId: user.id,
      actor: user.role === 'admin' ? 'ADMIN' : 'USER',
      action: 'RATE_LIMITED',
      resourceType: 'WantedResponse',
      resourceId: responseId,
      metadata: { route: '/api/responses/[id]/withdraw:POST' },
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
        parentResponseId: true,
      },
    });
    const gate = assertWantedResponseParty(current, user.id);
    if (gate) return gate;
    if (!current) return NextResponse.json({ error: 'Not Found' }, { status: 404 });

    if (current.status !== 'PENDING') {
      return NextResponse.json(
        { error: 'Only pending responses can be withdrawn.' },
        { status: 409 },
      );
    }
    // Author parity: rows alternate seller (root) → buyer (counter).
    const authorIsSeller = current.parentResponseId === null;
    const authorIsBuyer = !authorIsSeller;
    const authorIsCaller =
      (authorIsSeller && current.sellerId === user.id) ||
      (authorIsBuyer && current.buyerId === user.id);
    if (!authorIsCaller) {
      return NextResponse.json(
        { error: 'You can only withdraw a response you created.' },
        { status: 403 },
      );
    }

    const now = new Date();
    await prisma.wantedResponse.update({
      where: { id: current.id },
      data: { status: 'WITHDRAWN', withdrawnAt: now },
    });

    await recordAudit({
      userId: user.id,
      actor: 'USER',
      action: 'WANTED_RESPONSE_WITHDRAWN',
      resourceType: 'WantedResponse',
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

async function emailWithdrawn(responseId: string, whoWithdrew: string): Promise<void> {
  const current = await prisma.wantedResponse.findUnique({ where: { id: responseId } });
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
      ...wantedResponseWithdrawnEmail({
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
