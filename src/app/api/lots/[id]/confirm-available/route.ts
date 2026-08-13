// @polsia:user-owned — POST /api/lots/[id]/confirm-available.
//
// Owner-only. Records "still have this" — bumps `lastConfirmedAt = now`,
// `lastUpdatedAt = now`, clears `lastNudgedAt`. If the lot had previously
// been flipped to EXPIRED by the cron, this flips it back to ACTIVE so the
// owner doesn't need to manually re-create it; the cron only expires lots
// the owner seemingly abandoned.
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

    const limitBucket = rateBucketFor(req, userId, `lot:${id}:confirm-available`);
    const limit = checkLimit('userMutation', limitBucket);
    if (!limit.allowed) {
      await recordAudit({
        userId,
        actor: userRole === 'admin' ? 'ADMIN' : 'USER',
        action: 'RATE_LIMITED',
        resourceType: 'Lot',
        resourceId: id,
        metadata: { route: '/api/lots/[id]/confirm-available:POST', reason: 'rate_limit' },
        ip,
      });
      return new NextResponse(null, {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((limit.retryAfterMs ?? 1000) / 1000)) },
      });
    }

    const lot = await prisma.lot.findUnique({
      where: { id },
      select: { id: true, postedByUserId: true, status: true },
    });
    if (!lot) return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    if (lot.postedByUserId !== userId && userRole !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const wasExpired = lot.status === 'EXPIRED';
    await prisma.lot.update({
      where: { id },
      data: {
        ...touchLotBump(),
        lastNudgedAt: null,
        lastConfirmedAt: new Date(),
        ...(wasExpired ? { status: 'ACTIVE' as const } : {}),
      },
    });
    await recordAudit({
      userId,
      actor: userRole === 'admin' ? 'ADMIN' : 'USER',
      action: wasExpired ? 'LOT_RELISTED' : 'LOT_CONFIRMED_AVAILABLE',
      resourceType: 'Lot',
      resourceId: id,
      ip,
    });
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
