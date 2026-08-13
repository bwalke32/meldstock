// @polsia:user-owned — /api/threads/[threadId] detail endpoint.
//
// GET:  thread + chronological messages (oldest first, capped 200 for v1) +
//       full participant roster (with profile fields), so the right pane on
//       the dashboard can render the participant list and host the
//       "add by email or company name" form in a single round-trip.
//       For broker-group rooms, the wire additionally carries `description`,
//       `members` (full roster, since detail is the source-of-truth for the
//       right-pane header avatars), and `createdByDisplayName` so the
//       right-pane header can write "Room · created by <name> · N members".
//       Authorization: any current participant in `ThreadParticipant` for
//       this thread (table backfilled on first read for legacy threads).
//       Otherwise 403.
import 'server-only';
import { NextResponse } from 'next/server';
import { lotRowToWire, toDecimalString } from '@/lib/business/profiles';
import { isThreadParticipant, loadParticipants } from '@/lib/business/thread-participants';
import { attachmentDownloadUrl } from '@/lib/contracts/documents';
import {
  DealStatusEnum,
  type LotSummary,
  type RfqContext,
  ThreadDetail,
} from '@/lib/contracts/messaging';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ threadId: string }> }) {
  let user: SessionUser;
  try {
    user = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  let threadId: string;
  try {
    const params = await ctx.params;
    threadId = params.threadId;
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  try {
    const thread = await prisma.messageThread.findUnique({
      where: { id: threadId },
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
        status: true,
        completedAt: true,
        dealStatus: true,
        dealStatusUpdatedAt: true,
      },
    });
    if (!thread) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }
    const participant = await isThreadParticipant(thread, user.id);
    if (!participant) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Bump this participant's read cursor so the /dashboard unread widget
    // drops this thread from their count once they open it. Single upsert,
    // composite key (threadId, userId) on ThreadReadState. Deliberately
    // happens AFTER auth + load so unauth/403 callers do not bump state.
    await prisma.threadReadState.upsert({
      where: { threadId_userId: { threadId: thread.id, userId: user.id } },
      update: { lastReadAt: new Date() },
      create: { threadId: thread.id, userId: user.id, lastReadAt: new Date() },
    });

    const isRoom = thread.kind === 'BROKER_GROUP';
    const canAdvanceDeal =
      !isRoom &&
      (user.role === 'admin' || (thread.sellerId !== null && thread.sellerId === user.id));

    const otherUserId =
      !isRoom && thread.buyerId !== null && thread.sellerId !== null
        ? thread.buyerId === user.id
          ? thread.sellerId
          : thread.buyerId
        : null;

    const [profile, lot, messages, participants, creatorProfile] = await Promise.all([
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
      thread.lotId !== null
        ? prisma.lot.findUnique({ where: { id: thread.lotId } })
        : Promise.resolve(null),
      prisma.message.findMany({
        where: { threadId: thread.id },
        orderBy: { createdAt: 'asc' },
        take: 200,
        select: {
          id: true,
          threadId: true,
          senderId: true,
          body: true,
          createdAt: true,
          attachmentUrl: true,
          attachmentFilename: true,
          attachmentMimeType: true,
        },
      }),
      loadParticipants(thread),
      // Fetch the creator's profile so the right-pane header can stamp
      // "Room · created by <name>" without a second fetch. Only non-null
      // for broker-group rooms — for listing/RFQ threads the column is
      // null.
      thread.createdById !== null && isRoom
        ? prisma.profile.findUnique({
            where: { userId: thread.createdById },
            select: { displayName: true, role: true },
          })
        : Promise.resolve(null),
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

    // RFQ block — same memo as on the list endpoint: `rfqId === lot.id` so we
    // reuse the lot already loaded above. Non-null only on WANTED-origin threads.
    const rfq: RfqContext | null =
      thread.rfqId !== null && lot !== null
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

    const lastMessageRaw = messages.length > 0 ? messages[messages.length - 1] : undefined;

    // For non-rooms, members is the full roster (kept as null on the wire —
    // the field is rooms-only; listing threads render otherParty + count
    // instead). For rooms it equals participants (full roster) — no top-3
    // cap here because the right pane renders the whole list.
    const wireMembers = isRoom ? participants : null;
    const createdByDisplayName = isRoom ? (creatorProfile?.displayName ?? null) : null;
    const createdByUserIdWire = isRoom ? (thread.createdById ?? null) : null;
    const createdByIsBrokerWire = isRoom ? creatorProfile?.role === 'BROKER_TRADER' : undefined;

    const wire = ThreadDetail.parse({
      thread: {
        id: thread.id,
        kind: thread.kind,
        description: thread.description,
        lotId: thread.lotId,
        lotSummary,
        buyerId: thread.buyerId,
        sellerId: thread.sellerId,
        threadStatus: thread.status,
        completedAt: thread.completedAt?.toISOString() ?? null,
        // Stamped on every detail response so the thread island renders
        // the stepper without a second round-trip on first paint. Stays
        // undefined (omitted from the wire) for broker-group rooms —
        // matches the existing closeout pill's branch on `isRoom`. The
        // server validates the enum defensively so a hand-edited DB row
        // can't drift the wire shape.
        dealStatus: isRoom ? undefined : DealStatusEnum.parse(thread.dealStatus),
        dealStatusUpdatedAt: isRoom
          ? undefined
          : (thread.dealStatusUpdatedAt?.toISOString() ?? null),
        canAdvance: canAdvanceDeal,
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
        subject: thread.subject,
        createdAt: thread.createdAt.toISOString(),
        lastMessageAt: thread.lastMessageAt.toISOString(),
        // The detail GET just bumped the caller's read cursor, so the thread
        // is by definition read for THIS viewer. Other viewers may still have
        // a different state — the flag is per-user.
        unread: false,
        participantCount: participants.length,
        rfq,
        members: wireMembers,
        createdByDisplayName,
        createdByUserId: createdByUserIdWire,
        createdByIsBroker: createdByIsBrokerWire,
        lastMessage: lastMessageRaw
          ? {
              id: lastMessageRaw.id,
              threadId: lastMessageRaw.threadId,
              senderId: lastMessageRaw.senderId,
              body: lastMessageRaw.body,
              createdAt: lastMessageRaw.createdAt.toISOString(),
              // Stamped via the same `attachmentDownloadUrl` helper the
              // POST handler uses — never the raw CDN URL (which is
              // guessable). The download proxy at
              // /api/threads/[id]/attachments/[msgId]/download re-checks
              // the participant gate before streaming bytes.
              attachmentUrl: lastMessageRaw.attachmentUrl
                ? attachmentDownloadUrl(thread.id, lastMessageRaw.id)
                : null,
              attachmentFilename: lastMessageRaw.attachmentFilename ?? null,
              attachmentMimeType: lastMessageRaw.attachmentMimeType ?? null,
            }
          : null,
      },
      messages: messages.map((m) => ({
        id: m.id,
        threadId: m.threadId,
        senderId: m.senderId,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        // Same hardening as the `lastMessage` stamp above — the GET
        // response never leaks the raw, guessable CDN URL; the client
        // wires the opaque relative path and the download proxy
        // re-gates access on every read.
        attachmentUrl: m.attachmentUrl ? attachmentDownloadUrl(thread.id, m.id) : null,
        attachmentFilename: m.attachmentFilename ?? null,
        attachmentMimeType: m.attachmentMimeType ?? null,
      })),
      participants,
    });
    return NextResponse.json(wire);
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
