// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  lotFindUnique: vi.fn(),
  threadFindUnique: vi.fn(),
  threadUpsert: vi.fn(),
  profileFindUnique: vi.fn(),
  messageFindFirst: vi.fn(),
  messageFindMany: vi.fn(),
  participantFindMany: vi.fn(),
  readStateUpsert: vi.fn(),
  ensureParticipantRoster: vi.fn(),
  isThreadParticipant: vi.fn(),
  resolveVisibilityViewer: vi.fn(),
  lotBlockedResponse: vi.fn(),
  checkLimit: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/require-auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/business/thread-participants', () => ({
  ensureParticipantRoster: mocks.ensureParticipantRoster,
  isThreadParticipant: mocks.isThreadParticipant,
  loadParticipants: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/business/lot-visibility', async () => {
  const actual = await vi.importActual<typeof import('@/lib/business/lot-visibility')>(
    '@/lib/business/lot-visibility',
  );
  return {
    ...actual,
    resolveVisibilityViewer: mocks.resolveVisibilityViewer,
    lotBlockedResponse: mocks.lotBlockedResponse,
  };
});
vi.mock('@/lib/db', () => ({
  prisma: {
    lot: { findUnique: mocks.lotFindUnique },
    messageThread: { findUnique: mocks.threadFindUnique, upsert: mocks.threadUpsert },
    profile: { findUnique: mocks.profileFindUnique, findMany: vi.fn().mockResolvedValue([]) },
    message: { findFirst: mocks.messageFindFirst, findMany: mocks.messageFindMany },
    threadParticipant: { findMany: mocks.participantFindMany },
    threadReadState: { upsert: mocks.readStateUpsert },
  },
}));
vi.mock('@/lib/security/rate-limit', () => ({
  checkLimit: mocks.checkLimit,
  extractIp: () => null,
  rateBucketFor: () => 'phase1b-messaging-test',
}));
vi.mock('@/lib/security/audit', () => ({ extractIp: () => null, recordAudit: vi.fn() }));
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

import { GET as GET_LEGACY, POST as POST_LEGACY } from '@/app/api/lots/[id]/messages/route';
import { POST as POST_MESSAGE } from '@/app/api/threads/[threadId]/messages/route';
import { GET as GET_THREAD } from '@/app/api/threads/[threadId]/route';
import { POST as CREATE_THREAD } from '@/app/api/threads/route';

const now = new Date('2026-08-14T12:00:00.000Z');
const anonymousLot = {
  id: 'lot-anon',
  type: 'HAVE',
  polymer: 'PC',
  condition: 'PRIME_VIRGIN',
  color: 'Black',
  form: 'Pellet',
  manufacturer: 'SABIC',
  grade: 'C6600',
  quantityLb: 10_000,
  quantityRemaining: 10_000,
  packaging: 'Gaylord',
  location: 'Chicago, IL',
  country: 'US',
  askingPricePerLb: 1.25,
  hasCoa: false,
  notes: null,
  postedByName: 'Secret Seller LLC',
  postedByUserId: 'seller-user',
  visibility: 'ANONYMOUS',
  selectedCompanyIdentifiers: null,
  status: 'ACTIVE',
  createdAt: now,
  postedAt: now,
  lastUpdatedAt: now,
  lastNudgedAt: null,
  lastConfirmedAt: null,
};
const thread = {
  id: 'thread-a',
  lotId: anonymousLot.id,
  buyerId: 'buyer-user',
  sellerId: 'seller-user',
  subject: 'PC · PRIME_VIRGIN · Pellet',
  description: null,
  createdAt: now,
  lastMessageAt: now,
  rfqId: null,
  kind: 'LISTING',
  createdById: null,
  status: 'PENDING',
  completedAt: null,
  dealStatus: 'OFFER',
  dealStatusUpdatedAt: null,
};

describe('Phase 1B private commercial messaging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: 'buyer-user', name: 'Buyer', role: 'user' });
    mocks.lotFindUnique.mockResolvedValue(anonymousLot);
    mocks.threadUpsert.mockResolvedValue(thread);
    mocks.threadFindUnique.mockResolvedValue(thread);
    mocks.profileFindUnique.mockResolvedValue({
      userId: 'seller-user',
      displayName: 'Secret Seller',
      companyName: 'Secret Seller LLC',
      handle: 'secret-seller',
      role: 'BROKER_TRADER',
    });
    mocks.messageFindFirst.mockResolvedValue(null);
    mocks.messageFindMany.mockResolvedValue([]);
    mocks.participantFindMany.mockResolvedValue([]);
    mocks.readStateUpsert.mockResolvedValue({});
    mocks.ensureParticipantRoster.mockResolvedValue(undefined);
    mocks.isThreadParticipant.mockResolvedValue(true);
    mocks.resolveVisibilityViewer.mockResolvedValue({ userId: 'buyer-user' });
    mocks.lotBlockedResponse.mockReturnValue(null);
    mocks.checkLimit.mockReturnValue({ allowed: true });
  });

  it('retires anonymous reads and writes to the shared lot message stream', async () => {
    expect((await GET_LEGACY()).status).toBe(410);
    expect((await POST_LEGACY()).status).toBe(410);
  });

  it('lets a signed-in buyer initiate a private thread without exposing an anonymous owner', async () => {
    const response = await CREATE_THREAD(
      new Request('http://localhost/api/threads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lotId: anonymousLot.id }),
      }),
    );
    const body = (await response.json()) as {
      sellerId: string | null;
      otherParty: { displayName: string; handle: string | null } | null;
    };
    expect(response.status).toBe(201);
    expect(mocks.threadUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ buyerId: 'buyer-user', sellerId: 'seller-user' }),
      }),
    );
    expect(body.sellerId).toBeNull();
    expect(body.otherParty).toMatchObject({
      displayName: 'Meldstock-verified seller',
      handle: null,
    });
    expect(JSON.stringify(body)).not.toContain('Secret Seller');
    expect(JSON.stringify(body)).not.toContain('seller-user');
  });

  it('denies a different authenticated user before loading conversation messages', async () => {
    mocks.requireAuth.mockResolvedValueOnce({ id: 'intruder-user', role: 'user' });
    mocks.isThreadParticipant.mockResolvedValueOnce(false);
    const response = await GET_THREAD(new Request('http://localhost/api/threads/thread-a'), {
      params: Promise.resolve({ threadId: 'thread-a' }),
    });
    expect(response.status).toBe(403);
    expect(mocks.messageFindMany).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied sender identity instead of trusting it', async () => {
    const response = await POST_MESSAGE(
      new Request('http://localhost/api/threads/thread-a/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'I am the seller', senderId: 'seller-user' }),
      }),
      { params: Promise.resolve({ threadId: 'thread-a' }) },
    );
    expect(response.status).toBe(400);
  });
});
