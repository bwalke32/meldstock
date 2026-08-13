// @polsia:user-owned — lot-lifecycle business logic. Server-only helpers used
// from the owner-facing `/api/lots/**` handlers (refresh / mark-sold /
// deactivate / confirm-available / bulk / patch / stale) AND from the
// `jobs/stale-nudge.js` cron, so the staleness window + bump semantics
// stay in lockstep across the API + the scheduled job.
//
// Cadence:
//   - "Stale" = `lastUpdatedAt < now - 30d` AND (no prior nudge OR nudge
//     predates the last refresh by 30d). The cron re-nudges on this
//     boundary; the dashboard stale-banner surfaces the same set.
//   - "Fresh / nudge / expire" — three-state badge text used in the table.
//
// `touchLotBump` stamps `lastUpdatedAt: new Date()` on EVERY owner write,
// so the next staleness query reflects all reasonable activity (refresh,
// edit-qty, mark-sold, deactivate, confirm-available, bulk-across-those).

import 'server-only';
import { prisma } from '@/lib/db';

// One source of truth for how long a lot can sit idle before we call it
// stale. Used by both the cron and the dashboard stale-banner endpoint so
// they never disagree about which lots to surface.
export const STALENESS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type Staleness = 'fresh' | 'nudge' | 'expire';

/**
 * Three-text summary used as a badge in the dashboard table AND as the
 * staleness pass / fail predicate in the cron. Pure — safe to import
 * from a client island without dragging Prisma.
 */
export function computeStaleness(
  lastUpdatedAt: Date | string | null | undefined,
  now: number = Date.now(),
): Staleness {
  if (!lastUpdatedAt) return 'expire';
  const stamp =
    typeof lastUpdatedAt === 'string'
      ? Date.parse(lastUpdatedAt)
      : (lastUpdatedAt.getTime?.() ?? Number.NaN);
  if (!Number.isFinite(stamp)) return 'expire';
  const elapsed = now - stamp;
  if (elapsed < STALENESS_WINDOW_MS) return 'fresh';
  // We coarse-bin "we should re-nudge" into one bucket for the badge UI;
  // the actual re-nudge decision is gated on `lastNudgedAt` elsewhere.
  return elapsed < 2 * STALENESS_WINDOW_MS ? 'nudge' : 'expire';
}

// Predicate form used by the GET /api/lots/stale handler AND the cron — one
// place that answers "should this lot appear in the staleness list?" so the
// dashboard banner and the daily nudge agree.
export function isStaleLotRow(
  row: {
    status: string;
    lastUpdatedAt: Date | null;
    lastNudgedAt: Date | null;
  },
  now: number = Date.now(),
): boolean {
  if (row.status !== 'ACTIVE') return false;
  if (!row.lastUpdatedAt) return false;
  const stamp = row.lastUpdatedAt.getTime();
  if (!Number.isFinite(stamp)) return false;
  if (now - stamp < STALENESS_WINDOW_MS) return false;
  // Idempotency: don't re-nudge inside the cooldown.
  if (row.lastNudgedAt) {
    const nudged = row.lastNudgedAt.getTime();
    if (Number.isFinite(nudged) && now - nudged < STALENESS_WINDOW_MS) return false;
  }
  return true;
}

/**
 * `lastUpdatedAt` stamp, applied to every owner write. Returns the
 * `{ lastUpdatedAt }` fragment so the caller can merge it into a Prisma
 * `update({ data })` without rethinking the bump semantics.
 */
export function touchLotBump(): { lastUpdatedAt: Date } {
  return { lastUpdatedAt: new Date() };
}

/**
 * Owner-scoped staleness list — feeds the `StaleListingsBanner` island. Read
 * via the (postedByUserId, status) index; the per-lot filter applies the
 * 30-day window so the second-pass filter at the API is cheap.
 */
export async function getMyStaleLots(userId: string, now: number = Date.now()) {
  const rows = await prisma.lot.findMany({
    where: {
      postedByUserId: userId,
      status: 'ACTIVE',
      lastUpdatedAt: { lt: new Date(now - STALENESS_WINDOW_MS) },
      // OR — re-nudge when no previous nudge OR the previous nudge is also
      // inside the stale window. Real Prisma supports OR at the root, so
      // shape it once here.
      OR: [{ lastNudgedAt: null }, { lastNudgedAt: { lt: new Date(now - STALENESS_WINDOW_MS) } }],
    },
    orderBy: { lastUpdatedAt: 'asc' },
  });
  return rows.filter((r) => isStaleLotRow(r, now));
}
