// @polsia:user-owned — /trading-floor client island. Two-column desk layout:
// sticky posting form on the left, auto-refreshing feed on the right. Stacks on
// mobile (form first, feed below).
'use client';

import { useCallback, useMemo, useState } from 'react';
import { PostALotForm } from '@/components/custom/post-a-lot-form';
import { RecentLotsFeed } from '@/components/custom/recent-lots-feed';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useLotsFeed } from '@/hooks/use-lots-feed';
import { POLYMER_LABELS, polymerLabel } from '@/lib/business/lots';
import type { LotItem, Polymer } from '@/lib/contracts/lots';
import { cn } from '@/lib/utils';

type TypeFilter = 'ALL' | 'HAVE' | 'WANTED';

const POLYMER_KEYS = Object.keys(POLYMER_LABELS) as Array<keyof typeof POLYMER_LABELS>;

export function TradingFloor() {
  const { items, lastRefreshedAt } = useLotsFeed();
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [polymerFilter, setPolymerFilter] = useState<Set<Polymer>>(new Set());
  const [lastSeenTopId, setLastSeenTopId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return items.filter((lot) => {
      if (typeFilter !== 'ALL' && lot.type !== typeFilter) {
        return false;
      }
      if (polymerFilter.size > 0 && !polymerFilter.has(lot.polymer)) {
        return false;
      }
      return true;
    });
  }, [items, polymerFilter, typeFilter]);

  // Count items that arrived since the prior render's top id.
  const freshCount = useMemo(() => {
    if (!lastSeenTopId) {
      return 0;
    }
    const top = filtered[0]?.id;
    if (!top || top === lastSeenTopId) {
      return 0;
    }
    const idx = filtered.findIndex((lot) => lot.id === lastSeenTopId);
    if (idx < 0) {
      return 1;
    }
    return idx;
  }, [filtered, lastSeenTopId]);

  const rememberTop = useCallback(() => {
    const top = filtered[0]?.id ?? null;
    setLastSeenTopId(top);
  }, [filtered]);

  const togglePolymer = (key: Polymer) => {
    setPolymerFilter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const clearFilters = () => {
    setPolymerFilter(new Set());
    setTypeFilter('ALL');
  };

  const onCreated = useCallback((lot: LotItem) => {
    // Move the marker so the new lot registers as "fresh" in the feed.
    setLastSeenTopId((prev) => prev ?? lot.id);
  }, []);

  const totalAll = items.length;
  const haveCount = items.filter((l) => l.type === 'HAVE').length;
  const wantedCount = items.filter((l) => l.type === 'WANTED').length;

  return (
    <div className="container-page flex flex-col gap-6 py-section">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-2">
          <span className="text-eyebrow text-primary">Live · auto-refresh</span>
          <h1 className="font-display text-h2 leading-tight tracking-[-0.02em] text-foreground">
            Trading floor
          </h1>
          <p className="max-w-2xl text-body text-muted-foreground">
            The lot feed on the right polls every 5 seconds. New listings drop into the top of the
            stack with a brief pulse, so brokers pushing from the press cell collide with
            counterparties already watching the screen.
          </p>
        </div>
        <FloorClock />
      </header>

      <Toolbar
        typeFilter={typeFilter}
        onTypeChange={setTypeFilter}
        polymerFilter={polymerFilter}
        onTogglePolymer={togglePolymer}
        onClear={clearFilters}
        counts={{ all: totalAll, have: haveCount, wanted: wantedCount, shown: filtered.length }}
        onMarkSeen={rememberTop}
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,460px)_1fr]">
        <aside className="md:sticky md:top-20 md:self-start">
          <Card className="border-border bg-card shadow-sm">
            <CardHeader className="border-b border-border gap-1">
              <span className="text-eyebrow text-primary">Post a lot</span>
              <CardTitle className="font-display text-lg tracking-tight text-foreground">
                Push to the floor
              </CardTitle>
              <CardDescription>
                Captures the spec sheet — polymer, condition, color, form, MFR window in notes,
                price. ~90 seconds mobile.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              <PostALotForm onCreated={onCreated} compact />
            </CardContent>
          </Card>
        </aside>

        <section aria-label="Recent trades" className="flex flex-col gap-3">
          <RecentLotsFeed
            items={filtered}
            freshCount={freshCount}
            lastRefreshedAt={lastRefreshedAt}
          />
          <p className="text-[11px] text-muted-foreground">
            Polling slows to 30 s when the tab is hidden. Click any row to open the lot page and its
            private thread.
          </p>
        </section>
      </div>
    </div>
  );
}

function FloorClock() {
  // The clock represents "last refresh" so the trader sees the cadence.
  return (
    <div className="flex items-center gap-4 rounded-md border border-border bg-card/60 px-4 py-2 font-mono text-[11px] uppercase tracking-wider">
      <span className="flex items-center gap-2 text-primary">
        <span className="relative flex h-2 w-2">
          <span className="absolute inset-0 inline-flex h-2 w-2 live-dot-ping rounded-full bg-primary/60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
        LIVE
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="text-muted-foreground">auto-refresh · 5 s</span>
        <span className="text-foreground">cadence locked</span>
      </div>
    </div>
  );
}

interface ToolbarProps {
  typeFilter: TypeFilter;
  onTypeChange: (next: TypeFilter) => void;
  polymerFilter: Set<Polymer>;
  onTogglePolymer: (next: Polymer) => void;
  onClear: () => void;
  counts: { all: number; have: number; wanted: number; shown: number };
  onMarkSeen: () => void;
}

function Toolbar({
  typeFilter,
  onTypeChange,
  polymerFilter,
  onTogglePolymer,
  onClear,
  counts,
  onMarkSeen,
}: ToolbarProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/60 p-4 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-md border border-border bg-background p-1 font-mono text-[11px] uppercase tracking-wider">
          {(['ALL', 'HAVE', 'WANTED'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                onTypeChange(value);
                onMarkSeen();
              }}
              aria-pressed={typeFilter === value}
              className={cn(
                'rounded-sm px-3 py-1.5 transition-colors',
                typeFilter === value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              )}
            >
              {value} ·{' '}
              {value === 'ALL' ? counts.all : value === 'HAVE' ? counts.have : counts.wanted}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>
            Showing {counts.shown} of {counts.all}
          </span>
          {(typeFilter !== 'ALL' || polymerFilter.size > 0) && (
            <Button type="button" variant="ghost" size="sm" onClick={onClear}>
              Clear filters
            </Button>
          )}
        </div>
      </div>
      <fieldset
        className="flex flex-wrap items-center gap-1.5 border-0 p-0 m-0"
        aria-label="Polymer filter"
      >
        <legend className="sr-only">Polymer filter</legend>
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mr-1">
          polymer
        </span>
        {POLYMER_KEYS.map((key) => {
          const active = polymerFilter.has(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                onTogglePolymer(key);
                onMarkSeen();
              }}
              aria-pressed={active}
              className={cn(
                'rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors',
                active
                  ? 'border-primary/60 bg-primary/15 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted/40',
              )}
            >
              {polymerLabel(key)}
            </button>
          );
        })}
      </fieldset>
    </div>
  );
}
