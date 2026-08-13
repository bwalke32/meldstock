// @polsia:user-owned — 'Matches for you' island on /dashboard overview.
// Renders the top-5 candidates returned by /api/dashboard/matches with a
// per-row one-line explanation + score. Empty state explains how to start
// matching (save a search from /lots).
//
// All data flows through `apiFetch('/api/dashboard/matches', { schema })` —
// this island never imports `@/lib/db` / `@prisma/client` / `server-only` /
// `next/headers`; the route handler owns the DB + AI calls.

'use client';

import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DashboardCard } from '@/components/custom/dashboard/dashboard-card';
import { ConditionChip, HaveChip, PolymerChip, WantedChip } from '@/components/custom/lot-chips';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch } from '@/lib/api-client';
import { conditionLabel, formatLb, polymerLabel, shortLotId } from '@/lib/business/lots';
import {
  type DashboardMatches,
  DashboardMatches as DashboardMatchesSchema,
  type MatchItem,
} from '@/lib/contracts/dashboard-matches';
import type { LotCondition, Polymer } from '@/lib/contracts/lots';

const EMPTY: DashboardMatches = { matches: [], totalCandidates: 0, fetchedAt: '' };

export function MatchesPanel() {
  const [data, setData] = useState<DashboardMatches | null>(null);

  useEffect(() => {
    let active = true;
    // Explicit parse at the boundary so the typed shape matches what the panel
    // renders — same pattern as the dashboard overview island.
    apiFetch('/api/dashboard/matches')
      .then((raw) => {
        if (!active) return;
        setData(DashboardMatchesSchema.parse(raw));
      })
      .catch(() => {
        // Transient AI hiccup is not actionable enough for a toast (mirror
        // LiveMarketPanel's policy). Surface the empty state so the panel
        // never blocks the rest of the dashboard.
        if (!active) return;
        setData(EMPTY);
      });
    return () => {
      active = false;
    };
  }, []);

  const matches = data?.matches ?? EMPTY.matches;
  const totalCandidates = data?.totalCandidates ?? 0;
  const isLoading = data === null;
  const isEmpty = !isLoading && matches.length === 0;

  return (
    <DashboardCard
      title="Matches for you"
      description="Listings we think fit your floor — scored from your saved searches and inventory."
      action={
        <Button asChild variant="ghost" size="sm">
          <Link href="/lots">
            <Sparkles className="mr-1 h-3 w-3" />
            See all
          </Link>
        </Button>
      }
    >
      {isLoading ? (
        <SkeletonList />
      ) : isEmpty ? (
        <EmptyState totalCandidates={totalCandidates} />
      ) : (
        <MatchList matches={matches} totalCandidates={totalCandidates} />
      )}
    </DashboardCard>
  );
}

function SkeletonList() {
  return (
    <ul className="flex flex-col gap-2">
      <li>
        <Skeleton className="h-12 w-full rounded-md" />
      </li>
      <li>
        <Skeleton className="h-12 w-full rounded-md" />
      </li>
      <li>
        <Skeleton className="h-12 w-full rounded-md" />
      </li>
      <li>
        <Skeleton className="h-12 w-full rounded-md" />
      </li>
      <li>
        <Skeleton className="h-12 w-full rounded-md" />
      </li>
    </ul>
  );
}

function EmptyState({ totalCandidates }: { totalCandidates: number }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-caption text-muted-foreground">
        {totalCandidates > 0
          ? `We scanned ${totalCandidates} listings but none were a strong match yet.`
          : 'Save a search from /lots and we’ll score new listings against it as they land.'}
      </p>
      <Button asChild variant="outline" size="sm">
        <Link href="/lots">Open the floor →</Link>
      </Button>
    </div>
  );
}

function MatchList({
  matches,
  totalCandidates,
}: {
  matches: MatchItem[];
  totalCandidates: number;
}) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-md border border-border/60 bg-background">
        {matches.map((m) => (
          <li key={m.lotId}>
            <MatchRow match={m} />
          </li>
        ))}
      </ul>
      <p className="text-caption text-muted-foreground">
        {matches.length === totalCandidates
          ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`
          : `Showing ${matches.length} of ${totalCandidates} top matches`}
      </p>
    </div>
  );
}

function MatchRow({ match }: { match: MatchItem }) {
  const polymer = polymerLabel(match.polymer as Polymer);
  const condition = conditionLabel(match.condition as LotCondition);
  const score = Math.round(match.matchScore * 100);
  return (
    <Link
      href={`/lots/${match.lotId}`}
      aria-label={`Open matched lot ${shortLotId({ id: match.lotId })}`}
      className="flex flex-col gap-1.5 px-3 py-2 transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {match.type === 'HAVE' ? <HaveChip label="HAVE" /> : <WantedChip label="WANTED" />}
        <PolymerChip label={polymer} />
        <ConditionChip label={condition} />
        <span className="ml-auto flex items-center gap-1 rounded-sm border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary">
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          {score}% match
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-caption text-muted-foreground">{match.reason}</p>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-foreground tabular-nums">
          {formatLb(match.quantityLb)}
        </span>
      </div>
    </Link>
  );
}
