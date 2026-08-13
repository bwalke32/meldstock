// @polsia:user-owned — POST /api/lots/[id]/mark-sold.
//
// Owner-only. Flips `status = SOLD`, sets `quantityRemaining = 0`, stamps
// `lastUpdatedAt = now`. Browse/search filter out SOLD rows for non-owning
// viewers; the poster still sees the row in their inventory so they can
// manage it (e.g. re-activate via the bulk refresh path).
import 'server-only';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { touchLotBump } from '@/lib/business/lot-lifecycle';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/require-auth';
import { extractIp, recordAudit } from '@/lib/security/audit';
import { checkLimit, extractIp as headerIp, rateBucketFor } from '@/lib/security/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    let userId: string;
    try {
      userId = (await requireAuth()).id;
    } catch (res) {
      return res as Response;
    }
    const session = await auth.api.getSession({ headers: await headers() });
    const userRole = (session?.user as { role?: string } | undefined)?.role;
    const ip = extractIp(req) ?? headerIp(req);

    const limitBucket = rateBucketFor(req, userId, `lot:${id}:mark-sold`);
    const limit = checkLimit('userMutation', limitBucket);
    if (!limit.allowed) {
      await recordAudit({
        userId,
        actor: userRole === 'admin' ? 'ADMIN' : 'USER',
        action: 'RATE_LIMITED',
        resourceType: 'Lot',
        resourceId: id,
        metadata: { route: '/api/lots/[id]/mark-sold:POST', reason: 'rate_limit' },
        ip,
      });
      return new NextResponse(null, {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((limit.retryAfterMs ?? 1000) / 1000)) },
      });
    }

    const lot = await prisma.lot.findUnique({
      where: { id },
      select: { id: true, postedByUserId: true },
    });
    if (!lot) return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    if (lot.postedByUserId !== userId && userRole !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await prisma.lot.update({
      where: { id },
      data: {
        status: 'SOLD',
        quantityRemaining: 0,
        lastConfirmedAt: new Date(),
        ...touchLotBump(),
      },
    });
    await recordAudit({
      userId,
      actor: userRole === 'admin' ? 'ADMIN' : 'USER',
      action: 'LOT_MARKED_SOLD',
      resourceType: 'Lot',
      resourceId: id,
      ip,
    });
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
