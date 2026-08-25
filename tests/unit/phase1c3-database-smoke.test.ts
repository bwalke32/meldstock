// @vitest-environment node

// biome-ignore lint/style/noRestrictedImports: This isolated smoke test must construct a client for its disposable database.
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const smokeFlagEnabled = process.env.MELDSTOCK_DB_SMOKE === '1';
const databaseUrl = process.env.DATABASE_URL;

function validateDisposableDatabaseUrl(value: string | undefined): string {
  if (!value) {
    throw new Error('MELDSTOCK_DB_SMOKE=1 requires DATABASE_URL to be explicitly provided');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('MELDSTOCK_DB_SMOKE=1 requires a valid DATABASE_URL');
  }

  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !['localhost', '127.0.0.1'].includes(parsed.hostname) ||
    parsed.port !== '5432' ||
    databaseName !== 'meldstock_phase1c3'
  ) {
    throw new Error(
      'MELDSTOCK_DB_SMOKE=1 requires a PostgreSQL DATABASE_URL for localhost:5432/meldstock_phase1c3',
    );
  }

  return value;
}

const shouldRun = smokeFlagEnabled;

if (!shouldRun) {
  describe.skip('Phase 1C.3 database smoke', () => {
    it('skips unless a disposable database is configured', () => {});
  });
} else {
  describe('Phase 1C.3 database smoke', () => {
    const prisma = new PrismaClient({ datasourceUrl: validateDisposableDatabaseUrl(databaseUrl) });

    beforeAll(async () => {
      await prisma.$connect();
      const result = await prisma.$queryRaw<Array<{ databaseName: string }>>`
        SELECT current_database() AS "databaseName"
      `;
      expect(result[0]?.databaseName).toBe('meldstock_phase1c3');
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    it('creates Better Auth users, sessions, and accounts against the mapped physical tables', async () => {
      const user = await prisma.user.create({
        data: {
          id: `auth-user-${Date.now()}`,
          name: 'Auth User',
          email: `auth-${Date.now()}@example.test`,
          emailVerified: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const session = await prisma.session.create({
        data: {
          id: `auth-session-${Date.now()}`,
          userId: user.id,
          expiresAt: new Date(Date.now() + 60_000),
          token: `auth-token-${Date.now()}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const account = await prisma.account.create({
        data: {
          id: `auth-account-${Date.now()}`,
          userId: user.id,
          accountId: `account-${Date.now()}`,
          providerId: 'credential',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      expect(user.email).toContain('@example.test');
      expect(session.userId).toBe(user.id);
      expect(account.userId).toBe(user.id);
    });

    it('retains pending defaults and unique constraints for Connection rows', async () => {
      const userA = `conn-a-${Date.now()}`;
      const userB = `conn-b-${Date.now()}`;
      const created = await prisma.connection.create({
        data: {
          id: `conn-${Date.now()}`,
          userIdA: userA,
          userIdB: userB,
          requestedByUserId: userA,
        },
      });

      expect(created.status).toBe('PENDING');
      expect(created.acceptedAt).toBeNull();

      await expect(
        prisma.connection.create({
          data: {
            id: `conn-dup-${Date.now()}`,
            userIdA: userA,
            userIdB: userB,
            requestedByUserId: userA,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('supports representative marketplace records across major schema areas', async () => {
      const userId = `market-${Date.now()}`;
      const buyerId = `buyer-${Date.now()}`;
      const sellerId = `seller-${Date.now()}`;

      const profile = await prisma.profile.create({
        data: {
          id: `profile-${Date.now()}`,
          userId,
          displayName: 'Market Trader',
          role: 'BROKER_TRADER',
          handle: `market-${Date.now()}`,
        },
      });

      const lot = await prisma.lot.create({
        data: {
          id: `lot-${Date.now()}`,
          type: 'HAVE',
          polymer: 'PC',
          condition: 'PRIME_VIRGIN',
          color: 'Black',
          form: 'Pellets',
          packaging: 'Gaylord',
          postedByName: profile.displayName,
          postedByUserId: userId,
          visibility: 'PUBLIC',
          country: 'US',
          status: 'ACTIVE',
        },
      });

      const thread = await prisma.messageThread.create({
        data: {
          id: `thread-${Date.now()}`,
          lotId: lot.id,
          buyerId: buyerId,
          sellerId: sellerId,
          subject: 'Representative thread',
          kind: 'LISTING',
        },
      });

      const message = await prisma.message.create({
        data: {
          id: `message-${Date.now()}`,
          threadId: thread.id,
          senderId: sellerId,
          body: 'Message body',
        },
      });

      const offer = await prisma.offer.create({
        data: {
          id: `offer-${Date.now()}`,
          threadId: thread.id,
          lotId: lot.id,
          buyerId: buyerId,
          sellerId: sellerId,
          quantityLb: '1000',
          pricePerUnit: '2.50',
          freightTerm: 'FOB',
          shipToCountry: 'US',
          offerExpiresAt: new Date(Date.now() + 86_400_000),
        },
      });

      const wantedResponse = await prisma.wantedResponse.create({
        data: {
          id: `wanted-response-${Date.now()}`,
          threadId: thread.id,
          lotId: `rfq-${Date.now()}`,
          buyerId: buyerId,
          sellerId: sellerId,
          quantityLb: '500',
          pricePerUnit: '3.00',
          freightTerm: 'FOB',
          materialLocation: 'Chicago',
          offerExpiresAt: new Date(Date.now() + 86_400_000),
        },
      });

      const rating = await prisma.rating.create({
        data: {
          id: `rating-${Date.now()}`,
          threadId: thread.id,
          raterId: sellerId,
          rateeId: buyerId,
          dimension: 'COMMUNICATION',
          score: 5,
        },
      });

      const savedSearch = await prisma.savedSearch.create({
        data: {
          id: `search-${Date.now()}`,
          userId,
          name: 'PC Black',
          filterJson: { polymer: 'PC' },
        },
      });

      const notification = await prisma.notification.create({
        data: {
          id: `notification-${Date.now()}`,
          userId,
          kind: 'THREAD_MESSAGE',
          payload: { threadId: thread.id },
        },
      });

      expect(profile.userId).toBe(userId);
      expect(lot.polymer).toBe('PC');
      expect(thread.subject).toBe('Representative thread');
      expect(message.body).toBe('Message body');
      expect(offer.status).toBe('PENDING');
      expect(wantedResponse.status).toBe('PENDING');
      expect(rating.dimension).toBe('COMMUNICATION');
      expect(savedSearch.filterJson).toMatchObject({ polymer: 'PC' });
      expect(notification.kind).toBe('THREAD_MESSAGE');
    });

    it('rejects duplicate unique keys across the marketplace schema', async () => {
      const profileId = `dup-profile-${Date.now()}`;
      const userId = `dup-user-${Date.now()}`;
      const handle = `dup-handle-${Date.now()}`;

      await prisma.profile.create({
        data: {
          id: profileId,
          userId,
          displayName: 'Duplicate profile check',
          role: 'BUYER',
          handle,
        },
      });

      await expect(
        prisma.profile.create({
          data: {
            id: `dup-profile-2-${Date.now()}`,
            userId,
            displayName: 'Duplicate profile check 2',
            role: 'BUYER',
            handle: `${handle}-2`,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });
}
