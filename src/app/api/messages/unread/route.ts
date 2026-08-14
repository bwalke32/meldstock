// @polsia:user-owned — /api/messages/unread endpoint.
//
// GET: cross-thread unread summary for the signed-in user. Returns:
//   - `unreadCount` — count of THREADS that are currently unread (a thread is
//     unread iff its latest message is NOT from the caller AND the caller
//     either has no `ThreadReadState` row for it OR their cursor predates that
//     message).
//   - `recent` — TOP 3 unread threads, ordered by `lastMessageAt desc`, with
//     counterparty + live lot title + message preview, ready for the dashboard
//     card's row list.
//
// Scoping: rows in `ThreadParticipant` for the caller's `userId`. The
// caller cannot see another user's threads. No admin gate.
//
// Backfill: each thread is passed through `ensureParticipantRoster` so a
// thread a user just got added to migrates into the join table as part of
// the very next unread poll (typically ≤15s).
import 'server-only';
import { NextResponse } from 'next/server';
import { hidesAnonymousSeller } from '@/lib/business/anonymity';
import { conditionLabel, polymerLabel } from '@/lib/business/lots';
import { toDecimalString } from '@/lib/business/profiles';
import { ensureParticipantRoster, isThreadParticipant } from '@/lib/business/thread-participants';
import type { LotCondition, Polymer } from '@/lib/contracts/lots';
import { UnreadSummary } from '@/lib/contracts/messages-unread';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

type ThreadRow = {
  id: string;
  lotId: string | null;
  buyerId: string | null;
  sellerId: string | null;
  subject: string;
  createdAt: Date;
  lastMessageAt: Date;
  rfqId: string | null;
  kind: 'LISTING' | 'RFQ' | 'BROKER_GROUP';
  createdById: string | null;
};

type LatestByThread = {
  threadId: string;
  senderId: string;
  body: string;
  createdAt: Date;
};

