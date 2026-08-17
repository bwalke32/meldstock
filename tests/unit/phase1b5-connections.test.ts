// @vitest-environment node

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  profileFindUnique: vi.fn(),
  profileFindMany: vi.fn(),
  userFindUnique: vi.fn(),
  userFindMany: vi.fn(),
  connectionFindUnique: vi.fn(),
  connectionFindMany: vi.fn(),
  connectionCreate: vi.fn(),
  connectionUpdateMany: vi.fn(),
  connectionDeleteMany: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock('@/lib/db', () => ({
  prisma: {
    profile: { findUnique: mocks.profileFindUnique, findMany: mocks.profileFindMany },
    user: { findUnique: mocks.userFindUnique, findMany: mocks.userFindMany },
    connection: {
      findUnique: mocks.connectionFindUnique,
      findMany: mocks.connectionFindMany,
      create: mocks.connectionCreate,
      updateMany: mocks.connectionUpdateMany,
      deleteMany: mocks.connectionDeleteMany,
    },
  },
}));

import { DELETE, PATCH, POST } from '@/app/api/connections/route';
import { resolveViewerAccess, resolveVisibilityViewer } from '@/lib/business/lot-visibility';

function request(method: string, body: unknown) {
  return new Request('http://localhost/api/connections', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const pending = {
  id: 'connection-ab',
  userIdA: 'user-a',
  userIdB: 'user-b',
  requestedByUserId: 'user-a',
  status: 'PENDING',
  createdAt: new Date('2026-08-17T00:00:00Z'),
  acceptedAt: null,
};

describe('Phase 1B.5 connection authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: 'user-a' } });
    mocks.profileFindUnique.mockImplementation(({ where }: { where: Record<string, string> }) => {
      if (where.userId === 'user-a') return { handle: 'alpha' };
      if (where.handle === 'beta') {
        return { userId: 'user-b', handle: 'beta', displayName: 'Beta', companyName: 'Beta Co' };
      }
      return null;
    });
    mocks.userFindUnique.mockResolvedValue({
      id: 'user-b',
      email: 'beta@example.test',
      name: 'Beta',
    });
    mocks.connectionFindUnique.mockResolvedValue(null);
    mocks.connectionCreate.mockResolvedValue(pending);
    mocks.connectionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.connectionDeleteMany.mockResolvedValue({ count: 1 });
  });

  it('lets User A request User B and derives requester authority from the session', async () => {
    const response = await POST(request('POST', { identifier: '@beta' }));
    expect(response.status).toBe(201);
    expect(mocks.connectionCreate).toHaveBeenCalledWith({
      data: {
        userIdA: 'user-a',
        userIdB: 'user-b',
        requestedByUserId: 'user-a',
        status: 'PENDING',
      },
    });
  });

  it('rejects self-requests and forged requester fields', async () => {
    mocks.profileFindUnique.mockResolvedValueOnce({ handle: 'alpha' }).mockResolvedValueOnce({
      userId: 'user-a',
      handle: 'alpha',
      displayName: 'Alpha',
      companyName: null,
    });
    const self = await POST(request('POST', { identifier: 'alpha' }));
    const forged = await POST(request('POST', { identifier: 'beta', requestedByUserId: 'user-c' }));
    expect(self.status).toBe(400);
    expect(forged.status).toBe(400);
    expect(mocks.connectionCreate).not.toHaveBeenCalled();
  });

  it('allows only the addressed target to accept or reject', async () => {
    mocks.connectionFindUnique.mockResolvedValue(pending);
    const requesterAttempt = await PATCH(
      request('PATCH', { connectionId: pending.id, action: 'ACCEPT' }),
    );
    expect(requesterAttempt.status).toBe(404);

    mocks.getSession.mockResolvedValue({ user: { id: 'user-c' } });
    const unrelatedAttempt = await PATCH(
      request('PATCH', { connectionId: pending.id, action: 'REJECT' }),
    );
    expect(unrelatedAttempt.status).toBe(404);

    mocks.getSession.mockResolvedValue({ user: { id: 'user-b' } });
    const accepted = await PATCH(request('PATCH', { connectionId: pending.id, action: 'ACCEPT' }));
    expect(accepted.status).toBe(200);
    expect(mocks.connectionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: pending.id, status: 'PENDING' }),
        data: { status: 'ACCEPTED', acceptedAt: expect.any(Date) },
      }),
    );
  });

  it('fails a stale or concurrent acceptance safely', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-b' } });
    mocks.connectionFindUnique.mockResolvedValue(pending);
    mocks.connectionUpdateMany.mockResolvedValue({ count: 0 });
    const response = await PATCH(request('PATCH', { connectionId: pending.id, action: 'ACCEPT' }));
    expect(response.status).toBe(409);
  });

  it('allows the requester to cancel and either party to remove an accepted connection', async () => {
    const canceled = await DELETE(request('DELETE', { connectionId: pending.id }));
    expect(canceled.status).toBe(200);
    expect(mocks.connectionDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: pending.id }) }),
    );

    mocks.getSession.mockResolvedValue({ user: { id: 'user-b' } });
    const removed = await DELETE(request('DELETE', { connectionId: pending.id }));
    expect(removed.status).toBe(200);
  });

  it('grants MY_NETWORK access only when the accepted network set contains the owner', () => {
    const lot = { id: 'private-lot', postedByUserId: 'user-a', visibility: 'MY_NETWORK' };
    const viewer = {
      userId: 'user-b',
      emailLower: null,
      handleLower: null,
      verified: false,
      networkUserIds: new Set<string>(),
    };
    expect(resolveViewerAccess([lot], viewer)).toEqual([]);
    viewer.networkUserIds.add('user-a');
    expect(resolveViewerAccess([lot], viewer)).toEqual([lot]);
    viewer.networkUserIds.delete('user-a');
    expect(resolveViewerAccess([lot], viewer)).toEqual([]);
  });

  it('builds the network set from ACCEPTED rows only', async () => {
    mocks.userFindUnique.mockResolvedValue({ email: 'beta@example.test' });
    mocks.profileFindUnique.mockResolvedValue({ handle: 'beta', verificationStatus: 'VERIFIED' });
    mocks.connectionFindMany.mockResolvedValue([{ userIdA: 'user-a', userIdB: 'user-b' }]);
    const viewer = await resolveVisibilityViewer('user-b');
    expect(mocks.connectionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'ACCEPTED' }) }),
    );
    expect(viewer.networkUserIds).toEqual(new Set(['user-a']));
  });

  it('requires ACCEPTED status in saved-search fan-out and network pickers', () => {
    const lotsRoute = readFileSync('src/app/api/lots/route.ts', 'utf8');
    const inviteesRoute = readFileSync('src/app/api/rooms/invitees/route.ts', 'utf8');
    const roomsRoute = readFileSync('src/app/api/rooms/route.ts', 'utf8');
    expect(lotsRoute).toContain("status: 'ACCEPTED'");
    expect(inviteesRoute).toContain("status: 'ACCEPTED'");
    expect(roomsRoute).toContain("status: 'ACCEPTED'");
  });
});
