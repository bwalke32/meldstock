// @polsia:user-owned — dashboard overview client island. Fetches the owner's
// counts + recent inventory from /api/dashboard/overview AND the saved-search
// list from /api/saved-searches, then renders: hero strip, metric tiles
// (HAVE / WANTED / open-RFQ), saved-searches card, inventory grid (or empty
// state), edit-profile footer link. 401 → /login; 500 → toast + inline.
'use client';

import { BookmarkPlus, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DashboardCard } from '@/components/custom/dashboard/dashboard-card';
import { LiveMarketPanel } from '@/components/custom/dashboard/live-market-panel';
import { MatchesPanel } from '@/components/custom/dashboard/matches-panel';
import { MetricTile } from '@/components/custom/dashboard/metric-tile';
import { UnreadMessagesCard } from '@/components/custom/dashboard/unread-messages-card';
import { LotCard } from '@/components/custom/lot-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch } from '@/lib/api-client';
import { useSession } from '@/lib/auth-client';
import {
  type DashboardOverview,
  DashboardOverview as DashboardOverviewSchema,
} from '@/lib/contracts/dashboard';
import { lotFilterToParams } from '@/lib/contracts/lots-filters';
import { type SavedSearch, SavedSearchList } from '@/lib/contracts/saved-searches';

const EMPTY: DashboardOverview = {
  metrics: { myHave: 0, myWanted: 0, openRfqCount: 0, interestMatched: false },
  recent: [],
};

