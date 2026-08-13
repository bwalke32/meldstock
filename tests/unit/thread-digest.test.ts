// @vitest-environment node
// Pure-function tests for the thread-message digest dedupe (5-minute
// sliding window) + opportunistic digest flush. Mirrors the
// `instrumentation.test.ts` style: `vi.resetModules()` +
// `vi.doMock('server-only', () => ({}))` so the module compiles under
// the Node test environment (the production import is a no-op there).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://example.test';
});

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  if (ORIGINAL_NEXT_PUBLIC_APP_URL === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_NEXT_PUBLIC_APP_URL;
});

async function loadNotificationsModule() {
  vi.doMock('server-only', () => ({}));
  // In-memory prisma stub — only used by `recordNotification` paths which
  // these tests do NOT touch. We import the module for its digest
  // helpers and stub prisma separately if a notification write happens.
  const prismaStub = { notification: { create: vi.fn() } };
  vi.doMock('@/lib/db', () => ({ prisma: prismaStub }));
  const sendSpy = vi.fn().mockResolvedValue({ id: '' });
  vi.doMock('@/lib/email/send', () => ({ sendEmail: sendSpy }));
  return {
    mod: await import('@/lib/business/notifications'),
    sendSpy,
  };
}

describe('thread-message digest dedupe (5-min window)', () => {
  it("first message in a quiet thread returns 'send-now'", async () => {
    const { mod } = await loadNotificationsModule();
    const now = 1_700_000_000_000;
    expect(mod.tryClaimThreadDigest('user-a', 'thread-1', now)).toEqual({
      state: 'send-now',
      pendingItems: [],
    });
  });

  it("a message < 5min after the last stamp returns 'buffer' and surfaces the queued items", async () => {
    const { mod } = await loadNotificationsModule();
    const now = 1_700_000_000_000;
    mod.stampThreadDigest(
      'user-a',
      'thread-1',
      { senderName: 'Alice', preview: 'first message…', sentAt: new Date(now) },
      { email: 'a@example.test', recipientName: 'Alice' },
      now,
    );
    const later = now + 60_000; // 1 minute later
    const claim = mod.tryClaimThreadDigest('user-a', 'thread-1', later);
    if (claim.state !== 'buffer') throw new Error('expected buffer');
    expect(claim.pendingItems).toHaveLength(1);
    expect(claim.pendingItems[0].senderName).toBe('Alice');
  });

  it('after the 5-minute window elapses, the next claim returns send-now and a fresh flush opportunity arrives', async () => {
    const { mod } = await loadNotificationsModule();
    const now = 1_700_000_000_000;
    mod.stampThreadDigest(
      'user-a',
      'thread-1',
      { senderName: 'Alice', preview: 'first message…', sentAt: new Date(now) },
      { email: 'a@example.test', recipientName: 'Alice' },
      now,
    );
    const later = now + 5 * 60_000 + 1; // 5min + 1ms
    expect(mod.tryClaimThreadDigest('user-a', 'thread-1', later)).toEqual({
      state: 'send-now',
      pendingItems: [],
    });
  });

  it('a different (user, thread) slot uses its own window', async () => {
    const { mod } = await loadNotificationsModule();
    const now = 1_700_000_000_000;
    mod.stampThreadDigest(
      'user-a',
      'thread-1',
      { senderName: 'Alice', preview: 'a…', sentAt: new Date(now) },
      { email: 'a@example.test', recipientName: 'Alice' },
      now,
    );
    // Different user, same thread — independent.
    expect(mod.tryClaimThreadDigest('user-b', 'thread-1', now + 60_000)).toEqual({
      state: 'send-now',
      pendingItems: [],
    });
    // Same user, different thread — independent.
    expect(mod.tryClaimThreadDigest('user-a', 'thread-2', now + 60_000)).toEqual({
      state: 'send-now',
      pendingItems: [],
    });
  });

  it('chains two buffered messages and stamps both into the entry', async () => {
    const { mod } = await loadNotificationsModule();
    const now = 1_700_000_000_000;
    mod.stampThreadDigest(
      'user-a',
      'thread-1',
      { senderName: 'Alice', preview: 'msg-1…', sentAt: new Date(now) },
      { email: 'a@example.test', recipientName: 'Alice' },
      now,
    );
    mod.stampThreadDigest(
      'user-a',
      'thread-1',
      { senderName: 'Alice', preview: 'msg-2…', sentAt: new Date(now + 30_000) },
      { email: 'a@example.test', recipientName: 'Alice' },
      now + 30_000,
    );
    const claim = mod.tryClaimThreadDigest('user-a', 'thread-1', now + 60_000);
    if (claim.state !== 'buffer') throw new Error('expected buffer');
    expect(claim.pendingItems).toHaveLength(2);
    expect(claim.pendingItems.map((i) => i.preview)).toEqual(['msg-1…', 'msg-2…']);
  });
});

