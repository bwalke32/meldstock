// @polsia:user-owned — /api/notifications endpoint.
//
// GET: paginated reverse-chronological list of the signed-in user's
// notifications. Default 50/page, cursor-paged via `?cursor=<id>` (cursor =
// the oldest id in the current page; null on the last page). Payload is
// kept as `unknown` on the wire and narrowed in-component on the client —
// the kind enum is what discriminates between SAVED_SEARCH_MATCH and
// THREAD_MESSAGE shapes.
//
// Scoping: rows in `Notification` for the caller's `userId`. A user
// cannot see another user's notifications. No admin gate (per-user
// surface — admin could read via Prisma directly).
import 'server-only';
import { NextResponse } from 'next/server';
import { NotificationList } from '@/lib/contracts/notifications';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 50;

export async function GET(req: Request) {
  let user: SessionUser;
  try {
    user = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  try {
    const url = new URL(req.url);
    const cursor = url.searchParams.get('cursor');
    const rawLimit = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT;

    const rows = await prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        kind: true,
        payload: true,
        readAt: true,
        createdAt: true,
      },
    });

    // Cheap cursor: drop the marker row if we got `limit + 1` back. The
    // next page's `cursor` is the LAST item's id from the current page
    // (excluding the marker).
    const nextCursor = rows.length > limit ? (rows[limit - 1]?.id ?? null) : null;
    const page = nextCursor ? rows.slice(0, limit) : rows;

    const wire = NotificationList.parse({
      items: page.map((r) => ({
        id: r.id,
        kind: r.kind,
        payload: r.payload,
        readAt: r.readAt ? r.readAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor,
    });
    return NextResponse.json(wire);
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
