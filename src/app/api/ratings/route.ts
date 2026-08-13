// @polsia:user-owned — /api/ratings endpoint.
//
// POST: submit a single combined 5-dimension rating from the caller for
// the OTHER participant on a COMPLETED MessageThread deal. Rules:
//   - requireAuth — any signed-in user;
//   - thread MUST exist, caller MUST be a participant
//     (`isThreadParticipant`), and the thread MUST be in `COMPLETED`
//     state — PENDING/CANCELED threads can't be rated (the rating form is
//     only rendered after a Mark-as-completed transition, so this is the
//     last-line defense);
//   - thread.kind MUST be LISTING or RFQ — broker-group rooms have no
//     buyer/seller pair to rate (422);
//   - ratee MUST be the OTHER thread participant — server-derived from
//     buyerId/sellerId by picking the id that isn't caller's. The client
//     never supplies rateeId;
//   - all 5 dimensions are required in one round-trip — partial drafts
//     stay local until Submit;
//   - `@@unique([threadId, raterId, dimension])` makes a same-rater/
//     same-dim double-submit impossible at the DB level; on Prisma's
//     P2002 the route returns 409 (re-render of the confirmation card).
//
// On success: 201 with the five persisted rows.
import 'server-only';
import { NextResponse } from 'next/server';
import { isThreadParticipant } from '@/lib/business/thread-participants';
import {
  RatingList as RatingListSchema,
  type SubmitRatingInput,
  SubmitRating as SubmitRatingSchema,
} from '@/lib/contracts/ratings';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let user: SessionUser;
  try {
    user = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  let body: SubmitRatingInput;
  try {
    const parsed = SubmitRatingSchema.safeParse(await req.json());
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
      where: { id: body.threadId },
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
      return NextResponse.json({ error: 'Broker-group rooms cannot be rated.' }, { status: 422 });
    }
    if (thread.status !== 'COMPLETED') {
      return NextResponse.json({ error: 'Deal must be completed before rating.' }, { status: 409 });
    }
    if (thread.buyerId === null || thread.sellerId === null) {
      return NextResponse.json(
        { error: 'Thread is missing buyer/seller — cannot rate.' },
        { status: 422 },
      );
    }

    // ratee = the OTHER thread participant. Caller validation is the set
    // membership, not a supplied id — keeps self-rating structurally
    // impossible even if a malicious client posts their own userId.
    const rateeId = thread.buyerId === user.id ? thread.sellerId : thread.buyerId;

    // Dup-dim check inside the request — even though the DB unique would
    // catch it, we want a single 400-shaped error rather than per-row
    // 409s when the form has a UI bug.
    const seen = new Set<string>();
    for (const row of body.scores) {
      if (seen.has(row.dimension)) {
        return NextResponse.json(
          { errors: { scores: 'Duplicate dimension — each scored once.' } },
          { status: 400 },
        );
      }
      seen.add(row.dimension);
    }

    const created = await prisma.$transaction(async (tx) => {
      return await Promise.all(
        body.scores.map((s) =>
          tx.rating.create({
            data: {
              threadId: thread.id,
              raterId: user.id,
              rateeId,
              dimension: s.dimension,
              score: s.score,
              comment: s.comment ?? null,
            },
          }),
        ),
      );
    });

    const wire = RatingListSchema.parse({
      items: created.map((r) => ({
        id: r.id,
        threadId: r.threadId,
        raterId: r.raterId,
        rateeId: r.rateeId,
        dimension: r.dimension,
        score: r.score,
        comment: r.comment,
        createdAt: r.createdAt.toISOString(),
      })),
    });
    return NextResponse.json(wire, { status: 201 });
  } catch (err: unknown) {
    // P2002 = unique constraint failed — same rater tried to overwrite
    // an already-submitted dimension.
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002'
    ) {
      return NextResponse.json(
        { error: 'You have already rated one of these dimensions.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
