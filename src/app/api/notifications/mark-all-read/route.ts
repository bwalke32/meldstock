// @polsia:user-owned — POST /api/notifications/mark-all-read endpoint.
//
// Marks every unread notification for the signed-in user as read in a
// single updateMany. 204 on success (no body — the client refetches the
// list + count after firing the invalidate event). Single round-trip,
// indexed via @@index([userId, readAt, createdAt]).
import 'server-only';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request) {
  let user: SessionUser;
  try {
    user = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  try {
    await prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return new Response(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
