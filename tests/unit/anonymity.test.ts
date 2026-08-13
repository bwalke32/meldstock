// @vitest-environment node
// Purity test for the ANONYMOUS-thread sender-name classifier. No DB
// involved — `anonymityFor` is a pure function over the lot row + sender
// id, and `maskedSenderName` is a pure function over the mode + raw
// name. Asserts the rule that locks the wire-side leak vector: a
// sender on an ANONYMOUS lot where the sender IS the lot poster gets
// masked to "the seller" — buyer/on-non-ANON identities stay intact.
import { describe, expect, it, vi } from 'vitest';

async function loadAnonymityModule() {
  vi.doMock('server-only', () => ({}));
  return import('../../src/lib/business/anonymity');
}

describe('anonymityFor()', () => {
  it('returns NONE for a non-ANONYMOUS lot regardless of sender', async () => {
    const { anonymityFor } = await loadAnonymityModule();
    for (const sender of ['user-a', 'user-b']) {
      expect(anonymityFor({ visibility: 'PUBLIC', postedByUserId: 'user-a' }, sender)).toBe('NONE');
      expect(anonymityFor({ visibility: 'MY_NETWORK', postedByUserId: 'user-a' }, sender)).toBe(
        'NONE',
      );
      expect(
        anonymityFor({ visibility: 'SELECTED_COMPANIES', postedByUserId: 'user-a' }, sender),
      ).toBe('NONE');
    }
  });

  it('returns ANONYMOUS_LOT_SIDE when the lot is ANONYMOUS and the sender is the lot poster', async () => {
    const { anonymityFor } = await loadAnonymityModule();
    expect(anonymityFor({ visibility: 'ANONYMOUS', postedByUserId: 'user-a' }, 'user-a')).toBe(
      'ANONYMOUS_LOT_SIDE',
    );
  });

  it('returns NONE for an ANONYMOUS lot when the sender is the buyer (identity is intentional for replies)', async () => {
    const { anonymityFor } = await loadAnonymityModule();
    expect(anonymityFor({ visibility: 'ANONYMOUS', postedByUserId: 'user-a' }, 'user-b')).toBe(
      'NONE',
    );
  });

  it('returns NONE for an ANONYMOUS lot posted anonymously (no userId) — no poster to mask', async () => {
    const { anonymityFor } = await loadAnonymityModule();
    expect(anonymityFor({ visibility: 'ANONYMOUS', postedByUserId: null }, 'anyone')).toBe('NONE');
  });

  it('returns NONE when there is no associated lot (broker-group room)', async () => {
    const { anonymityFor } = await loadAnonymityModule();
    expect(anonymityFor(null, 'user-a')).toBe('NONE');
  });
});

describe('maskedSenderName()', () => {
  it('masks to the seller-side label when ANONYMOUS_LOT_SIDE applies', async () => {
    const { ANONYMOUS_THREAD_SENDER, maskedSenderName } = await loadAnonymityModule();
    expect(maskedSenderName('ANONYMOUS_LOT_SIDE', 'Real Brokername')).toBe(ANONYMOUS_THREAD_SENDER);
  });

  it('falls back to ANONYMOUS_THREAD_SENDER even when the raw name is empty', async () => {
    const { ANONYMOUS_THREAD_SENDER, maskedSenderName } = await loadAnonymityModule();
    expect(maskedSenderName('ANONYMOUS_LOT_SIDE', null)).toBe(ANONYMOUS_THREAD_SENDER);
  });

  it('passes the real name through when mode is NONE', async () => {
    const { maskedSenderName } = await loadAnonymityModule();
    expect(maskedSenderName('NONE', 'Real Brokername')).toBe('Real Brokername');
  });

  it('falls back to "User" when mode is NONE and the raw name is empty', async () => {
    const { maskedSenderName } = await loadAnonymityModule();
    expect(maskedSenderName('NONE', undefined)).toBe('User');
  });
});