export async function GET(_req: Request) {
  let user: SessionUser;
  try {
    user = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  try {
    // Scope by the participant join table. The list endpoint uses the same
    // join, so the inbox and the unread widget agree on "which threads
    // belong to me".
    const joined = await prisma.threadParticipant.findMany({
      where: { userId: user.id },
      select: { threadId: true },
    });
    const threadIds = joined.map((j) => j.threadId);
    const candidateThreads = threadIds.length
      ? await prisma.messageThread.findMany({
          where: { id: { in: threadIds } },
          select: {
            id: true,
            lotId: true,
            buyerId: true,
            sellerId: true,
            subject: true,
            createdAt: true,
            lastMessageAt: true,
            rfqId: true,
            kind: true,
            createdById: true,
          },
        })
      : [];
    const threads = (
      await Promise.all(
        candidateThreads.map(async (thread) =>
          (await isThreadParticipant(thread, user.id)) ? thread : null,
        ),
      )
    ).filter((thread): thread is NonNullable<typeof thread> => thread !== null);

    if (threads.length === 0) {
      return NextResponse.json(UnreadSummary.parse({ unreadCount: 0, recent: [] }));
    }

    // Backfill as a side effect: any legacy thread that pre-dates the
    // participant table gets its buyer + seller rows seeded right now.
    // Cheap and idempotent — `skipDuplicates` + the composite PK mean
    // already-present rows are a no-op.
    await Promise.all(threads.map((t) => ensureParticipantRoster(t)));

    const ids = threads.map((t) => t.id);

    // Pull the latest message per thread (single findMany ordered desc, dedup
    // by threadId in app code). The first occurrence per threadId in a desc-
    // ordered list is the newest message — that's what determines the unread
    // state and supplies the row preview.
    const latestMessages = await prisma.message.findMany({
      where: { threadId: { in: ids } },
      orderBy: { createdAt: 'desc' },
      select: { threadId: true, senderId: true, body: true, createdAt: true },
    });
    const latestByThread = new Map<string, LatestByThread>();
    for (const m of latestMessages) {
      if (!latestByThread.has(m.threadId)) {
        latestByThread.set(m.threadId, m);
      }
    }

    // Load the caller's read cursors for these threads. Absence here means
    // the caller has never opened the thread — counts as unread.
    const cursors = await prisma.threadReadState.findMany({
      where: { userId: user.id, threadId: { in: ids } },
      select: { threadId: true, lastReadAt: true },
    });
    const cursorByThread = new Map(cursors.map((c) => [c.threadId, c.lastReadAt]));

    // Apply the unread rule, then sort + take top 3 for the row list.
    const unreadThreads: { thread: ThreadRow; latest: LatestByThread }[] = [];
    for (const t of threads as ThreadRow[]) {
      const latest = latestByThread.get(t.id);
      if (!latest) {
        // No messages yet — nothing to be "unread" against.
        continue;
      }
      if (latest.senderId === user.id) {
        // Caller's own most-recent message — by definition read.
        continue;
      }
      const cursor = cursorByThread.get(t.id);
      if (cursor && cursor.getTime() >= latest.createdAt.getTime()) {
        // Caller has read past the newest inbound.
        continue;
      }
      unreadThreads.push({ thread: t, latest });
    }

    const unreadCount = unreadThreads.length;
    const top = [...unreadThreads]
      .sort((a, b) => b.thread.lastMessageAt.getTime() - a.thread.lastMessageAt.getTime())
      .slice(0, 3);

    if (top.length === 0) {
      return NextResponse.json(UnreadSummary.parse({ unreadCount, recent: [] }));
    }

    // Batch lookups (1 query each) for the 3 enriched rows. Broker-group
    // rooms have no buyer/seller pair AND no lot — they're filtered out of
    // the top-3 unread list when no other surface can carry the room name,
    // but for parity the dashboard widget shows `<room subject>` for rooms
    // when a thread row lands here.
    const otherIds = Array.from(
      new Set(
        top
          .map((r) => {
            if (r.thread.buyerId === null || r.thread.sellerId === null) return null;
            return r.thread.buyerId === user.id ? r.thread.sellerId : r.thread.buyerId;
          })
          .filter((v): v is string => v !== null),
      ),
    );
    const lotIds = Array.from(
      new Set(top.map((r) => r.thread.lotId).filter((v): v is string => v !== null)),
    );

    const [profiles, lots] = await Promise.all([
      otherIds.length > 0
        ? prisma.profile.findMany({
            where: { userId: { in: otherIds } },
            select: { userId: true, displayName: true, companyName: true },
          })
        : Promise.resolve([]),
      // Pull the RFQ-relevant lot fields in the same batched findMany so the
      // dashboard widget can render "RFQ: <grade>/<qty>/<loc>" without an
      // extra round-trip per row.
      lotIds.length > 0
        ? prisma.lot.findMany({
            where: { id: { in: lotIds } },
            select: {
              id: true,
              polymer: true,
              condition: true,
              form: true,
              grade: true,
              quantityLb: true,
              location: true,
              visibility: true,
              postedByUserId: true,
            },
          })
        : Promise.resolve([]),
    ]);
    const profileByUser = new Map(profiles.map((p) => [p.userId, p]));
    const lotById = new Map(lots.map((l) => [l.id, l]));

    const wire = UnreadSummary.parse({
      unreadCount,
      recent: top.map((r) => {
        const isRoom = r.thread.kind === 'BROKER_GROUP';
        const otherUserId =
          !isRoom && r.thread.buyerId !== null && r.thread.sellerId !== null
            ? r.thread.buyerId === user.id
              ? r.thread.sellerId
              : r.thread.buyerId
            : null;
        const profile = otherUserId !== null ? profileByUser.get(otherUserId) : undefined;
        const lot = r.thread.lotId !== null ? lotById.get(r.thread.lotId) : undefined;
        // For listing/RFQ threads: counterparty company name (fallback to
        // display name). For broker-group rooms: the room name (subject)
        // so an "unread" still identifies the specific room.
        const hideSeller = hidesAnonymousSeller(lot ?? null, user.id);
        const otherPartyName = isRoom
          ? r.thread.subject
          : hideSeller
            ? 'Meldstock-verified seller'
            : (profile?.companyName ?? profile?.displayName ?? 'User');
        const lotTitle = isRoom
          ? 'Broker room'
          : lot
            ? `${polymerLabel(lot.polymer as Polymer)} · ${conditionLabel(lot.condition as LotCondition)}`
            : 'Lot';
        // RFQ preview only when this thread row is WANTED-origin. `rfqId`
        // always equals `lot.id` so the fields come from the same lot row
        // we already pulled above.
        const rfq =
          r.thread.rfqId !== null && lot !== undefined
            ? {
                grade: lot.grade,
                quantityLb: toDecimalString(lot.quantityLb),
                location: lot.location,
              }
            : null;
        return {
          threadId: r.thread.id,
          lotId: r.thread.lotId,
          lotTitle,
          otherPartyName,
          lastMessageBody: truncate(r.latest.body, 120),
          lastMessageAt: r.latest.createdAt.toISOString(),
          rfq,
        };
      }),
    });
    return NextResponse.json(wire);
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}