export function DashboardOverviewClient() {
  const router = useRouter();
  const session = useSession();
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[] | null>(null);
  const errorEmittedRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch('/api/dashboard/overview', { schema: DashboardOverviewSchema })
      .then((d) => {
        if (active) {
          setData(d);
        }
      })
      .catch((err: unknown) => {
        if (!active) {
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        if (/\(401\)/.test(message)) {
          router.replace('/login');
          return;
        }
        setError(message);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    let active = true;
    const refetch = () => {
      // Explicit SavedSearchList.parse() at the boundary so the typed output
      // (filter fields fully required, including the defaulted ones) matches
      // the state shape. apiFetch's `?schema` API infers via ZodType<T> and
      // would otherwise bind T to the INPUT shape (all-optional) when the
      // schema uses defaults.
      void apiFetch('/api/saved-searches')
        .then((raw) => {
          if (!active) return;
          setSavedSearches(SavedSearchList.parse(raw).items);
        })
        .catch((err: unknown) => {
          if (!active) return;
          const message = err instanceof Error ? err.message : String(err);
          // 401 = outer redirect already; surface unexpected failures only.
          if (!/\(401\)/.test(message)) {
            setSavedSearches([]);
          }
        });
    };
    refetch();
    // Re-fetch when the dedicated /dashboard/saved-searches island mutates
    // a row (toggle alerts / edit / delete). Symmetrical with the
    // notifications:invalidate pattern.
    window.addEventListener('saved-searches:invalidate', refetch);
    return () => {
      active = false;
      window.removeEventListener('saved-searches:invalidate', refetch);
    };
  }, []);

  useEffect(() => {
    if (error && error !== errorEmittedRef.current) {
      errorEmittedRef.current = error;
      toast.error(error);
    }
  }, [error]);

  const metrics = data?.metrics ?? EMPTY.metrics;
  const recent = data?.recent ?? EMPTY.recent;
  const isEmpty = !loading && metrics.myHave + metrics.myWanted === 0 && recent.length === 0;
  const greetingName = session.data?.user?.name?.split(' ')[0];

  return (
    <div className="flex flex-col gap-8">
      <HeroStrip
        greetingName={greetingName ?? null}
        pending={session.isPending}
        hasError={Boolean(error) && !loading}
      />

      <section aria-label="Inventory metrics" className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {loading ? (
          <>
            <SkeletonTile />
            <SkeletonTile />
            <SkeletonTile />
          </>
        ) : (
          <>
            <MetricTile
              label="My HAVE"
              value={metrics.myHave}
              sublabel={metrics.myHave === 1 ? 'lot to sell' : 'lots to sell'}
              href="/lots?type=HAVE"
            />
            <MetricTile
              label="My WANTED"
              value={metrics.myWanted}
              sublabel={metrics.myWanted === 1 ? 'lot to buy' : 'lots to buy'}
              href="/lots?type=WANTED"
            />
            <MetricTile
              label="Open RFQs"
              value={metrics.openRfqCount}
              sublabel={metrics.interestMatched ? 'matching your interest' : 'open WANTEDs'}
              href="/lots?type=WANTED"
              accent={
                <span className="rounded-sm border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-300">
                  Wanted
                </span>
              }
            />
          </>
        )}
      </section>

      <LiveMarketPanel />

      <UnreadMessagesCard />

      <SavedSearchesCard searches={savedSearches} />

      <MatchesPanel />

      <section aria-label="Your inventory" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-eyebrow">Your inventory</span>
            <h2 className="font-display text-h3 leading-tight tracking-[-0.02em] text-foreground">
              Recent listings
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/post-a-lot">New listing →</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/inventory/upload">Bulk upload →</Link>
            </Button>
          </div>
        </div>
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-44 w-full rounded-xl" />
            <Skeleton className="h-44 w-full rounded-xl" />
            <Skeleton className="h-44 w-full rounded-xl" />
          </div>
        ) : isEmpty ? (
          <EmptyInventoryState />
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map((lot) => (
              <li key={lot.id} className="h-full">
                <LotCard lot={lot} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="flex flex-col gap-2 border-t border-border pt-4 text-caption text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>Profile, branding, and materials you can match — all editable in one place.</span>
        <Link
          href="/profile"
          className="font-mono text-[10px] uppercase tracking-wider text-primary underline-offset-4 hover:underline"
        >
          Edit profile →
        </Link>
      </footer>
    </div>
  );
}

// Saved-searches surface. Reuses the dashboard-shell card primitive so the
// visual rhythm matches the metric tiles / recent listings above. Each row
// carries the live matchCount from the API; "Apply" sends the user back to
// /lots with the saved filter pre-applied. The "Manage" CTA opens the
// /dashboard/saved-searches page (toggle alerts, edit, delete from one place).
function SavedSearchesCard({ searches }: { searches: SavedSearch[] | null }) {
  const isLoading = searches === null;
  const isEmpty = !isLoading && searches.length === 0;
  return (
    <DashboardCard
      title="Saved searches"
      description="Filter sets you saved on /lots — get an email when a match lands."
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard/saved-searches">Manage</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/lots">
              <BookmarkPlus className="mr-1 h-3 w-3" />
              New search
            </Link>
          </Button>
        </div>
      }
    >
      {isLoading ? (
        <ul className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
        </ul>
      ) : isEmpty ? (
        <p className="text-caption text-muted-foreground">
          No saved searches yet — open{' '}
          <Link
            href="/lots"
            className="font-mono text-foreground underline-offset-4 hover:underline"
          >
            /lots
          </Link>
          , tune the sidebar, then hit <em>Save this search</em>.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {searches.map((s) => {
            const params = lotFilterToParams(s.filter).toString();
            const href = params.length > 0 ? `/lots?${params}` : '/lots';
            return (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-background px-3 py-2"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-body font-medium text-foreground">{s.name}</span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {s.matchCount} {s.matchCount === 1 ? 'match' : 'matches'} ·{' '}
                    {summarizeFilter(s.filter)}
                  </span>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link href={href}>
                    Apply
                    <ChevronRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardCard>
  );
}

function summarizeFilter(f: SavedSearch['filter']): string {
  const bits: string[] = [];
  if (f.polymers.length > 0) bits.push(`${f.polymers.length} polymer`);
  if (f.conditions.length > 0) bits.push(`${f.conditions.length} cond`);
  if (f.form) bits.push(`form: ${f.form}`);
  if (f.grade) bits.push(`grade: ${f.grade}`);
  if (f.color) bits.push(`color: ${f.color}`);
  if (f.q) bits.push(`"${f.q}"`);
  if (f.mfrMin !== null || f.mfrMax !== null) {
    bits.push(`mfr ${f.mfrMin ?? 0}–${f.mfrMax ?? 100}`);
  }
  if (f.glassMin !== null || f.glassMax !== null) {
    bits.push(`glass ${f.glassMin ?? 0}–${f.glassMax ?? 70}%`);
  }
  if (f.recycledMin !== null || f.recycledMax !== null) {
    bits.push(`recycled ${f.recycledMin ?? 0}–${f.recycledMax ?? 100}%`);
  }
  return bits.length > 0 ? bits.join(' · ') : 'broad search';
}

function HeroStrip({
  greetingName,
  pending,
  hasError,
}: {
  greetingName: string | null;
  pending: boolean;
  hasError: boolean;
}) {
  return (
    <section className="flex flex-col gap-6 overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-brand-100 via-card to-card p-6 shadow-md md:p-8">
      <div className="flex flex-col gap-3">
        <span className="text-eyebrow">Your floor</span>
        <h1 className="font-display text-h2 leading-tight tracking-[-0.02em] text-foreground">
          {greetingName ? `Welcome back, ${greetingName}` : pending ? 'Loading dash…' : 'Dashboard'}
        </h1>
        <p className="max-w-2xl text-body text-muted-foreground">
          Post new inventory, watch open RFQs in your space, and pick up threads from the lot desk —
          all from one screen.
        </p>
        {hasError ? (
          <p className="max-w-2xl text-caption text-destructive">
            Couldn’t load your dashboard right now — pull-to-refresh by reloading.
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="default" size="lg">
          <Link href="/post-a-lot">Post a lot</Link>
        </Button>
        <Button asChild variant="ghost" size="lg">
          <Link href="/lots">Browse the floor →</Link>
        </Button>
      </div>
    </section>
  );
}

function SkeletonTile() {
  return <Skeleton className="h-32 w-full rounded-xl" />;
}

function EmptyInventoryState() {
  return (
    <Card className="border-border bg-card shadow-sm">
      <CardContent className="flex flex-col items-start gap-5 p-8">
        <div className="flex flex-col gap-2">
          <span className="text-eyebrow">Empty floor</span>
          <h3 className="font-display text-h3 leading-tight tracking-[-0.02em] text-foreground">
            The floor is yours.
          </h3>
          <p className="max-w-xl text-body text-muted-foreground">
            You haven’t listed anything yet — push the first lot from{' '}
            <span className="font-mono text-foreground">/post-a-lot</span> and you’ll see it land
            here.
          </p>
        </div>
        <Button asChild variant="default" size="lg">
          <Link href="/post-a-lot">Post your first lot →</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
