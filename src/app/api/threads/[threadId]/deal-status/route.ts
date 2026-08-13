// @polsia:user-owned — /api/threads/[threadId]/deal-status endpoint.
//
// Front-of-the-pipeline deal stepper — `OFFER → ACCEPTED → PO_ISSUED →
// PICKUP_SCHEDULED → IN_TRANSIT → DELIVERED → COMPLETED`. Persisted on
// `MessageThread.dealStatus` (see prisma/schema/messaging.prisma#DealStatus
// for the rationale on why this is a separate column from the existing
// closeout `status`).
//
// GET:  stepper state for the thread. Any thread participant may read it
//       (the same `isThreadParticipant` gate the detail endpoint uses).
//       Broker-group rooms — no buyer/seller pair — return 422:
//
//       matches the existing closeout pill's behaviour, so the UI's
//       `isRoom === 'BROKER_GROUP'` branch keeps semantics consistent
//       with the closeout sibling. Seller (or admin) gets `canAdvance:
//       true`; everyone else gets `false`.
//
// PATCH: monotonic stepper advance. Caller must be a participant AND
//        either the thread's seller or a platform admin (buyer cannot
//        advance — the seller is the only party with the operational
//        authority to flip the strip forward). Target index must be
//        STRICTLY GREATER than current index; backward moves and
//        stalemates return 422. BROKER_GROUP rooms continue to 422 so
//        an admin orphaned in a room can't accidentally fire the stepper
//        for a no-pair thread. Stamps `dealStatusUpdatedAt` + the caller's
//        `userId` on every transition; returns the just-updated state so
//        the client island can update without a second round-trip.
//
// The lot detail GET also stamps `dealStatus + canAdvance` in its wire
// (see /api/lots/[id]/deal-status) so the lot page never needs to call
// this endpoint round-trip-on-mount.
//
// Audit (G5): every successful advance stamps `DEAL_ADVANCED` (and
// `OFFER_ACCEPTED` for OFFER → ACCEPTED) so a senior reviewer can
// later answer "who advanced which deal when". Rate-limit applies
// per-user.
import 'server-only';
import { NextResponse } from 'next/server';
import { isThreadParticipant } from '@/lib/business/thread-participants';
import {
  DEAL_STATUS_ORDER,
  type DealStatus,
  DealStatusEnum,
  DealStatusState,
  DealStatusUpdated,
  UpdateDealStatus,
  type UpdateDealStatusInput,
} from '@/lib/contracts/messaging';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { extractIp, recordAudit } from '@/lib/security/audit';
import { checkLimit, extractIp as headerIp, rateBucketFor } from '@/lib/security/rate-limit';

export const dynamic = 'force-dynamic';

const orderedStepsForWire: DealStatus[] = [...DEAL_STATUS_ORDER];

function canAdvanceForCaller(thread: { sellerId: string | null }, user: SessionUser): boolean {
  if (user.role === 'admin') return true;
  if (thread.sellerId !== null && thread.sellerId === user.id) return true;
  return false;
}

export async function GET(_req: Request, ctx: { params: Promise<{ threadId: string }> }) {
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

  try {
    const thread = await prisma.messageThread.findUnique({
      where: { id: threadId },
      select: {
        id: true,
        kind: true,
        sellerId: true,
        buyerId: true,
        // `createdAt` is required by `isThreadParticipant → ensureParticipantRoster`
        // — the helper reads it to decide whether to insert the seed buyer/seller
        // participant row (older rows without the participant table rely on this
        // backfill, newer ones pre-exist and the createMany no-ops). Including
        // it here keeps the helper's `ThreadLike` contract satisfied in a single
        // query.
        createdAt: true,
        dealStatus: true,
        dealStatusUpdatedAt: true,
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
        { error: 'Broker-group rooms do not carry a deal stepper.' },
        { status: 422 },
      );
    }

    const canAdvance = canAdvanceForCaller(thread, user);
    const wire = DealStatusState.parse({
      threadId: thread.id,
      dealStatus: DealStatusEnum.parse(thread.dealStatus),
      dealStatusUpdatedAt: thread.dealStatusUpdatedAt?.toISOString() ?? null,
      canAdvance,
      orderedSteps: orderedStepsForWire,
    });
    return NextResponse.json(wire);
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

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
    rateBucketFor(req, user.id, `thread:${threadId}:deal-status`),
  );
  if (!limit.allowed) {
    await recordAudit({
      userId: user.id,
      actor: user.role === 'admin' ? 'ADMIN' : 'USER',
      action: 'RATE_LIMITED',
      resourceType: 'Thread',
      resourceId: threadId,
      metadata: { route: '/api/threads/[threadId]/deal-status:PATCH' },
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

  let body: UpdateDealStatusInput;
  try {
    const parsed = UpdateDealStatus.safeParse(await req.json());
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
        kind: true,
        buyerId: true,
        sellerId: true,
        createdAt: true,
        dealStatus: true,
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
        { error: 'Broker-group rooms do not carry a deal stepper.' },
        { status: 422 },
      );
    }
    if (!canAdvanceForCaller(thread, user)) {
      return NextResponse.json(
        { error: 'Only the seller (or a platform admin) can advance the deal stepper.' },
        { status: 403 },
      );
    }

    const currentIndex = DEAL_STATUS_ORDER.indexOf(thread.dealStatus as DealStatus);
    const targetIndex = DEAL_STATUS_ORDER.indexOf(body.dealStatus);
    if (currentIndex === -1 || targetIndex === -1) {
      // Defensive: enum mismatch (someone hand-edited the DB row to a non-
      // enum value, or the wire sent a non-enum value). Surface as 422.
      return NextResponse.json(
        { error: 'Deal status value is not in the stepper.' },
        { status: 422 },
      );
    }
    if (targetIndex <= currentIndex) {
      return NextResponse.json(
        { error: 'Deal status cannot move backwards or stay the same.' },
        { status: 422 },
      );
    }

    const now = new Date();
    const updated = await prisma.messageThread.update({
      where: { id: threadId },
      data: {
        dealStatus: body.dealStatus,
        dealStatusUpdatedAt: now,
        dealStatusAdvancedBy: user.id,
      },
      select: { id: true, dealStatus: true, dealStatusUpdatedAt: true },
    });

    const advanceAction = body.dealStatus === 'ACCEPTED' ? 'OFFER_ACCEPTED' : 'DEAL_ADVANCED';
    await recordAudit({
      userId: user.id,
      actor: user.role === 'admin' ? 'ADMIN' : 'USER',
      action: advanceAction,
      resourceType: 'Thread',
      resourceId: threadId,
      metadata: { from: thread.dealStatus, to: body.dealStatus },
      ip,
    });

    const wire = DealStatusUpdated.parse({
      threadId: updated.id,
      dealStatus: DealStatusEnum.parse(updated.dealStatus),
      dealStatusUpdatedAt: updated.dealStatusUpdatedAt?.toISOString() ?? null,
    });
    return NextResponse.json(wire);
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
