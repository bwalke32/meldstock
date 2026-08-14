// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  isThreadParticipant: vi.fn(),
  threadFind: vi.fn(),
  messageFind: vi.fn(),
  messageCreate: vi.fn(),
  threadUpdate: vi.fn(),
  transaction: vi.fn(),
  recordAudit: vi.fn(),
  checkLimit: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/require-auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/business/thread-participants', () => ({
  isThreadParticipant: mocks.isThreadParticipant,
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    messageThread: { findUnique: mocks.threadFind },
    message: { findUnique: mocks.messageFind },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/security/audit', () => ({
  extractIp: () => null,
  recordAudit: mocks.recordAudit,
}));
vi.mock('@/lib/security/rate-limit', () => ({
  checkLimit: mocks.checkLimit,
  extractIp: () => null,
  rateBucketFor: () => 'attachment-test',
}));
vi.mock('@/lib/business/notifications', () => ({
  flushDueThreadDigests: vi.fn(),
  recordThreadMessage: vi.fn(),
  stampThreadDigest: vi.fn(),
  tryClaimThreadDigest: vi.fn(),
}));
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/email/templates', () => ({
  rfqReplyEmail: vi.fn(),
  threadMessageEmail: vi.fn(),
}));

import { GET } from '@/app/api/threads/[threadId]/attachments/[msgId]/download/route';
import { POST as POST_MESSAGE } from '@/app/api/threads/[threadId]/messages/route';
import { CreateMessage } from '@/lib/contracts/messaging';
import { issueAttachmentToken, resolveAttachmentToken } from '@/lib/security/attachment-token';

const SECRET = 'test-only-attachment-secret-with-sufficient-entropy';

function token(uploadedBy = 'user-a') {
  return issueAttachmentToken(
    {
      upstreamUrl: 'https://storage.example.test/private/object-123',
      uploadedBy,
      filename: 'coa.pdf',
      mimeType: 'application/pdf',
    },
    SECRET,
  );
}

describe('Phase 1A attachment references', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BETTER_AUTH_SECRET = SECRET;
    mocks.requireAuth.mockResolvedValue({ id: 'user-a', role: 'user' });
    mocks.checkLimit.mockReturnValue({ allowed: true });
    mocks.threadFind.mockResolvedValue({ id: 'thread-a', buyerId: 'user-a', sellerId: 'user-b' });
    mocks.messageFind.mockResolvedValue({
      id: 'message-a',
      threadId: 'thread-a',
      attachmentUrl: token(),
      attachmentFilename: 'coa.pdf',
      attachmentMimeType: 'application/pdf',
    });
    mocks.recordAudit.mockResolvedValue(undefined);
    mocks.messageCreate.mockResolvedValue({
      id: 'message-new',
      threadId: 'thread-a',
      senderId: 'user-a',
      body: 'COA attached',
      createdAt: new Date('2026-08-13T12:00:00.000Z'),
      attachmentUrl: token(),
      attachmentFilename: 'coa.pdf',
      attachmentMimeType: 'application/pdf',
    });
    mocks.threadUpdate.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        message: { create: mocks.messageCreate },
        messageThread: { update: mocks.threadUpdate },
      }),
    );
  });

  it('rejects arbitrary external and loopback URLs at the message write boundary', () => {
    expect(
      CreateMessage.safeParse({ body: 'file', attachmentUrl: 'https://attacker.test/a' }).success,
    ).toBe(false);
    expect(
      CreateMessage.safeParse({ body: 'file', attachmentUrl: 'http://127.0.0.1/admin' }).success,
    ).toBe(false);
    expect(() =>
      issueAttachmentToken(
        {
          upstreamUrl: 'http://127.0.0.1/admin',
          uploadedBy: 'user-a',
          filename: 'x',
          mimeType: 'text/plain',
        },
        SECRET,
      ),
    ).toThrow();
    expect(() =>
      issueAttachmentToken(
        {
          upstreamUrl: 'https://169.254.169.254/latest/meta-data',
          uploadedBy: 'user-a',
          filename: 'x',
          mimeType: 'text/plain',
        },
        SECRET,
      ),
    ).toThrow();
  });

  it('accepts a valid server-issued attachment for its authenticated uploader', () => {
    const issued = token();
    expect(
      CreateMessage.parse({ body: 'COA attached', attachmentToken: issued }).attachmentToken,
    ).toBe(issued);
    expect(
      resolveAttachmentToken(issued, { secret: SECRET, expectedUploadedBy: 'user-a' }).filename,
    ).toBe('coa.pdf');
    expect(() =>
      resolveAttachmentToken(issued, { secret: SECRET, expectedUploadedBy: 'user-b' }),
    ).toThrow();
  });

  it('associates a valid issued token with a message using token metadata', async () => {
    mocks.isThreadParticipant.mockResolvedValueOnce(true);
    const issued = token();
    const request = new Request('http://localhost/api/threads/thread-a/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'COA attached', attachmentToken: issued }),
    });
    const response = await POST_MESSAGE(request, {
      params: Promise.resolve({ threadId: 'thread-a' }),
    });
    expect(response.status).toBe(201);
    expect(mocks.messageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        attachmentUrl: issued,
        attachmentFilename: 'coa.pdf',
        attachmentMimeType: 'application/pdf',
      }),
    });
  });

  it('denies a non-participant before any storage read', async () => {
    mocks.isThreadParticipant.mockResolvedValueOnce(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(new Request('http://localhost/download'), {
      params: Promise.resolve({ threadId: 'thread-a', msgId: 'message-a' }),
    });
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows a participant through the approved storage path', async () => {
    mocks.isThreadParticipant.mockResolvedValueOnce(true);
    const fetchMock = vi.fn().mockResolvedValue(new Response('pdf bytes', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(new Request('http://localhost/download'), {
      params: Promise.resolve({ threadId: 'thread-a', msgId: 'message-a' }),
    });
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://storage.example.test/private/object-123',
      expect.objectContaining({ redirect: 'error' }),
    );
  });
});
