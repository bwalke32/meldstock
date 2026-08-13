// @polsia:user-owned — GET /api/lots/stale.
//
// Owner-only. Lists ACTIVE lots owned by the caller that have sat idle past
// the staleness window (see `isStaleLotRow` in @/lib/business/lot-lifecycle)
// and either have never been nudged OR were nudged long enough ago that
// re-nudging is safe (drives the dashboard `StaleListingsBanner` island
// AND the stale-nudge cron — both query the same predicate).
import 'server-only';
import { NextResponse } from 'next/server';
import { computeStaleness, getMyStaleLots } from '@/lib/business/lot-lifecycle';
import { StaleLotsResponse } from '@/lib/contracts/lots-lifecycle';
import { requireAuth } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

function lotTitle(polymer: string, manufacturer: string | null, grade: string | null): string {
  const name = [manufacturer, grade].filter(Boolean).join(' ');
  return name.length > 0 ? name : polymer;
}

export async function GET(_req: Request) {
  let userId: string;
  try {
    userId = (await requireAuth()).id;
  } catch (res) {
    return res as Response;
  }

  const rows = await getMyStaleLots(userId);

  const items = rows.map((row) => ({
    id: row.id,
    title: lotTitle(row.polymer, row.manufacturer, row.grade),
    lastUpdatedAt: row.lastUpdatedAt.toISOString(),
    lastNudgedAt: row.lastNudgedAt ? row.lastNudgedAt.toISOString() : null,
    staleness: computeStaleness(row.lastUpdatedAt),
  }));

  return NextResponse.json(StaleLotsResponse.parse({ items }), { status: 200 });
}