describe('flushDueThreadDigests', () => {
  it('emits one digest email per drained (user, thread) buffer whose flushAt has elapsed', async () => {
    const { mod, sendSpy } = await loadNotificationsModule();
    const now = 1_700_000_000_000;
    mod.stampThreadDigest(
      'user-a',
      'thread-1',
      { senderName: 'Alice', preview: 'preview 1…', sentAt: new Date(now) },
      { email: 'a@example.test', recipientName: 'R A' },
      now,
    );
    mod.stampThreadDigest(
      'user-a',
      'thread-1',
      { senderName: 'Alice', preview: 'preview 2…', sentAt: new Date(now + 30_000) },
      { email: 'a@example.test', recipientName: 'R A' },
      now + 30_000,
    );
    mod.stampThreadDigest(
      'user-b',
      'thread-1',
      { senderName: 'Bob', preview: 'b1…', sentAt: new Date(now) },
      { email: 'b@example.test', recipientName: 'R B' },
      now,
    );

    await mod.flushDueThreadDigests({
      threadId: 'thread-1',
      threadSubject: 'Polymer X · Process A',
      conversationUrl: 'https://example.test/messages/thread-1',
      // Each stamp resets `lastSentAt`, so the latest stamp
      // (now + 30_000) sets the window's closing edge to
      // now + 30_000 + 5min. Flush must clear that latest edge.
      now: now + 30_000 + 5 * 60_000 + 1,
    });

    expect(sendSpy).toHaveBeenCalledTimes(2);
    const receivers = sendSpy.mock.calls.map((call) => (call[0] as { to: string }).to).sort();
    expect(receivers).toEqual(['a@example.test', 'b@example.test']);
    // Each call's subject is the plural "N new messages in your thread".
    const subjects = sendSpy.mock.calls.map((call) => (call[0] as { subject: string }).subject);
    expect(subjects.some((s) => s.includes('2 new messages in your thread'))).toBe(true);
    expect(subjects.some((s) => s.includes('1 new message in your thread'))).toBe(true);
  });

  it('does NOT flush entries whose flushAt has not elapsed yet', async () => {
    const { mod, sendSpy } = await loadNotificationsModule();
    const now = 1_700_000_000_000;
    mod.stampThreadDigest(
      'user-a',
      'thread-1',
      { senderName: 'Alice', preview: 'too soon…', sentAt: new Date(now) },
      { email: 'a@example.test', recipientName: 'R A' },
      now,
    );
    await mod.flushDueThreadDigests({
      threadId: 'thread-1',
      threadSubject: 'Polymer X',
      conversationUrl: 'https://example.test/messages/thread-1',
      now: now + 60_000, // 1 min (window not yet elapsed)
    });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('does NOT flush entries that belong to a DIFFERENT thread', async () => {
    const { mod, sendSpy } = await loadNotificationsModule();
    const now = 1_700_000_000_000;
    mod.stampThreadDigest(
      'user-a',
      'thread-2',
      { senderName: 'Alice', preview: 'other thread…', sentAt: new Date(now) },
      { email: 'a@example.test', recipientName: 'R A' },
      now,
    );
    await mod.flushDueThreadDigests({
      threadId: 'thread-1',
      threadSubject: 'Polymer X',
      conversationUrl: 'https://example.test/messages/thread-1',
      now: now + 5 * 60_000 + 1,
    });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('is single-shot — does not re-schedule; an entry removed by the flush disappears permanently', async () => {
    const { mod, sendSpy } = await loadNotificationsModule();
    const now = 1_700_000_000_000;
    mod.stampThreadDigest(
      'user-a',
      'thread-1',
      { senderName: 'Alice', preview: 'msg…', sentAt: new Date(now) },
      { email: 'a@example.test', recipientName: 'R A' },
      now,
    );
    const afterWindow = now + 5 * 60_000 + 1;
    await mod.flushDueThreadDigests({
      threadId: 'thread-1',
      threadSubject: 'Polymer X',
      conversationUrl: 'https://example.test/messages/thread-1',
      now: afterWindow,
    });
    sendSpy.mockClear();
    // Flush again at the same instant — the previously-popped entry is gone,
    // so this second flush is a no-op (no auto-reschedule).
    await mod.flushDueThreadDigests({
      threadId: 'thread-1',
      threadSubject: 'Polymer X',
      conversationUrl: 'https://example.test/messages/thread-1',
      now: afterWindow,
    });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('survives a `sendEmail` failure (one entry) and still flushes the other entries', async () => {
    const { mod, sendSpy } = await loadNotificationsModule();
    const now = 1_700_000_000_000;
    mod.stampThreadDigest(
      'user-a',
      'thread-1',
      { senderName: 'Alice', preview: 'a…', sentAt: new Date(now) },
      { email: 'a@example.test', recipientName: 'R A' },
      now,
    );
    mod.stampThreadDigest(
      'user-b',
      'thread-1',
      { senderName: 'Bob', preview: 'b…', sentAt: new Date(now) },
      { email: 'b@example.test', recipientName: 'R B' },
      now,
    );
    sendSpy.mockRejectedValueOnce(new Error('proxy boom'));
    await mod.flushDueThreadDigests({
      threadId: 'thread-1',
      threadSubject: 'Polymer X',
      conversationUrl: 'https://example.test/messages/thread-1',
      now: now + 5 * 60_000 + 1,
    });
    expect(sendSpy).toHaveBeenCalledTimes(2);
  });

  it('survives a >10-item buffer and still flushes with "earlier messages" suffix', async () => {
    const { mod, sendSpy } = await loadNotificationsModule();
    const now = 1_700_000_000_000;
    for (let i = 0; i < 12; i += 1) {
      mod.stampThreadDigest(
        'user-a',
        'thread-1',
        { senderName: 'Alice', preview: `msg ${i}…`, sentAt: new Date(now + i * 1_000) },
        { email: 'a@example.test', recipientName: 'R A' },
        now + i * 1_000,
      );
    }
    // Each stamp resets `lastSentAt`; the last stamp is at
    // now + 11_000, so the window's closing edge is now + 11_000 + 5min.
    await mod.flushDueThreadDigests({
      threadId: 'thread-1',
      threadSubject: 'Polymer X',
      conversationUrl: 'https://example.test/messages/thread-1',
      now: now + 11_000 + 5 * 60_000 + 1,
    });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const call = sendSpy.mock.calls[0]?.[0] as { subject: string; text?: string; html: string };
    expect(call.subject).toContain('12 new messages in your thread');
    expect(call.html).toContain('…and 7 earlier messages');
  });
});
