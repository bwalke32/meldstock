// @polsia:user-owned — /api/threads/[threadId]/status endpoint.
//
// PATCH: flip the thread's `status` column on a listing/RFQ thread. Either
// side of the conversation can mark it COMPLETED (closing the deal —
// unlocks the 5-dimension rating form on the partner) or CANCELED
// (aborts without rating). Rules:
//   - requireAuth, and the caller MUST be a participant (uses the same
//     `isThreadParticipant` belt the detail/messages routes use);
//   - thread.kind MUST be LISTING or RFQ — broker-group rooms have no
//     buyer/seller pair, so a 422 on the flip is the honest answer
//     (last-line defense: the form doesn't render the pill for rooms);
//   - ONLY allow PENDING → COMPLETED or PENDING → CANCELED. The state is
//     one-way: a COMPLETED row cannot be back-flipped to PENDING/CANCELED
//     (409), nor CAN a CANCELED row be flipped. This is what makes
//     /api/ratings trust the status it reads.
//
// On success: 200 with the new threadStatus + completedAt so the caller
// can update local state without re-hitting the detail endpoint.
//
// Audit (G5): every successful transition stamps `DEAL_COMPLETED` or
// `DEAL_CANCELED` so a senior reviewer can later answer "who closed
// which deal when". Rate-limit applies per-user.
import 'server-only';
import { NextResponse } from 'next/server';
import { isThreadParticipant } from '@/lib/business/thread-participants';
import {
  UpdateTransactionStatus,
  type UpdateTransactionStatusInput,
} from '@/lib/contracts/ratings';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { extractIp, recordAudit } from '@/lib/security/audit';
import { checkLimit, extractIp as headerIp, rateBucketFor } from '@/lib/security/rate-limit';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, ctx: { params: Promise<{ threadId: string }> }) {
  let user: SessionUser;
  try {
    user = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  let threadId: string;
  try {
    const params = await ctx.params;
    threadId = params.threadId;
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  const ip = extractIp(req) ?? headerIp(req);

  const limit = checkLimit(
    'userMutation',
    rateBucketFor(req, user.id, `thread:${threadId}:status`),
  );
  if (!limit.allowed) {
    await recordAudit({
      userId: user.id,
      actor: user.role === 'admin' ? 'ADMIN' : 'USER',
      action: 'RATE_LIMITED',
      resourceType: 'Thread',
      resourceId: threadId,
      metadata: { route: '/api/threads/[threadId]/status:PATCH' },
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

  let body: UpdateTransactionStatusInput;
  try {
    const parsed = UpdateTransactionStatus.safeParse(await req.json());
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
    const thread = await prisma.messageThread.findUnique({
      where: { id: threadId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        createdAt: true,
        kind: true,
        status: true,
      },
    });
    if (!thread) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }
    const participant = await isThreadParticipant(thread, user.id);
    if (!participant) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (thread.kind === 'BROKER_GROUP') {
      return NextResponse.json(
        { error: 'Broker-group rooms cannot be marked completed or canceled.' },
        { status: 422 },
      );
    }
    if (user.id !== thread.buyerId && user.id !== thread.sellerId) {
      return NextResponse.json(
        { error: 'Only the buyer or seller can close this deal.' },
        { status: 403 },
      );
    }
    if (thread.status !== 'PENDING') {
      return NextResponse.json(
        { error: 'Deal state is already final — status cannot change.' },
        { status: 409 },
      );
    }

    const completedAt = body.status === 'COMPLETED' ? new Date() : null;
    const updated = await prisma.messageThread.update({
      where: { id: threadId },
      data: { status: body.status, completedAt },
      select: { id: true, status: true, completedAt: true },
    });

    const auditAction = body.status === 'COMPLETED' ? 'DEAL_COMPLETED' : 'DEAL_CANCELED';
    await recordAudit({
      userId: user.id,
      actor: user.role === 'admin' ? 'ADMIN' : 'USER',
      action: auditAction,
      resourceType: 'Thread',
      resourceId: threadId,
      metadata: { from: 'PENDING', to: body.status },
      ip,
    });

    return NextResponse.json({
      threadId: updated.id,
      threadStatus: updated.status,
      completedAt: updated.completedAt?.toISOString() ?? null,
    });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
