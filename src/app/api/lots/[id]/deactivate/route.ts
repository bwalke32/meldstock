// @polsia:user-owned — POST /api/lots/[id]/deactivate.
//
// Owner-only. Flips `status = DEACTIVATED` and stamps `lastUpdatedAt = now`.
// Keeps `quantityRemaining` untouched so a re-activation preserves partial
// deals (the poster can flip the row back to ACTIVE via /api/lots/.../refresh
// + a PATCH quantityRemaining if they want).
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

    const limitBucket = rateBucketFor(req, userId, `lot:${id}:deactivate`);
    const limit = checkLimit('userMutation', limitBucket);
    if (!limit.allowed) {
      await recordAudit({
        userId,
        actor: userRole === 'admin' ? 'ADMIN' : 'USER',
        action: 'RATE_LIMITED',
        resourceType: 'Lot',
        resourceId: id,
        metadata: { route: '/api/lots/[id]/deactivate:POST', reason: 'rate_limit' },
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
        status: 'DEACTIVATED',
        ...touchLotBump(),
      },
    });
    await recordAudit({
      userId,
      actor: userRole === 'admin' ? 'ADMIN' : 'USER',
      action: 'LOT_DEACTIVATED',
      resourceType: 'Lot',
      resourceId: id,
      ip,
    });
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
