// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getSessionUser: vi.fn(),
  getTrustedPostingIdentity: vi.fn(),
  lotCreate: vi.fn(),
  lotFindUnique: vi.fn(),
  lotFindMany: vi.fn(),
  profileFindMany: vi.fn(),
  savedSearchFindMany: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/require-auth', () => ({
  requireAuth: mocks.requireAuth,
  getSessionUser: mocks.getSessionUser,
}));
vi.mock('@/lib/business/posting-identity', () => ({
  getTrustedPostingIdentity: mocks.getTrustedPostingIdentity,
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    lot: {
      create: mocks.lotCreate,
      findUnique: mocks.lotFindUnique,
      findMany: mocks.lotFindMany,
    },
    profile: { findMany: mocks.profileFindMany },
    savedSearch: { findMany: mocks.savedSearchFindMany },
  },
}));
vi.mock('@/lib/business/notifications', () => ({
  recordSavedSearchMatch: vi.fn(),
  stampNotification: vi.fn(),
  tryClaimNotification: vi.fn(),
}));
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/email/templates', () => ({ wantedSavedSearchMatchEmail: vi.fn() }));

import { GET, POST } from '@/app/api/lots/route';
import { LOT_CSV_REQUIRED_COLUMNS, validateCsvHeaders } from '@/lib/csv/lots';

const now = new Date('2026-08-13T12:00:00.000Z');
const validPayload = {
  type: 'HAVE',
  polymer: 'PC',
  condition: 'PRIME_VIRGIN',
  color: 'Black',
  form: 'Pellet',
  manufacturer: 'SABIC',
  grade: 'C6600',
  quantityLb: 10_000,
  packaging: 'Gaylord',
  location: 'Chicago, IL',
  country: 'US',
  askingPricePerLb: 1.25,
  hasCoa: true,
  notes: null,
  visibility: 'PUBLIC',
} as const;

function persisted(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lot-a',
    ...validPayload,
    postedByName: 'Trusted Plastics LLC',
    postedByUserId: 'user-a',
    selectedCompanyIdentifiers: null,
    quantityRemaining: 10_000,
    status: 'ACTIVE',
    createdAt: now,
    postedAt: now,
    lastUpdatedAt: now,
    lastNudgedAt: null,
    lastConfirmedAt: null,
    ...overrides,
  };
}

function post(body: unknown) {
  return new Request('http://localhost/api/lots', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Phase 1A commercial listing ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: 'user-a', name: 'Auth Name' });
    mocks.getSessionUser.mockResolvedValue(null);
    mocks.getTrustedPostingIdentity.mockResolvedValue({
      userId: 'user-a',
      displayName: 'Trusted Plastics LLC',
      profile: {
        userId: 'user-a',
        displayName: 'Auth Name',
        companyName: 'Trusted Plastics LLC',
        handle: 'trusted-plastics',
        verificationStatus: 'VERIFIED',
        role: 'DISTRIBUTOR',
      },
    });
    mocks.lotCreate.mockResolvedValue(persisted());
    mocks.lotFindUnique.mockResolvedValue(persisted());
    mocks.lotFindMany.mockResolvedValue([persisted()]);
    mocks.profileFindMany.mockResolvedValue([]);
    mocks.savedSearchFindMany.mockResolvedValue([]);
  });

  it('rejects anonymous POST /api/lots before any database write', async () => {
    mocks.requireAuth.mockRejectedValueOnce(
      Response.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const response = await POST(post(validPayload));
    expect(response.status).toBe(401);
    expect(mocks.lotCreate).not.toHaveBeenCalled();
  });

  it('rejects client-controlled owner and posting identity fields', async () => {
    const response = await POST(
      post({
        ...validPayload,
        postedByUserId: 'victim-user',
        postedByName: 'Victim Company',
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.lotCreate).not.toHaveBeenCalled();
  });

  it('rejects ownership identity columns at the CSV write boundary', () => {
    const result = validateCsvHeaders([...LOT_CSV_REQUIRED_COLUMNS, 'posted_by_name']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.forbidden).toContain('posted_by_name');
  });

  it('stores the authenticated session owner and trusted server identity', async () => {
    const response = await POST(post(validPayload));
    expect(response.status).toBe(201);
    expect(mocks.lotCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          postedByUserId: 'user-a',
          postedByName: 'Trusted Plastics LLC',
        }),
      }),
    );
  });

  it('keeps public listing reads available without a session', async () => {
    const response = await GET(new Request('http://localhost/api/lots'));
    const body = (await response.json()) as { items: Array<{ id: string }> };
    expect(response.status).toBe(200);
    expect(body.items[0]?.id).toBe('lot-a');
    expect(mocks.requireAuth).not.toHaveBeenCalled();
  });
});
