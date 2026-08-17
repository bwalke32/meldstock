// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getSession: vi.fn(),
  isThreadParticipant: vi.fn(),
  threadFindUnique: vi.fn(),
  threadUpdate: vi.fn(),
  offerFindUnique: vi.fn(),
  responseFindUnique: vi.fn(),
  ratingCreate: vi.fn(),
  transaction: vi.fn(),
  verificationFindUnique: vi.fn(),
  verificationUpdate: vi.fn(),
  profileUpdate: vi.fn(),
  checkLimit: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock('@/lib/require-auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/business/thread-participants', () => ({
  isThreadParticipant: mocks.isThreadParticipant,
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    messageThread: { findUnique: mocks.threadFindUnique, update: mocks.threadUpdate },
    offer: { findUnique: mocks.offerFindUnique },
    wantedResponse: { findUnique: mocks.responseFindUnique },
    rating: { create: mocks.ratingCreate },
    verificationRequest: {
      findUnique: mocks.verificationFindUnique,
      update: mocks.verificationUpdate,
    },
    profile: { update: mocks.profileUpdate },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/security/audit', () => ({ extractIp: () => null, recordAudit: vi.fn() }));
vi.mock('@/lib/security/rate-limit', () => ({
  checkLimit: mocks.checkLimit,
  extractIp: () => null,
  rateBucketFor: () => 'phase1b-test',
}));
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/email/templates', () => ({
  offerCounteredEmail: vi.fn(),
  wantedResponseCounteredEmail: vi.fn(),
}));

import { GET as DOWNLOAD_DOCUMENT } from '@/app/api/lots/[id]/documents/[docId]/download/route';
import { POST as COUNTER_OFFER } from '@/app/api/offers/[id]/counter/route';
import { GET as GET_OFFER } from '@/app/api/offers/[id]/route';
import { PATCH as ADMIN_VERIFY } from '@/app/api/profile/verification/[id]/route';
import { POST as CREATE_RATING } from '@/app/api/ratings/route';
import { POST as COUNTER_RESPONSE } from '@/app/api/responses/[id]/counter/route';
import { GET as GET_RESPONSE } from '@/app/api/responses/[id]/route';
import { PATCH as CLOSE_DEAL } from '@/app/api/threads/[threadId]/status/route';
import { resolveViewerAccess } from '@/lib/business/lot-visibility';

