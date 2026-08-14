// @polsia:user-owned — shared helper for the `ThreadParticipant` join table
// used by the group-thread feature. EVERY route that gates access to a
// thread (detail GET, messages POST, threads list, unread) routes through
// `ensureParticipantRoster` + `loadParticipants` so the participant set is
// computed the SAME way everywhere. The "backfill" inside ensure makes the
// first read after deploy migrate every existing 1:1 thread into the new
// join table without a separate migration step.
//
// `server-only` is required because the helpers touch `prisma` and never
// run on the client.
import 'server-only';
import type { ParticipantItem } from '@/lib/contracts/messaging';
import { prisma } from '@/lib/db';

type ThreadLike = {
  id: string;
  buyerId: string | null;
  sellerId: string | null;
  createdAt: Date;
  kind?: 'LISTING' | 'RFQ' | 'BROKER_GROUP';
  createdById?: string | null;
};

function participantIsAuthorized(
  thread: ThreadLike,
  participant: { userId: string; addedBy: string | null },
): boolean {
  if (participant.userId === thread.buyerId || participant.userId === thread.sellerId) {
    return true;
  }
  if (thread.buyerId !== null && thread.sellerId !== null) {
    return participant.addedBy === thread.sellerId;
  }
  if (thread.kind === 'BROKER_GROUP' && thread.createdById) {
    return participant.userId === thread.createdById || participant.addedBy === thread.createdById;
  }
  return false;
}

export function canAddThreadParticipant(thread: ThreadLike, userId: string): boolean {
  if (thread.buyerId !== null && thread.sellerId !== null) {
    return thread.sellerId === userId;
  }
  return thread.kind === 'BROKER_GROUP' && thread.createdById === userId;
}

// First-read backfill: a LISTING or RFQ thread MUST have rows for buyer +
// seller in the participant table before any access check. Broker-group
// rooms (kind=BROKER_GROUP) have NO buyer/seller pair — their initial
// roster is seeded at create time by the POST /api/rooms route via
// `ThreadParticipant.createMany` for creator + invitees, so this function
// is a no-op for them. Idempotent — composite PK `@@id([threadId, userId])`
// means an absent insert + a replay upsert are both no-ops for already-
// present rows. Buyer rows are seeded with `addedBy = thread.buyerId` so
// the "who invited them" column is never null for a real seed row.
export async function ensureParticipantRoster(thread: ThreadLike): Promise<void> {
  // Broker-group room: no buyer/seller to backfill. The room was seeded
  // (creator + invitees) at create time.
  if (thread.buyerId === null || thread.sellerId === null) {
    return;
  }
  await prisma.threadParticipant.createMany({
    data: [
      {
        threadId: thread.id,
        userId: thread.buyerId,
        addedBy: thread.buyerId,
        addedAt: thread.createdAt,
      },
      {
        threadId: thread.id,
        userId: thread.sellerId,
        addedBy: thread.buyerId,
        addedAt: thread.createdAt,
      },
    ],
    // `skipDuplicates` is the explicit no-op path on the composite PK —
    // belt + braces alongside the natural upsert idempotency below.
    skipDuplicates: true,
  });
}

// Access check: is `userId` in this thread's roster after backfill?
// `ensureParticipantRoster` is called BEFORE the count, so a pre-existing
// 1:1 row is migrated as a side effect of this very check.
export async function isThreadParticipant(thread: ThreadLike, userId: string): Promise<boolean> {
  await ensureParticipantRoster(thread);
  const found = await prisma.threadParticipant.findUnique({
    where: { threadId_userId: { threadId: thread.id, userId } },
    select: { userId: true, addedBy: true },
  });
  return found !== null && participantIsAuthorized(thread, found);
}

type RosterRow = {
  userId: string;
  addedAt: Date;
  addedBy: string | null;
};

type ProfileRow = {
  userId: string;
  displayName: string;
  companyName: string | null;
  handle: string | null;
};

