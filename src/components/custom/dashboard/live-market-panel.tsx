// @polsia:user-owned — "Live market" panel wired under the inventory
// summary cards on /dashboard. Two compact widgets reading directly from
// the live Lot table, no new schema:
//
//   1. Recently posted — the 5 most-recent marketplace rows visible to the
//      signed-in viewer. polymer / grade / quantity / time-ago.
//   2. Top polymers (7 days) — top 3 polymers by listing volume over a
//      rolling 7-day window with lot counts.
//
// The "Matches for you" surface now lives in its own dedicated panel
// (src/components/custom/dashboard/matches-panel.tsx) populated from
// /api/dashboard/matches, so this strip intentionally stays at two columns.
//
// All data flows through /api/dashboard/live-market — this island does NOT
// import the DB (Biome's noRestrictedImports rule enforces that), it just
// hydrates from the typed envelope.

'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DashboardCard } from '@/components/custom/dashboard/dashboard-card';
import { GradeChip, PolymerChip } from '@/components/custom/lot-chips';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch } from '@/lib/api-client';
import { polymerLabel, relativeAge } from '@/lib/business/lots';
import {
  LiveMarketSnapshot,
  type LiveMarketSnapshot as LiveMarketSnapshotT,
} from '@/lib/contracts/live-market';

const LB_FORMATTER = new Intl.NumberFormat('en-US');

function formatLb(raw: string | null | undefined): string {
  if (!raw) return '— lb';
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return '— lb';
  return `${LB_FORMATTER.format(value)} lb`;
}

export function LiveMarketPanel() {
  const [snapshot, setSnapshot] = useState<LiveMarketSnapshotT | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    apiFetch('/api/dashboard/live-market', { schema: LiveMarketSnapshot })
      .then((d) => {
        if (!active) return;
        setSnapshot(d);
        setLoaded(true);
      })
      .catch(() => {
        // Transient errors and 401s both degrade to empty state — the
        // fallback snapshot below drives the empty copy. We intentionally
        // don't surface a toast for this panel; a failed snippet is not
        // actionable enough to interrupt the rest of the dashboard.
        if (!active) return;
        setSnapshot({
          recent: [],
          topPolymers: [],
          fetchedAt: new Date().toISOString(),
        });
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section aria-label="Live market" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-eyebrow">Live market</span>
        <h2 className="font-display text-h3 leading-tight tracking-[-0.02em] text-foreground">
          What’s moving on the floor
        </h2>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <RecentlyPostedCard snapshot={snapshot} loaded={loaded} />
        <TopPolymersCard snapshot={snapshot} loaded={loaded} />
      </div>
    </section>
  );
}

function RecentlyPostedCard({
  snapshot,
  loaded,
}: {
  snapshot: LiveMarketSnapshotT | null;
  loaded: boolean;
}) {
  const recent = snapshot?.recent ?? [];
  const isEmpty = loaded && recent.length === 0;

  return (
    <DashboardCard title="Recently posted" description="Across the whole marketplace.">
      {!loaded ? (
        <ul className="flex flex-col gap-2">
          <Skeleton className="h-12 w-full rounded-md" />
          <Skeleton className="h-12 w-full rounded-md" />
        </ul>
      ) : isEmpty ? (
        <p className="text-caption text-muted-foreground">No lots posted yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-md border border-border/60 bg-background">
          {recent.map((row) => (
            <li key={row.id}>
              <Link
                href={`/lots/${row.id}`}
                className="flex flex-col gap-1.5 px-3 py-2 transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <PolymerChip label={polymerLabel(row.polymer)} />
                  {row.grade ? <GradeChip label={row.grade} /> : null}
                  <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-muted-foreground tabular-nums">
                    {formatLb(row.quantityLb)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-caption text-muted-foreground">
                    {row.manufacturer || row.color || row.form}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-foreground tabular-nums">
                    {relativeAge(row.createdAt)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}

function TopPolymersCard({
  snapshot,
  loaded,
}: {
  snapshot: LiveMarketSnapshotT | null;
  loaded: boolean;
}) {
  const rows = snapshot?.topPolymers ?? [];
  const isEmpty = loaded && rows.length === 0;

  return (
    <DashboardCard title="Top polymers (7 days)" description="Listing volume on the floor.">
      {!loaded ? (
        <ul className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
        </ul>
      ) : isEmpty ? (
        <p className="text-caption text-muted-foreground">No listings in the last 7 days.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-md border border-border/60 bg-background">
          {rows.map((row) => (
            <li key={row.polymer} className="flex items-center justify-between gap-3 px-3 py-2">
              <PolymerChip label={polymerLabel(row.polymer)} />
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground tabular-nums">
                {row.count} {row.count === 1 ? 'lot' : 'lots'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}
