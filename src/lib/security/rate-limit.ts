// @polsia:user-owned — in-process token-bucket rate limiter.
//
// The brief asks for an HTTP-level rate-limit gate but the catalog has
// no tier-1 module for it, so we hand-write one. Per-route presets map
// to capacity + refill-per-second so a chatty endpoint (per-IP uploads,
// per-user mutations) tightens without breaking list reads.
//
// Storage is process-local (a Map keyed on `${preset}:${bucket}`). In a
// multi-instance deploy each worker enforces independently — accepted
// for the audit-and-fix brief. Future hardening (Redis-backed bucket)
// is explicitly out of scope here.
//
// The middleware slot (proxy.ts#middleware_chain) wires the limiter so
// non-/api routes can call it from inside middleware; /api route
// handlers keep their own auth + authz and call `checkLimit` at the
// top so the limit fires *before* any DB work. Each call is also
// structured enough that the recorder can stamp `RATE_LIMITED` audit
// rows for the 429 path so spikes become observable, not silent.
import 'server-only';

const buckets = new Map<string, { tokens: number; lastRefill: number }>();

export interface LimitConfig {
  capacity: number;
  refillPerSec: number;
}

// Presets, keyed by route class. Add a row before adding a new route
// to the limit-list above. Values are: capacity = burst allowance,
// refillPerSec = sustained per-second drip.
export const RATE_PRESETS = {
  // Anonymous-heavy: per-IP, per-lot public message thread.
  lotMessagesPost: { capacity: 5, refillPerSec: 5 / 60 } as LimitConfig,
  // Per-user thread messages — rate-limits per (userId, threadId).
  threadMessagesPost: { capacity: 20, refillPerSec: 20 / 60 } as LimitConfig,
  // Per-IP auth POSTs (login / signup) — broad-brush brute-force gate.
  authPost: { capacity: 10, refillPerSec: 10 / 60 } as LimitConfig,
  // Per-user mutations on profile / dashboard / saved-searches.
  userMutation: { capacity: 30, refillPerSec: 30 / 60 } as LimitConfig,
  // Per-user uploads (attachments + document uploads).
  upload: { capacity: 10, refillPerSec: 10 / 60 } as LimitConfig,
  // Per-user metered AI relay calls.
  aiChat: { capacity: 8, refillPerSec: 8 / 60 } as LimitConfig,
  // Per-user list reads.
  listRead: { capacity: 60, refillPerSec: 60 / 60 } as LimitConfig,
  // Per-user anonymised-fan-out (notifications GET / inbox refresh).
  notificationsRead: { capacity: 60, refillPerSec: 60 / 60 } as LimitConfig,
  // Catch-all default for misc.
  default: { capacity: 120, refillPerSec: 120 / 60 } as LimitConfig,
} as const;

export type RatePreset = keyof typeof RATE_PRESETS;

export interface CheckLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
}

export function checkLimit(
  preset: RatePreset,
  bucket: string,
  now: number = Date.now(),
): CheckLimitResult {
  const cfg = RATE_PRESETS[preset];
  const key = `${preset}:${bucket}`;
  const existing = buckets.get(key);
  const state = existing ?? { tokens: cfg.capacity, lastRefill: now };
  // Refill based on elapsed wall-clock since the last sample.
  const elapsed = (now - state.lastRefill) / 1000;
  state.tokens = Math.min(cfg.capacity, state.tokens + elapsed * cfg.refillPerSec);
  state.lastRefill = now;
  if (state.tokens < 1) {
    const retryAfterMs = Math.max(0, Math.ceil(((1 - state.tokens) / cfg.refillPerSec) * 1000));
    buckets.set(key, state);
    return { allowed: false, retryAfterMs };
  }
  state.tokens -= 1;
  buckets.set(key, state);
  return { allowed: true };
}

// Convenience: extract the caller's identity for the bucket key.
// `userId` is preferred when present (authed callers); otherwise fall
// through to chained IP resolution (X-Forwarded-For → X-Real-IP → null).
export function rateBucketFor(req: Request, userId: string | null, suffix: string): string {
  if (userId) return `u:${userId}:${suffix}`;
  return `ip:${extractIp(req) ?? 'unknown'}:${suffix}`;
}

export function extractIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() ?? null;
  const xrip = req.headers.get('x-real-ip');
  if (xrip) return xrip.trim();
  return null;
}
