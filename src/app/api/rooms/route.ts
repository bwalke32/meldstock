// @polsia:user-owned — /api/rooms endpoint.
//
// POST: create a broker-group `MessageThread` (kind=BROKER_GROUP, lotId/
//       buyerId/sellerId all null) and seed `ThreadParticipant` rows for
//       the creator + every accepted invitee in one transaction. Invitee
//       authorisation rules:
//
//         1. The caller is added to the room by the server; if the
//            client also includes the caller's `userId` in
//            `inviteeUserIds`, the entry is silently dropped so a self-
//            invite never 4xxs the picker UI.
//         2. If the resulting invitee list is empty (caller only), the
//            request 400s with `inviteeUserIds` — they need at least
//            one other person.
//         3. Every other entry must be EITHER in the caller's accepted
//            `Connection` network (any direction) OR have a Profile
//            with `verificationStatus === 'VERIFIED'`. Disallowed
//            invitees get 403 with the offending `userId`s echoed in
//            `err` so the picker can highlight those rows.
//
//       On success: 201 with `RoomCreated`, the same wire shape used by
//       the composer for confirmation, then the inbox re-renders the new
//       room on `/dashboard/messages?thread=<id>`.
import 'server-only';
import { NextResponse } from 'next/server';
import { CreateRoomInput, type ParticipantItem, RoomCreated } from '@/lib/contracts/messaging';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let user: SessionUser;
  try {
    user = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  let body: { name: string; description?: string; inviteeUserIds: string[] };
  try {
    const parsed = CreateRoomInput.safeParse(await req.json());
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const [field, messages] of Object.entries(parsed.error.flatten().fieldErrors)) {
        const message = messages?.[0];
        if (message) errors[field] = message;
      }
      return NextResponse.json({ errors }, { status: 400 });
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  try {
    // Dedupe + drop the caller (the route seeds them separately); keep a
    // stable order so error messages read the same way every time.
    const inviteeIds = Array.from(new Set(body.inviteeUserIds.filter((id) => id !== user.id)));
    if (inviteeIds.length === 0) {
      return NextResponse.json(
        { errors: { inviteeUserIds: 'Pick at least one person to invite' } },
        { status: 400 },
      );
    }

    // Disallowed-invitee check: every id must be in the caller's accepted
    // network (Connection, any direction) OR have a Profile with
    // `verificationStatus === 'VERIFIED'`. Done in two batched queries so
    // the check is exactly 3 round-trips regardless of invitee count.
    const [connections, profiles] = await Promise.all([
      prisma.connection.findMany({
        where: {
          status: 'ACCEPTED',
          OR: [
            { userIdA: user.id, userIdB: { in: inviteeIds } },
            { userIdB: user.id, userIdA: { in: inviteeIds } },
          ],
        },
        select: { userIdA: true, userIdB: true },
      }),
      prisma.profile.findMany({
        where: { userId: { in: inviteeIds }, verificationStatus: 'VERIFIED' },
        select: { userId: true },
      }),
    ]);

    const networkIds = new Set<string>();
    for (const row of connections) {
      networkIds.add(row.userIdA === user.id ? row.userIdB : row.userIdA);
    }
    const verifiedIds = new Set(profiles.map((p) => p.userId));

    const rejected: string[] = [];
    for (const inviteeId of inviteeIds) {
      if (!networkIds.has(inviteeId) && !verifiedIds.has(inviteeId)) {
        rejected.push(inviteeId);
      }
    }
    if (rejected.length > 0) {
      return NextResponse.json(
        {
          error: 'Some invitees are not in your network or are verified companies.',
          err: rejected.join(','),
        },
        { status: 403 },
      );
    }

    // Single transaction: thread + participant seed. Anything inside
    // goes or none of it does — keeps the roster consistent if the
    // caller retries a partial failure.
    const description = body.description?.trim() ?? null;
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const thread = await tx.messageThread.create({
        data: {
          kind: 'BROKER_GROUP',
          lotId: null,
          buyerId: null,
          sellerId: null,
          subject: body.name,
          description,
          createdById: user.id,
          lastMessageAt: now,
        },
      });
      await tx.threadParticipant.createMany({
        data: [
          {
            threadId: thread.id,
            userId: user.id,
            addedBy: user.id,
            addedAt: now,
          },
          ...inviteeIds.map((id) => ({
            threadId: thread.id,
            userId: id,
            addedBy: user.id,
            addedAt: now,
          })),
        ],
        skipDuplicates: true,
      });
      return { thread, memberIds: [user.id, ...inviteeIds] };
    });

    // Resolve profile fields for the picker / right-pane confirmation.
    // One batched query; the result is the same wire the threads list
    // endpoint stamps on each row.
    const memberIds = result.memberIds;
    const [memberProfiles, creatorProfile] = await Promise.all([
      prisma.profile.findMany({
        where: { userId: { in: memberIds } },
        select: { userId: true, displayName: true, companyName: true, handle: true },
      }),
      prisma.profile.findUnique({
        where: { userId: user.id },
        select: { displayName: true },
      }),
    ]);
    const profileByUser = new Map(memberProfiles.map((p) => [p.userId, p]));
    const members: ParticipantItem[] = memberIds.map((id) => {
      const p = profileByUser.get(id);
      return {
        userId: id,
        displayName: p?.displayName ?? 'User',
        companyName: p?.companyName ?? null,
        handle: p?.handle ?? null,
        addedAt: now.toISOString(),
        addedByDisplayName: id === user.id ? null : (creatorProfile?.displayName ?? null),
      };
    });

    const wire = RoomCreated.parse({
      id: result.thread.id,
      kind: 'BROKER_GROUP',
      subject: result.thread.subject,
      description: result.thread.description,
      createdAt: result.thread.createdAt.toISOString(),
      lastMessageAt: result.thread.lastMessageAt.toISOString(),
      memberCount: members.length,
      members,
    });
    return NextResponse.json(wire, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