// Full roster → wire shape. Caller MUST have run `ensureParticipantRoster`
// (or any other path that touched the table) on this `threadId` before
// reading — otherwise it returns only the rows that pre-existed before
// the migration ran. The detail endpoint runs ensure + loadParticipants
// back to back so the response always contains buyer + seller even on a
// thread that just unlocked the table during this very request.
export async function loadParticipants(thread: ThreadLike): Promise<ParticipantItem[]> {
  await ensureParticipantRoster(thread);

  const rows: RosterRow[] = await prisma.threadParticipant.findMany({
    where: { threadId: thread.id },
    select: { userId: true, addedAt: true, addedBy: true },
    orderBy: { addedAt: 'asc' },
  });
  const authorizedRows = rows.filter((row) => participantIsAuthorized(thread, row));
  if (authorizedRows.length === 0) {
    return [];
  }

  const ids = Array.from(new Set(authorizedRows.map((r) => r.userId)));
  const addedByIds = Array.from(
    new Set(authorizedRows.map((r) => r.addedBy).filter((v): v is string => v !== null)),
  );
  const lookupIds = Array.from(new Set([...ids, ...addedByIds]));

  const profiles: ProfileRow[] = await prisma.profile.findMany({
    where: { userId: { in: lookupIds } },
    select: { userId: true, displayName: true, companyName: true, handle: true },
  });
  const profileByUser = new Map(profiles.map((p) => [p.userId, p]));

  return authorizedRows.map((r) => {
    const profile = profileByUser.get(r.userId);
    return {
      userId: r.userId,
      displayName: profile?.displayName ?? 'User',
      companyName: profile?.companyName ?? null,
      handle: profile?.handle ?? null,
      addedAt: r.addedAt.toISOString(),
      addedByDisplayName: r.addedBy ? (profileByUser.get(r.addedBy)?.displayName ?? null) : null,
    };
  });
}

// Cheap participant COUNT — used by the inbox list to render the "Group"
// badge without round-tripping the full roster per row. Goes through the
// same backfill as `isThreadParticipant` so calls in `hydrateThreadRow`
// ALSO migrate legacy threads.
export async function countParticipants(
  thread: ThreadLike,
  currentUserId: string,
): Promise<{ count: number; isParticipant: boolean }> {
  await ensureParticipantRoster(thread);
  const rows = await prisma.threadParticipant.findMany({
    where: { threadId: thread.id },
    select: { userId: true, addedBy: true },
  });
  const authorized = rows.filter((row) => participantIsAuthorized(thread, row));
  return {
    count: authorized.length,
    isParticipant: authorized.some((row) => row.userId === currentUserId),
  };
}

// Used by /api/threads/[id]/participants POST. Returns the resolved
// `userId` plus the reject reason (`null` = success). The route uses this
// as a single decision point so the lookup order (email → companyName →
// ambiguous → not-found) is identical for every caller.
export type ResolveParticipantResult =
  | { ok: true; userId: string }
  | { ok: false; status: 404 | 409; error: string };

// `User` lives in better-auth's framework-owned schema; emails are
// lowercased later in better-auth, so case-insensitive matching is the
// right invariant.
export async function resolveParticipantByIdentifier(
  identifier: string,
  alreadyInThread: ReadonlySet<string>,
): Promise<ResolveParticipantResult> {
  const trimmed = identifier.trim();
  if (trimmed.length === 0) {
    return { ok: false, status: 404, error: 'No matching user' };
  }

  if (trimmed.includes('@')) {
    const user = await prisma.user.findFirst({
      where: { email: { equals: trimmed, mode: 'insensitive' } },
      select: { id: true },
    });
    if (!user) {
      return { ok: false, status: 404, error: 'No matching user' };
    }
    if (alreadyInThread.has(user.id)) {
      return { ok: false, status: 409, error: 'Already in the thread' };
    }
    return { ok: true, userId: user.id };
  }

  const matches = await prisma.profile.findMany({
    where: { companyName: { equals: trimmed, mode: 'insensitive' } },
    select: { userId: true },
  });
  if (matches.length === 0) {
    return { ok: false, status: 404, error: 'No matching user' };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      status: 409,
      error: 'Multiple company-name matches — try an email',
    };
  }
  const candidate = matches[0]?.userId;
  if (!candidate) {
    return { ok: false, status: 404, error: 'No matching user' };
  }
  if (alreadyInThread.has(candidate)) {
    return { ok: false, status: 409, error: 'Already in the thread' };
  }
  return { ok: true, userId: candidate };
}
