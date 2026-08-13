// @polsia:user-owned — /api/responses/[id]/decline — buyer DECLINE endpoint
// on the WANTED side. Mirror of `/api/offers/[id]/decline`.
//
// Auth: caller MUST be the BUYER (= RFQ poster) on a PENDING row. Self-
// decline of one's own response is rejected — the author side either
// withdraws (their own row) or lets the row expire.
import 'server-only';
import { NextResponse } from 'next/server';
import { assertWantedResponseParty } from '@/lib/business/wanted-response-visibility';
import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/email/send';
import { wantedResponseDeclinedEmail } from '@/lib/email/templates';
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
    rateBucketFor(req, user.id, `response:${responseId}:decline`),
  );
  if (!limit.allowed) {
    await recordAudit({
      userId: user.id,
      actor: user.role === 'admin' ? 'ADMIN' : 'USER',
      action: 'RATE_LIMITED',
      resourceType: 'WantedResponse',
      resourceId: responseId,
      metadata: { route: '/api/responses/[id]/decline:POST' },
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
        { error: 'Only pending responses can be declined.' },
        { status: 409 },
      );
    }
    if (current.buyerId !== user.id) {
      return NextResponse.json(
        { error: 'Only the buyer (the RFQ poster) can decline this response.' },
        { status: 403 },
      );
    }

    const now = new Date();
    await prisma.wantedResponse.update({
      where: { id: current.id },
      data: { status: 'DECLINED', declinedAt: now },
    });

    await recordAudit({
      userId: user.id,
      actor: 'USER',
      action: 'WANTED_RESPONSE_DECLINED',
      resourceType: 'WantedResponse',
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

async function emailDeclined(responseId: string, whoDeclined: string): Promise<void> {
  const current = await prisma.wantedResponse.findUnique({ where: { id: responseId } });
  if (!current) return;
  // AUTHOR = seller (= respondent) for root rows
  // (parentResponseId === null), else buyer (= RFQ poster) for counter
  // rows. We notify the author — the counterpart is whoDeclined.
  const authorId = current.parentResponseId === null ? current.sellerId : current.buyerId;
  if (authorId === whoDeclined) return;
  const [authorAuth, lotRow, decedentProfile] = await Promise.all([
    prisma.user.findUnique({
      where: { id: authorId },
      select: { email: true, name: true },
    }),
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
  const byDisplayName = decedentProfile?.displayName ?? 'Meldstock buyer';

  try {
    await sendEmail({
      to: authorAuth.email,
      ...wantedResponseDeclinedEmail({
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
