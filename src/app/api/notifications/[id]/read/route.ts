// @polsia:user-owned — PATCH /api/notifications/[id]/read endpoint.
//
// Marks one notification row as read. 404 when the row doesn't exist OR
// isn't owned by the caller — we collapse the two cases so a caller can't
// distinguish "doesn't exist" from "exists but yours" via status.
import 'server-only';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

export async function PATCH(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  let user: SessionUser;
  try {
    user = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  let id: string;
  try {
    const params = await ctx.params;
    id = params.id;
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  try {
    const result = await prisma.notification.updateMany({
      where: { id, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    // updateMany returns count = 0 either when the row doesn't exist OR
    // exists but isn't owned. Collapse to 404 so the caller can't probe
    // ownership.
    if (result.count === 0) {
      // Maybe the row exists but already read — that's still a success
      // from the caller's POV (idempotent), but easier UX is to confirm
      // ownership via a second cheap query before falling back to 404.
      const owned = await prisma.notification.findFirst({
        where: { id, userId: user.id },
        select: { id: true },
      });
      if (owned === null) {
        return NextResponse.json({ error: 'Not Found' }, { status: 404 });
      }
    }
    return new Response(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
