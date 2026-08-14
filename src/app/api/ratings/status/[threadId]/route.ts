// @polsia:user-owned — /api/ratings/status/[threadId] endpoint.
//
// GET: read what the caller sees on a thread — the thread's status, the
// partner's userId (null if no buyer/seller pair → broker-group room or
// a legacy incomplete row), and which dimensions the caller has already
// submitted. Powers the form-vs-confirmation rendering inside <Thread/>:
//
//     threadStatus === 'COMPLETED' && ratedDimensions.length === 5
//       → "You've rated this transaction." confirmation card;
//     threadStatus === 'COMPLETED' && ratedDimensions.length < 5
//       → render the <RatingForm/>;
//     threadStatus !== 'COMPLETED'
//       → rating section is hidden (the "Mark as completed" pill carries
//         the call to action instead).
//
// Auth: requireAuth + participant gate (same rule as the thread detail
// endpoint — `isThreadParticipant`).
import 'server-only';
import { NextResponse } from 'next/server';
import { isThreadParticipant } from '@/lib/business/thread-participants';
import { RatingStatus } from '@/lib/contracts/ratings';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

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
        buyerId: true,
        sellerId: true,
        createdAt: true,
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
    if (user.id !== thread.buyerId && user.id !== thread.sellerId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const counterpartUserId =
      thread.buyerId !== null && thread.sellerId !== null
        ? thread.buyerId === user.id
          ? thread.sellerId
          : thread.buyerId
        : null;

    const rated = await prisma.rating.findMany({
      where: { threadId: thread.id, raterId: user.id },
      select: { dimension: true },
    });

    const wire = RatingStatus.parse({
      threadStatus: thread.status,
      counterpartUserId,
      ratedDimensions: rated.map((r) => r.dimension),
    });
    return NextResponse.json(wire);
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
