// @polsia:user-owned — in-app notification inbox writers + the in-process
// dedupe gates shared with the email fan-out.
//
// One notification row per event that fires fan-out (saved-search match,
// new thread message including RFQ reply). The wire format is zod-
// validated by the route handlers and consumed by `notification-list.tsx`
// via the shared `NotificationKind` enum; server-side the payload is
// typed `unknown` because the shape varies per kind and the client
// narrows in-component.
//
// Dedupe boundaries (both module-scoped Maps — in-process, lost on
// restart, same caveat the existing saved-search fan-out carries):
//
//  - `sentNotifications` — 24h sliding window keyed
//    `${userId}:${dedupeKey}`. Gates the saved-search email fan-out on
//    `/api/lots#fanOutSavedSearchMatches` so a fan-out retry within 24h
//    cannot double-fire EITHER the email OR the notification row.
//
//  - `threadDigest` — 5‑minute digest buffer for the thread-message
//    email fan-out, keyed `${userId}:${threadId}`. The thread-message
//    inbox row itself is **unchanged**: every message still creates one
//    row per recipient (the brief's reverse-chronological unread list).
//    Only the EMAIL is rate-limited — at most one per (recipient, thread)
//    per 5min. The flush is opportunity-driven (the next incoming message
//    in the thread drains any entries whose flushAt <= now), no timer.
import 'server-only';
import type { Prisma } from '@prisma/client';
import type { NotificationKind as NotificationKindEnum } from '@/lib/contracts/notifications';
import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/email/send';
import { threadMessageDigestEmail } from '@/lib/email/templates';

const ONE_DAY_MS = 86_400_000;
const FIVE_MIN_MS = 5 * 60_000;

export interface DigestItem {
  senderName: string;
  preview: string;
  sentAt: Date;
}

interface DigestEntry {
  items: DigestItem[];
  flushAt: number;
  lastSentAt: number;
  email: string;
  recipientName: string;
}

// 24h saved-search dedupe (existing).
const sentNotifications = new Map<string, number>();

// 5-minute thread-message digest buffer.
const threadDigest = new Map<string, DigestEntry>();

function savedSearchKey(userId: string, dedupeKey: string): string {
  return `${userId}:${dedupeKey}`;
}

function digestKey(userId: string, threadId: string): string {
  return `${userId}:thread-digest:${threadId}`;
}

export function tryClaimNotification(userId: string, dedupeKey: string): boolean {
  const last = sentNotifications.get(savedSearchKey(userId, dedupeKey));
  if (last !== undefined && Date.now() - last < ONE_DAY_MS) {
    return false;
  }
  return true;
}

export function stampNotification(userId: string, dedupeKey: string): void {
  sentNotifications.set(savedSearchKey(userId, dedupeKey), Date.now());
}

// Decide whether a fresh thread message to (recipient, thread) should
// send an email now or just buffer a preview for the next 5-minute
// window. `now` is an injectable clock so tests are deterministic;
// production callers omit it.
//
// The first message in a quiet (recipient, thread) ≥ 5min after the
// last send returns `'send-now'`; any message within 5min of the last
// `stamp` returns `'buffer'` — the route layer only stamps and does
// not email. A cleaner alternative would carry the buffered items back
// here; we keep the contract minimal so the route hot-path stays a
// single Map lookup.
export interface ThreadDigestClaim {
  state: 'send-now' | 'buffer';
  pendingItems: DigestItem[];
}

export function tryClaimThreadDigest(
  userId: string,
  threadId: string,
  now: number = Date.now(),
): ThreadDigestClaim {
  const key = digestKey(userId, threadId);
  const existing = threadDigest.get(key);
  if (existing && now - existing.lastSentAt < FIVE_MIN_MS) {
    return { state: 'buffer', pendingItems: existing.items };
  }
  return { state: 'send-now', pendingItems: [] };
}

// Buffer a queued preview so the next flush emits a digest that covers
// every in-window message. Sets `flushAt = now + 5min`,
// `lastSentAt = now`. Preserves items already buffered for this
// (recipient, thread). `email` + `recipientName` are cached on the
// entry so the eventual `flushDueThreadDigests` can send without a
// follow-up DB lookup. `now` is injectable for tests.
export function stampThreadDigest(
  userId: string,
  threadId: string,
  item: DigestItem,
  args: { email: string; recipientName: string },
  now: number = Date.now(),
): void {
  const key = digestKey(userId, threadId);
  const existing = threadDigest.get(key);
  const items = existing ? [...existing.items, item] : [item];
  threadDigest.set(key, {
    items,
    flushAt: now + FIVE_MIN_MS,
    lastSentAt: now,
    email: existing?.email ?? args.email,
    recipientName: existing?.recipientName ?? args.recipientName,
  });
}

export interface FlushDigestsInput {
  threadId: string;
  threadSubject: string;
  conversationUrl: string;
  now?: number;
}

// Drain every buffered (user, thread) entry whose `flushAt <= now` AND
// whose threadId matches the loop's currently-fanning-out thread, and
// emit one `threadMessageDigestEmail` per drained entry. Single-shot —
// does NOT auto-reschedule; the next incoming message in that thread
// after a flush starts a fresh `'send-now' | 'buffer'` cycle.
//
// We only flush entries for the thread that triggered the call, instead
// of every `(user, thread)` whose `flushAt` is due. Opportunity-driven
// flushing across threads would mean a thread A message flushes thread
// B's digest without the right `threadSubject`/`conversationUrl` — so
// we leave those to thread B's own next message. Each recipient of
// thread B is small in practice (room-size) so the cost is bounded.
//
// Best-effort: per-recipient `sendEmail` failures are swallowed; a
// flaky email proxy can never poison the parent route.
export async function flushDueThreadDigests(input: FlushDigestsInput): Promise<void> {
  try {
    const now = input.now ?? Date.now();
    for (const [key, entry] of Array.from(threadDigest.entries())) {
      if (entry.flushAt > now) continue;
      if (!key.endsWith(`:thread-digest:${input.threadId}`)) continue;
      threadDigest.delete(key);
      try {
        await sendEmail({
          to: entry.email,
          ...threadMessageDigestEmail({
            recipientName: entry.recipientName,
            threadSubject: input.threadSubject,
            conversationUrl: input.conversationUrl,
            items: entry.items,
          }),
        });
      } catch {
        // Per-recipient failure — never poisons the flush loop.
      }
    }
  } catch {
    // Whole-block failure — never surfaces to the route layer.
  }
}

export interface RecordNotificationInput {
  userId: string;
  kind: NotificationKindEnum;
  payload: unknown;
  dedupeKey?: string;
  createdAt?: Date;
}

export async function recordNotification(input: RecordNotificationInput) {
  return prisma.notification.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      payload: input.payload as Prisma.InputJsonValue,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
  });
}

export async function recordSavedSearchMatch(
  userId: string,
  lotId: string,
  savedSearchNames: string[],
  sampleFilter: unknown,
) {
  return recordNotification({
    userId,
    kind: 'SAVED_SEARCH_MATCH',
    payload: { lotId, savedSearchNames, sampleFilter },
    dedupeKey: `lot:${lotId}`,
  });
}

export async function recordThreadMessage(
  userId: string,
  args: { threadId: string; messageId: string; senderName: string; isRfqReply: boolean },
) {
  return recordNotification({
    userId,
    kind: 'THREAD_MESSAGE',
    payload: args,
    dedupeKey: `thread:${args.threadId}:msg:${args.messageId}`,
  });
}
