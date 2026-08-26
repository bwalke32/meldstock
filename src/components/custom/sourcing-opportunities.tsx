'use client';

import { BellRing, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { LotsGrid } from '@/components/custom/lots-grid';
import { ResinChips } from '@/components/custom/resin-chips';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLotsBrowse } from '@/hooks/use-lots-browse';
import { matchesLotFilter } from '@/lib/business/lot-filters';
import {
  mergeParsedIntoFilter,
  parseResinQuery,
} from '@/lib/business/resin-abbreviations';
import { normalizeResinInput } from '@/lib/business/resin-normalize';
import { DEFAULT_FILTER, type LotFilter } from '@/lib/contracts/lots-filters';

const WANTED_FILTER: LotFilter = { ...DEFAULT_FILTER, type: 'WANTED', limit: 100 };

export function SourcingOpportunities() {
  const { items, isLoading, error, refresh } = useLotsBrowse({ initialFilter: WANTED_FILTER });
  const [query, setQuery] = React.useState('');
  const [location, setLocation] = React.useState('');

  const parsed = React.useMemo(() => parseResinQuery(query), [query]);
  const normalized = React.useMemo(
    () => normalizeResinInput(query, { mode: 'search' }),
    [query],
  );
  const filter = React.useMemo(() => {
    const withQuery = parsed ? mergeParsedIntoFilter(WANTED_FILTER, parsed) : WANTED_FILTER;
    return {
      ...withQuery,
      grade: normalized.gradeCanonical ?? '',
      q: parsed || normalized.gradeCanonical ? '' : query.trim(),
      location: location.trim(),
    };
  }, [location, normalized.gradeCanonical, parsed, query]);

  const visible = React.useMemo(
    () => items.filter((lot) => lot.type === 'WANTED' && matchesLotFilter(lot, filter)),
    [filter, items],
  );

  return (
    <main className="container-page py-section">
      <header className="grid gap-6 border-b border-border pb-8 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <span className="text-eyebrow">For resin sourcing specialists</span>
          <h1 className="mt-3 font-display text-h1 leading-[1.02] text-foreground">
            Qualified material requests.
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-muted-foreground">
            Search open injection-molding needs by resin shorthand and delivery region. Open a
            request to respond privately with an exact grade, a qualified equivalent, or a sourcing
            path.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/lots?type=WANTED">
            <BellRing className="mr-2 size-4" aria-hidden />
            Create a match alert
          </Link>
        </Button>
      </header>

      <section className="mt-8" aria-label="Open sourcing opportunities">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <div className="grid gap-4 md:grid-cols-[1fr_0.55fr_auto] md:items-end">
            <div className="space-y-2">
              <label
                htmlFor="opportunity-resin"
                className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Resin, grade, or shorthand
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="opportunity-resin"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="PA66 GF33 BK · C6600 · PBT V-0"
                  className="h-11 pl-10 font-mono text-sm"
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label
                htmlFor="opportunity-location"
                className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Delivery region
              </label>
              <Input
                id="opportunity-location"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="Chicago · Midwest · Mexico"
                className="h-11"
                autoComplete="off"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => void refresh()}
              disabled={isLoading}
            >
              <RefreshCw className={`mr-2 size-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden />
              Refresh
            </Button>
          </div>

          <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <ResinChips chips={parsed?.chips ?? null} />
            <p className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {isLoading ? 'Loading requests' : `${visible.length} matching request${visible.length === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>

        {error ? (
          <div className="mt-5 flex items-center justify-between gap-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <span>{error}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
              Retry
            </Button>
          </div>
        ) : null}

        {!isLoading && !error && visible.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-border bg-muted/25 px-6 py-12 text-center">
            <ShieldCheck className="mx-auto size-8 text-primary" aria-hidden />
            <h2 className="mt-4 font-display text-xl font-semibold text-foreground">
              No open requests match this exact filter.
            </h2>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
              Widen the resin or region search, or create a saved alert so the next relevant request
              comes to you instead of making you hunt for it.
            </p>
            <Button asChild className="mt-5">
              <Link href="/lots?type=WANTED">Create a match alert</Link>
            </Button>
          </div>
        ) : null}

        {visible.length > 0 ? (
          <div className="mt-6">
            <LotsGrid items={visible} />
          </div>
        ) : null}
      </section>
    </main>
  );
}
