// @vitest-environment node
// Audit recorder test: drives a happy-path write AND verifies the
// metadata-sanitiser strips PII keys + caps oversized strings. The
// route handlers rely on `recordAudit` never throwing — a flaky write
// must NOT poison the request it's auditing. We assert that contract
// here so a future refactor can't silently introduce a throw path.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type AuditCreateInput = {
  data: {
    userId: string | null;
    actor: string;
    action: string;
    resourceType: string;
    resourceId: string | null;
    metadata: Record<string, unknown>;
    ip: string | null;
  };
};

async function loadAuditModule() {
  vi.doMock('server-only', () => ({}));
  const writes: AuditCreateInput[] = [];
  const prismaStub = {
    auditEvent: {
      create: vi.fn(async (args: AuditCreateInput) => {
        writes.push(args);
        return { id: 'audit-1' };
      }),
    },
  };
  vi.doMock('@/lib/db', () => ({ prisma: prismaStub }));
  const mod = await import('@/lib/security/audit');
  return { mod, writes, prismaStub };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('recordAudit()', () => {
  it('persists the action / resource / metadata as supplied (no PII keys)', async () => {
    const { mod, writes } = await loadAuditModule();
    await mod.recordAudit({
      userId: 'user-a',
      action: 'OFFER_ACCEPTED',
      resourceType: 'Thread',
      resourceId: 'thread-1',
      metadata: { from: 'OFFER', to: 'ACCEPTED', threadId: 'thread-1' },
    });
    expect(writes).toHaveLength(1);
    const row = writes[0]?.data;
    expect(row.action).toBe('OFFER_ACCEPTED');
    expect(row.resourceType).toBe('Thread');
    expect(row.actor).toBe('USER');
    expect(row.metadata.from).toBe('OFFER');
    expect(row.metadata.threadId).toBe('thread-1');
  });

  it('redacts PII keys ("body", "email", "phone", etc.) so they never reach the table', async () => {
    const { mod, writes } = await loadAuditModule();
    await mod.recordAudit({
      userId: 'user-a',
      action: 'SENSITIVE_THREAD_MESSAGE_FANNED_OUT',
      resourceType: 'Thread',
      resourceId: 'thread-1',
      metadata: {
        recipientCount: 2,
        body: 'this should be redacted',
        email: 'someone@example.test',
        phone: '+15551234567',
        notes: 'free-text notes',
        message: 'free-text message',
        preview: 'preview text',
        companyDescription: 'a long bio',
      },
    });
    const row = writes[0]?.data;
    expect(row.metadata.body).toBe('[redacted]');
    expect(row.metadata.email).toBe('[redacted]');
    expect(row.metadata.phone).toBe('[redacted]');
    expect(row.metadata.notes).toBe('[redacted]');
    expect(row.metadata.message).toBe('[redacted]');
    expect(row.metadata.preview).toBe('[redacted]');
    expect(row.metadata.companyDescription).toBe('[redacted]');
    expect(row.metadata.recipientCount).toBe(2);
  });

  it('truncates very long stringified values to a 200-char safe summary', async () => {
    const { mod, writes } = await loadAuditModule();
    const longString = 'x'.repeat(1000);
    await mod.recordAudit({
      userId: 'user-a',
      action: 'LOT_VISIBILITY_CHANGED',
      resourceType: 'Lot',
      resourceId: 'lot-1',
      metadata: { note: longString },
    });
    const row = writes[0]?.data;
    const persisted = row.metadata.note as string;
    expect(persisted.length).toBeLessThan(220);
    expect(persisted.endsWith('…')).toBe(true);
  });

  it('never throws — a buggy prisma call must NOT poison the request', async () => {
    vi.doMock('server-only', () => ({}));
    vi.doMock('@/lib/db', () => ({
      prisma: {
        auditEvent: {
          create: vi.fn(async () => {
            throw new Error('db down');
          }),
        },
      },
    }));
    const mod = await import('@/lib/security/audit');
    await expect(
      mod.recordAudit({
        userId: 'user-a',
        action: 'OFFER_ACCEPTED',
        resourceType: 'Thread',
        resourceId: 'thread-1',
      }),
    ).resolves.toBeUndefined();
  });

  it('treats manual actor labeling correctly (USER vs ADMIN)', async () => {
    const { mod, writes } = await loadAuditModule();
    await mod.recordAudit({
      userId: 'admin-1',
      actor: 'ADMIN',
      action: 'LOT_VISIBILITY_CHANGED',
      resourceType: 'Lot',
      resourceId: 'lot-1',
      metadata: { from: 'PUBLIC', to: 'SELECTED_COMPANIES' },
    });
    const row = writes[0]?.data;
    expect(row.actor).toBe('ADMIN');
  });
});

describe('extractIp()', () => {
  it('returns the first X-Forwarded-For entry, trimmed', async () => {
    const { mod } = await loadAuditModule();
    const req = new Request('https://example.test', {
      headers: { 'x-forwarded-for': ' 10.0.0.1, 10.0.0.2' },
    });
    expect(mod.extractIp(req)).toBe('10.0.0.1');
  });

  it('falls back to X-Real-IP when XFF is absent', async () => {
    const { mod } = await loadAuditModule();
    const req = new Request('https://example.test', {
      headers: { 'x-real-ip': '10.0.0.3' },
    });
    expect(mod.extractIp(req)).toBe('10.0.0.3');
  });

  it('returns null when neither header is present', async () => {
    const { mod } = await loadAuditModule();
    const req = new Request('https://example.test');
    expect(mod.extractIp(req)).toBeNull();
  });
});
