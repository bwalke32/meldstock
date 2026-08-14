// @vitest-environment node
// Token-bucket test for the in-process rate limiter. Uses the injectable
// `now` parameter so the test stays deterministic without zone-faking
// dates. Asserts capacity, overflow, refill on the next window, and
// per-bucket isolation. The middleware / route handlers rely on these
// invariants, so the contract follows the inline presets table at
// @/lib/security/rate-limit.
import { describe, expect, it, vi } from 'vitest';

async function loadRateLimit() {
  vi.doMock('server-only', () => ({}));
  return import('../../src/lib/security/rate-limit');
}

describe('rate-limit token bucket', () => {
  const NOW = 1_700_000_000_000;

  function drain(
    fn: typeof import('../../src/lib/security/rate-limit').checkLimit,
    preset: import('../../src/lib/security/rate-limit').RatePreset,
    bucket: string,
    count: number,
    now: number,
  ) {
    const out: boolean[] = [];
    for (let i = 0; i < count; i += 1) {
      out.push(fn(preset, bucket, now + i * 1).allowed);
    }
    return out;
  }

  it('allows the first N requests up to capacity and 429s the (N+1)th', async () => {
    const { checkLimit, RATE_PRESETS } = await loadRateLimit();
    const cfg = RATE_PRESETS.upload;
    const bucket = `bucket-upload-${Math.random()}`;
    const results = drain(checkLimit, 'upload', bucket, cfg.capacity + 1, NOW);
    const allowed = results.filter(Boolean).length;
    expect(allowed).toBe(cfg.capacity);
    expect(results[cfg.capacity]).toBe(false);
  });

  it('returns a positive retryAfterMs when the bucket is dry', async () => {
    const { checkLimit, RATE_PRESETS } = await loadRateLimit();
    const bucket = `bucket-retry-${Math.random()}`;
    for (let i = 0; i < RATE_PRESETS.upload.capacity; i += 1) {
      checkLimit('upload', bucket, NOW + i * 1);
    }
    const claim = checkLimit('upload', bucket, NOW + RATE_PRESETS.upload.capacity + 1);
    expect(claim.allowed).toBe(false);
    expect(claim.retryAfterMs).toBeGreaterThan(0);
  });

  it('enforces the dedicated per-user AI burst allowance', async () => {
    const { checkLimit, RATE_PRESETS } = await loadRateLimit();
    const bucket = `bucket-ai-${Math.random()}`;
    const results = drain(checkLimit, 'aiChat', bucket, RATE_PRESETS.aiChat.capacity + 1, NOW);
    expect(results.slice(0, RATE_PRESETS.aiChat.capacity).every(Boolean)).toBe(true);
    expect(results[RATE_PRESETS.aiChat.capacity]).toBe(false);
  });

  it('refills after the refill window elapses (next request allowed)', async () => {
    const { checkLimit, RATE_PRESETS } = await loadRateLimit();
    const cfg = RATE_PRESETS.upload;
    const bucket = `bucket-refill-${Math.random()}`;
    for (let i = 0; i < cfg.capacity; i += 1) {
      checkLimit('upload', bucket, NOW + i * 1);
    }
    const refillElapsedMs = Math.ceil((cfg.capacity / cfg.refillPerSec) * 1000) + 50;
    const claim = checkLimit('upload', bucket, NOW + cfg.capacity + refillElapsedMs);
    expect(claim.allowed).toBe(true);
  });

  it('keeps (preset, bucket) tuples isolated — different buckets have independent windows', async () => {
    const { checkLimit, RATE_PRESETS } = await loadRateLimit();
    const bucketA = `bucket-a-${Math.random()}`;
    const bucketB = `bucket-b-${Math.random()}`;
    const cfg = RATE_PRESETS.upload;
    for (let i = 0; i < cfg.capacity; i += 1) {
      checkLimit('upload', bucketA, NOW + i * 1);
    }
    const a = checkLimit('upload', bucketA, NOW + cfg.capacity + 1);
    const b = checkLimit('upload', bucketB, NOW + cfg.capacity + 1);
    expect(a.allowed).toBe(false);
    expect(b.allowed).toBe(true);
  });

  it('keeps different PRESETS isolated — low-rate presets do not block higher-rate ones', async () => {
    const { checkLimit, RATE_PRESETS } = await loadRateLimit();
    const bucket = `bucket-cross-${Math.random()}`;
    const cfg = RATE_PRESETS.lotMessagesPost;
    for (let i = 0; i < cfg.capacity; i += 1) {
      checkLimit('lotMessagesPost', bucket, NOW + i * 1);
    }
    const lowClaim = checkLimit('lotMessagesPost', bucket, NOW + cfg.capacity + 1);
    const highClaim = checkLimit('listRead', bucket, NOW + cfg.capacity + 1);
    expect(lowClaim.allowed).toBe(false);
    expect(highClaim.allowed).toBe(true);
  });
});
