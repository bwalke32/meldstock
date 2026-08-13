// @polsia:user-owned — /api/ratings/aggregate/[userId] endpoint.
//
// GET: public read of a user's per-dimension rating aggregate (avg + count).
// NO requireAuth — the user's `/u/<handle>` profile is publicly viewable, so
// the aggregate displayed there must be too. Consistent with the public
// posture of `/api/profile/[handle]`. Only id + scores cross the wire — no
// commenter names, no rater userIds, no per-thread context — so the public
// surface leaks no caller-identifying info.
//
// `count === 0` dimensions are omitted from the response entirely (rather
// than zero-defaulted). The profile card renders missing dims in a muted
// "no ratings yet" state; a falsy `count` keeps that branch simple.
import 'server-only';
import { NextResponse } from 'next/server';
import { RatingAggregate } from '@/lib/contracts/ratings';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ userId: string }> }) {
  try {
    const { userId } = await ctx.params;
    if (!userId || userId.length > 80) {
      return NextResponse.json({ error: 'Bad user id' }, { status: 400 });
    }
    const grouped = await prisma.rating.groupBy({
      by: ['dimension'],
      where: { rateeId: userId },
      _avg: { score: true },
      _count: { _all: true },
    });

    const out: Record<string, { avg: number; count: number }> = {};
    for (const row of grouped) {
      out[row.dimension] = {
        avg: row._avg.score ?? 0,
        count: row._count._all,
      };
    }
    return NextResponse.json(RatingAggregate.parse(out));
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
