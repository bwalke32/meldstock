// @polsia:user-owned — /api/notifications/unread-count endpoint.
//
// GET: count of this user's notifications with `readAt IS NULL`. Drives
// the dashboard sidebar badge + the inbox header copy ("N unread").
// Single round-trip, indexed via @@index([userId, readAt, createdAt]).
import 'server-only';
import { NextResponse } from 'next/server';
import { UnreadCount } from '@/lib/contracts/notifications';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request) {
  let user: SessionUser;
  try {
    user = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  try {
    const count = await prisma.notification.count({
      where: { userId: user.id, readAt: null },
    });
    return NextResponse.json(UnreadCount.parse({ count }));
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
