// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  isThreadParticipant: vi.fn(),
  threadFindUnique: vi.fn(),
  participantFindMany: vi.fn(),
  participantUpsert: vi.fn(),
  userFindFirst: vi.fn(),
  profileFindUnique: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/require-auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/business/thread-participants', async () => {
  const actual = await vi.importActual<typeof import('@/lib/business/thread-participants')>(
    '@/lib/business/thread-participants',
  );
  return { ...actual, isThreadParticipant: mocks.isThreadParticipant };
});
vi.mock('@/lib/db', () => ({
  prisma: {
    messageThread: { findUnique: mocks.threadFindUnique },
    threadParticipant: {
      findMany: mocks.participantFindMany,
      upsert: mocks.participantUpsert,
    },
    user: { findFirst: mocks.userFindFirst },
    profile: {
      findUnique: mocks.profileFindUnique,
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

import { POST } from '@/app/api/threads/[threadId]/participants/route';
import { canAddThreadParticipant } from '@/lib/business/thread-participants';

const now = new Date('2026-08-14T12:00:00.000Z');
const commercialThread = {
  id: 'thread-a',
  lotId: 'lot-a',
  buyerId: 'buyer-user',
  sellerId: 'seller-user',
  createdAt: now,
  kind: 'LISTING',
  createdById: null,
};

function request() {
  return new Request('http://localhost/api/threads/thread-a/participants', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: 'invitee@example.test' }),
  });
}

describe('Phase 1B thread participant policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.threadFindUnique.mockResolvedValue(commercialThread);
    mocks.isThreadParticipant.mockResolvedValue(true);
    mocks.participantFindMany.mockResolvedValue([]);
    mocks.userFindFirst.mockResolvedValue({ id: 'invitee-user' });
    mocks.participantUpsert.mockResolvedValue({});
    mocks.profileFindUnique.mockResolvedValue({
      displayName: 'Invitee',
      companyName: 'Invitee Co',
      handle: 'invitee',
    });
  });

  it('prevents an ordinary commercial participant from exposing history to another user', async () => {
    mocks.requireAuth.mockResolvedValueOnce({ id: 'buyer-user', role: 'user' });
    const response = await POST(request(), {
      params: Promise.resolve({ threadId: 'thread-a' }),
    });
    expect(response.status).toBe(403);
    expect(mocks.participantUpsert).not.toHaveBeenCalled();
  });

  it('allows the listing seller to add the permitted participant', async () => {
    mocks.requireAuth.mockResolvedValueOnce({ id: 'seller-user', role: 'user' });
    const response = await POST(request(), {
      params: Promise.resolve({ threadId: 'thread-a' }),
    });
    expect(response.status).toBe(201);
    expect(mocks.participantUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          userId: 'invitee-user',
          addedBy: 'seller-user',
        }),
      }),
    );
  });

  it('preserves creator-managed broker rooms while rejecting ordinary room members', () => {
    const room = {
      id: 'room-a',
      buyerId: null,
      sellerId: null,
      createdAt: now,
      kind: 'BROKER_GROUP' as const,
      createdById: 'room-creator',
    };
    expect(canAddThreadParticipant(room, 'room-creator')).toBe(true);
    expect(canAddThreadParticipant(room, 'room-member')).toBe(false);
  });
});
