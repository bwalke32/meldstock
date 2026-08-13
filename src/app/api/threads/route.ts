// @polsia:user-owned — /api/threads endpoint.
//
// GET:  the signed-in user's threads (any row in `ThreadParticipant` for the
//       caller's `userId`), newest activity first. Each row is enriched with
//       `kind` (LISTING / RFQ / BROKER_GROUP), `otherParty` (the
//       counterparty's profile, null for rooms), `lotSummary` (the live lot
//       spec — so a refreshed lot reflects on an existing thread), `members`
//       (top-3 participant items, only stamped on rooms),
//       `createdByDisplayName` (only stamped on rooms), `lastMessage` (or
//       null for an empty thread), and `participantCount`. Backfill is run
//       as a side effect inside `hydrateThreadRow` so legacy 1:1 threads
//       migrate the first time they're listed after the group feature ships.
//
// POST: find-or-create a thread for `lotId` between the signed-in buyer and
//       the lot's seller. Anonymous lots (`postedByUserId == null`) return
//       422 so the caller knows to fall back to the anonymous thread UI on
//       the lot detail page. Always returns 201 (or 200/201 for upsert hits).
//
// RFQ scoping: when the source lot is WANTED, both arms of the upsert stamp
// `rfqId = lot.id` so threads originating from a WANTED reply are tagged
// with their source RFQ. The GET route then stamps an `rfq` block on those
// rows for the inbox UI.
import 'server-only';
import { NextResponse } from 'next/server';
import { lotRowToWire, toDecimalString } from '@/lib/business/profiles';
import { ensureParticipantRoster } from '@/lib/business/thread-participants';
import {
  CreateThread,
  type LotSummary,
  type ParticipantItem,
  type RfqContext,
  ThreadItem,
  ThreadList,
} from '@/lib/contracts/messaging';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

type ThreadRow = {
  id: string;
  lotId: string | null;
  buyerId: string | null;
  sellerId: string | null;
  subject: string;
  description: string | null;
  createdAt: Date;
  lastMessageAt: Date;
  rfqId: string | null;
  kind: 'LISTING' | 'RFQ' | 'BROKER_GROUP';
  createdById: string | null;
};