const now = new Date('2026-08-14T12:00:00.000Z');
const commercialThread = {
  id: 'thread-a',
  buyerId: 'buyer-user',
  sellerId: 'seller-user',
  createdAt: now,
  kind: 'LISTING',
  status: 'COMPLETED',
};
const future = '2099-01-01T00:00:00.000Z';
const offerTerms = {
  quantityLb: 5_000,
  pricePerUnit: 1.2,
  priceUnit: 'PER_LB',
  freightTerm: 'FOB',
  offerExpiresAt: future,
};
const responseTerms = {
  ...offerTerms,
  materialLocation: 'Chicago, IL',
  coaAvailable: true,
};

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Phase 1B commercial IDOR boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkLimit.mockReturnValue({ allowed: true });
    mocks.isThreadParticipant.mockResolvedValue(true);
    mocks.threadFindUnique.mockResolvedValue(commercialThread);
  });

  it('grants MY_NETWORK access when the resolved accepted-network set contains the seller', () => {
    const rows = resolveViewerAccess(
      [
        {
          id: 'network-lot',
          postedByUserId: 'seller-user',
          visibility: 'MY_NETWORK',
          selectedCompanyIdentifiers: null,
        },
      ],
      {
        userId: 'buyer-user',
        emailLower: 'buyer@example.test',
        handleLower: 'buyer',
        verified: true,
        networkUserIds: new Set(['seller-user']),
      },
    );
    expect(rows).toHaveLength(1);
  });

  it('requires authentication before downloading a public listing document', async () => {
    mocks.requireAuth.mockRejectedValueOnce(
      Response.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const response = await DOWNLOAD_DOCUMENT(new Request('http://localhost/document'), {
      params: Promise.resolve({ id: 'lot-a', docId: 'doc-a' }),
    });
    expect(response.status).toBe(401);
  });

  it('rejects a seller-only offer counter attempted by the buyer', async () => {
    mocks.requireAuth.mockResolvedValueOnce({ id: 'buyer-user', role: 'user' });
    mocks.offerFindUnique.mockResolvedValueOnce({
      id: 'offer-a',
      threadId: 'thread-a',
      lotId: 'lot-a',
      buyerId: 'buyer-user',
      sellerId: 'seller-user',
      status: 'PENDING',
    });
    const response = await COUNTER_OFFER(
      jsonRequest('http://localhost/api/offers/offer-a/counter', { terms: offerTerms }),
      { params: Promise.resolve({ id: 'offer-a' }) },
    );
    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('hides offer and RFQ response terms from an unrelated authenticated user', async () => {
    mocks.requireAuth.mockResolvedValue({ id: 'intruder-user', role: 'user' });
    mocks.offerFindUnique.mockResolvedValueOnce({
      id: 'offer-a',
      threadId: 'thread-a',
      lotId: 'lot-a',
      buyerId: 'buyer-user',
      sellerId: 'seller-user',
    });
    mocks.responseFindUnique.mockResolvedValueOnce({
      id: 'response-a',
      threadId: 'thread-a',
      lotId: 'lot-a',
      buyerId: 'buyer-user',
      sellerId: 'seller-user',
    });
    const [offerResponse, rfqResponse] = await Promise.all([
      GET_OFFER(new Request('http://localhost/api/offers/offer-a'), {
        params: Promise.resolve({ id: 'offer-a' }),
      }),
      GET_RESPONSE(new Request('http://localhost/api/responses/response-a'), {
        params: Promise.resolve({ id: 'response-a' }),
      }),
    ]);
    expect(offerResponse.status).toBe(404);
    expect(rfqResponse.status).toBe(404);
  });

  it('rejects a buyer-only RFQ counter attempted by the respondent seller', async () => {
    mocks.requireAuth.mockResolvedValueOnce({ id: 'seller-user', role: 'user' });
    mocks.responseFindUnique.mockResolvedValueOnce({
      id: 'response-a',
      threadId: 'thread-a',
      lotId: 'lot-a',
      buyerId: 'buyer-user',
      sellerId: 'seller-user',
      status: 'PENDING',
    });
    const response = await COUNTER_RESPONSE(
      jsonRequest('http://localhost/api/responses/response-a/counter', {
        terms: responseTerms,
      }),
      { params: Promise.resolve({ id: 'response-a' }) },
    );
    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('prevents an invited third party from changing deal closeout state', async () => {
    mocks.requireAuth.mockResolvedValueOnce({ id: 'invited-user', role: 'user' });
    mocks.threadFindUnique.mockResolvedValueOnce({ ...commercialThread, status: 'PENDING' });
    const response = await CLOSE_DEAL(
      jsonRequest('http://localhost/api/threads/thread-a/status', { status: 'COMPLETED' }),
      { params: Promise.resolve({ threadId: 'thread-a' }) },
    );
    expect(response.status).toBe(403);
    expect(mocks.threadUpdate).not.toHaveBeenCalled();
  });

  it('allows ratings only from the actual buyer or seller', async () => {
    mocks.requireAuth.mockResolvedValueOnce({ id: 'invited-user', role: 'user' });
    const response = await CREATE_RATING(
      jsonRequest('http://localhost/api/ratings', {
        threadId: 'thread-a',
        scores: [
          { dimension: 'COMMUNICATION', score: 5 },
          { dimension: 'MATERIAL_MATCH', score: 5 },
          { dimension: 'DOCUMENTATION', score: 5 },
          { dimension: 'PAYMENT', score: 5 },
          { dimension: 'SHIPPING', score: 5 },
        ],
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('keeps verification decisions admin-only', async () => {
    mocks.getSession.mockResolvedValueOnce({ user: { id: 'regular-user', role: 'user' } });
    const response = await ADMIN_VERIFY(
      jsonRequest('http://localhost/api/profile/verification/request-a', {
        decision: 'APPROVED',
      }),
      { params: Promise.resolve({ id: 'request-a' }) },
    );
    expect(response.status).toBe(403);
    expect(mocks.verificationUpdate).not.toHaveBeenCalled();
  });
});