export async function GET(_req: Request) {
  let user: SessionUser;
  try {
    user = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  try {
    // Scope by the join table now that groups exist: a thread is visible to
    // a user iff they have a `ThreadParticipant` row. New threads created
    // via POST below seed the buyer + seller immediately on first creation
    // (no regression — the seed must happen there too, since the GET endpoint
    // can read threads seeded from anywhere). Legacy threads migrate here on
    // first hydration inside `hydrateThreadRow`.
    const joined = await prisma.threadParticipant.findMany({
      where: { userId: user.id },
      select: { threadId: true },
    });
    const threadIds = joined.map((j) => j.threadId);
    const rows = threadIds.length
      ? await prisma.messageThread.findMany({
          where: { id: { in: threadIds } },
          orderBy: { lastMessageAt: 'desc' },
          select: {
            id: true,
            lotId: true,
            buyerId: true,
            sellerId: true,
            subject: true,
            description: true,
            createdAt: true,
            lastMessageAt: true,
            rfqId: true,
            kind: true,
            createdById: true,
          },
        })
      : [];

    // Batch read-cursor lookup keyed by threadId so hydrateThreadRow can stamp
    // the per-thread `unread` flag in O(1) extra queries for the whole list
    // (matches /api/messages/unread semantics).
    const cursorThreadIds = rows.map((r) => r.id);
    const cursors =
      cursorThreadIds.length > 0
        ? await prisma.threadReadState.findMany({
            where: { userId: user.id, threadId: { in: cursorThreadIds } },
            select: { threadId: true, lastReadAt: true },
          })
        : [];
    const cursorByThread = new Map(cursors.map((c) => [c.threadId, c.lastReadAt]));

    const wire = await Promise.all(
      rows.map((row) =>
        hydrateThreadRow(row as unknown as ThreadRow, user.id, cursorByThread.get(row.id)),
      ),
    );
    return NextResponse.json(ThreadList.parse({ items: wire }));
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let user: SessionUser;
  try {
    user = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  let parsedBody: { lotId: string };
  try {
    const parsed = CreateThread.safeParse(await req.json());
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const [field, messages] of Object.entries(parsed.error.flatten().fieldErrors)) {
        const message = messages?.[0];
        if (message) errors[field] = message;
      }
      return NextResponse.json({ errors }, { status: 400 });
    }
    parsedBody = parsed.data;
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  try {
    const lot = await prisma.lot.findUnique({ where: { id: parsedBody.lotId } });
    if (!lot) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }
    if (lot.postedByUserId === null) {
      return NextResponse.json(
        {
          error:
            'Lot was posted anonymously — use the public message thread on this listing to reach the seller.',
        },
        { status: 422 },
      );
    }
    // ANONYMOUS listings also lock contact down to the per-lot public
    // thread — even when the poster is signed-in, their identity is hidden
    // and the buyer's only path to them is the existing message dialog on
    // /lots/[id]. Keeps the brief's "contact to thread only" invariant.
    if (lot.visibility === 'ANONYMOUS') {
      return NextResponse.json(
        {
          error:
            'This listing is anonymous — use the public message thread on the lot to reach the seller.',
        },
        { status: 422 },
      );
    }
    if (lot.postedByUserId === user.id) {
      return NextResponse.json({ error: 'You are the seller on this lot.' }, { status: 409 });
    }

    const lotWire = lotRowToWire({ ...lot, profile: null });
    const subject = `${lotWire.polymer} · ${lotWire.condition} · ${lotWire.form}`;

    // RFQ stamping: a WANTED reply must bind the resulting thread to the
    // source RFQ (the lot id). Stamped on BOTH create + update so a legacy
    // 1:1 thread on a WANTED lot is re-tagged the first time the buyer
    // replies after deploy.
    const rfqId = lot.type === 'WANTED' ? lot.id : null;
    const kind: 'LISTING' | 'RFQ' = rfqId !== null ? 'RFQ' : 'LISTING';

    const thread = await prisma.messageThread.upsert({
      where: { lotId_buyerId: { lotId: lot.id, buyerId: user.id } },
      update: { rfqId, kind },
      create: {
        kind,
        lotId: lot.id,
        buyerId: user.id,
        sellerId: lot.postedByUserId,
        subject,
        rfqId,
      },
    });

    // Seed the participant table at create-time (idempotent — already
    // present rows are a no-op). The threads list scopes by participant
    // rows, so without this the new thread is invisible until its first
    // detail GET runs the same backfill.
    await ensureParticipantRoster(thread as unknown as ThreadRow);

    const wire = await hydrateThreadRow(thread as unknown as ThreadRow, user.id, undefined);
    return NextResponse.json(wire, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// --- helpers ------------------------------------------------------------

// Resolve the other-party profile + lot summary + last message +
// member stamps for a thread row, returning the wire-shape the client
// thread list/detail parse.
//
// `cursor` is this user's `ThreadReadState.lastReadAt` (if any). It's looked
// up in a single batch above and passed in per-row so the per-thread `unread`
// flag can be stamped without an extra query per hydration. Undefined cursor
// ⇒ caller never opened this thread; counts as unread IF the latest message
// is from a different participant.
//
// Runs `ensureParticipantRoster` as a side effect so legacy 1:1 threads on
// first read after deploy migrate cleanly (single query, may insert buyer +
// seller rows; no-op for already-migrated rows or for broker-group rooms
// which have no buyer/seller pair).
async function hydrateThreadRow(row: ThreadRow, currentUserId: string, cursor: Date | undefined) {
  await ensureParticipantRoster(row);

  const isRoom = row.kind === 'BROKER_GROUP';

  // otherParty/lot are only meaningful on listing/RFQ threads. Rooms have
  // no counterparty and no lot; fall through with nulls.
  const otherUserId =
    !isRoom && row.buyerId !== null && row.sellerId !== null
      ? row.buyerId === currentUserId
        ? row.sellerId
        : row.buyerId
      : null;

  const [profile, lot, latestMessage, participantRows] = await Promise.all([
    otherUserId !== null
      ? prisma.profile.findUnique({
          where: { userId: otherUserId },
          select: {
            userId: true,
            displayName: true,
            companyName: true,
            handle: true,
            // Drives the broker-profile link from the thread header.
            role: true,
          },
        })
      : Promise.resolve(null),
    row.lotId !== null
      ? prisma.lot.findUnique({ where: { id: row.lotId } })
      : Promise.resolve(null),
    prisma.message.findFirst({
      where: { threadId: row.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, threadId: true, senderId: true, body: true, createdAt: true },
    }),
    prisma.threadParticipant.findMany({
      where: { threadId: row.id },
      orderBy: { addedAt: 'asc' },
      select: { userId: true, addedAt: true, addedBy: true },
    }),
  ]);

  const lotSummary: LotSummary | null = lot
    ? (() => {
        const wire = lotRowToWire({ ...lot, profile: null });
        return {
          id: wire.id,
          polymer: wire.polymer,
          condition: wire.condition,
          form: wire.form,
          color: wire.color,
          manufacturer: wire.manufacturer,
          grade: wire.grade,
          quantityLb: wire.quantityLb,
        };
      })()
    : null;

  // RFQ block: when this thread was stamped `rfqId` (WANTED-origin reply),
  // surface grade/quantity/location from the same lot we already loaded.
  // `rfqId === lot.id` by design (the lot IS the RFQ) — reuse the row in
  // scope to avoid an extra query per thread.
  const rfq: RfqContext | null =
    row.rfqId !== null && lot !== null
      ? {
          id: lot.id,
          lot: {
            id: lot.id,
            grade: lot.grade,
            quantityLb: toDecimalString(lot.quantityLb),
            location: lot.location,
          },
        }
      : null;

  // Unread: latest inbound message newer than the caller's read cursor (or
  // no cursor at all ⇒ "never opened" counts as unread IF some other
  // participant was the most recent sender). Mirrors /api/messages/unread so
  // the inbox list and the dashboard widget agree. Works for groups: the
  // cursor is per-(thread, caller), so each participant's badge is correct
  // independently.
  const unread =
    latestMessage !== null &&
    latestMessage.senderId !== currentUserId &&
    (cursor === undefined || cursor.getTime() < latestMessage.createdAt.getTime());

  // Members: for broker-group rooms, stamp top-3 `ParticipantItem`s so the
  // inbox row renders the avatar stack without a second fetch. For
  // listing/RFQ threads, members is null — the avatar stack has no UI on
  // those rows. `participantCount` is the full count for both.
  let members: ParticipantItem[] | null = null;
  if (isRoom) {
    const top = participantRows.slice(0, 3);
    const topIds = top.map((r) => r.userId);
    const topProfiles = topIds.length
      ? await prisma.profile.findMany({
          where: { userId: { in: topIds } },
          select: { userId: true, displayName: true, companyName: true, handle: true },
        })
      : [];
    const profileByUser = new Map(topProfiles.map((p) => [p.userId, p]));
    members = top.map((r) => {
      const p = profileByUser.get(r.userId);
      return {
        userId: r.userId,
        displayName: p?.displayName ?? 'User',
        companyName: p?.companyName ?? null,
        handle: p?.handle ?? null,
        addedAt: r.addedAt.toISOString(),
        addedByDisplayName: null,
      };
    });
  }

  // `createdByDisplayName` only meaningful on broker-group rooms.
  let createdByDisplayName: string | null = null;
  let createdByIsBroker: boolean | undefined;
  let createdByUserIdWire: string | null = null;
  if (isRoom && row.createdById !== null) {
    const creator = await prisma.profile.findUnique({
      where: { userId: row.createdById },
      select: { displayName: true, role: true },
    });
    createdByDisplayName = creator?.displayName ?? null;
    createdByIsBroker = creator?.role === 'BROKER_TRADER';
    createdByUserIdWire = row.createdById;
  }

  return ThreadItem.parse({
    id: row.id,
    kind: row.kind,
    description: row.description,
    lotId: row.lotId,
    lotSummary,
    buyerId: row.buyerId,
    sellerId: row.sellerId,
    otherParty:
      profile && otherUserId !== null
        ? {
            userId: otherUserId,
            displayName: profile.displayName,
            companyName: profile.companyName,
            handle: profile.handle,
            counterpartyIsBroker: profile.role === 'BROKER_TRADER',
          }
        : null,
    subject: row.subject,
    createdAt: row.createdAt.toISOString(),
    lastMessageAt: row.lastMessageAt.toISOString(),
    unread,
    participantCount: participantRows.length,
    rfq,
    members,
    createdByDisplayName,
    createdByUserId: createdByUserIdWire,
    createdByIsBroker,
    lastMessage:
      latestMessage === null
        ? null
        : {
            id: latestMessage.id,
            threadId: latestMessage.threadId,
            senderId: latestMessage.senderId,
            body: latestMessage.body,
            createdAt: latestMessage.createdAt.toISOString(),
          },
  });
}
