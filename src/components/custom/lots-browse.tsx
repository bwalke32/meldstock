// @polsia:user-owned — top-level client island for /lots. Owns the filter
// state, mirrors it to the URL via replace (no scroll, no history entry),
// pulls the in-memory fetched set once via use-lots-browse, and applies the
// rest of the filter set client-side for instant narrowing without a
// refetch.
//
// Also owns the saved-searches list (GET /api/saved-searches on mount) and
// dispatches save/delete through the sidebar. anonymous callers hit a 401
// on the GET; the sidebar still renders the save/list UI and degrades by
// prompting sign-in on save.
'use client';

import { Filter } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';
import { LotsFilterSidebar } from '@/components/custom/lots-filter-sidebar';
import { LotsGrid } from '@/components/custom/lots-grid';
import { ResinChips } from '@/components/custom/resin-chips';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useLotsBrowse } from '@/hooks/use-lots-browse';
import { apiFetch } from '@/lib/api-client';
import { activeFilterCount, matchesLotFilter } from '@/lib/business/lot-filters';
import {
  mergeParsedIntoFilter,
  type ParsedResin,
  parseResinQuery,
} from '@/lib/business/resin-abbreviations';
import {
  DEFAULT_FILTER,
  type LotFilter,
  lotFilterToParams,
  parseLotFilter,
} from '@/lib/contracts/lots-filters';
import {
  type SavedSearch,
  SavedSearchCreate,
  SavedSearchList,
  SavedSearch as SavedSearchSchema,
} from '@/lib/contracts/saved-searches';

export function LotsBrowse() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [filter, setFilter] = React.useState<LotFilter>(() =>
    parseLotFilter(new URLSearchParams(searchParams.toString())),
  );
  // Sidebar-driven baseline. The input parser merges INTO the latest sidebar
  // value (union arrays, parsed scalars override) so clearing the input
  // reverts to whatever the sidebar holds. Without this, typing then erasing
  // would leave stale parsed chips in the URL.
  const sidebarBaselineRef = React.useRef<LotFilter>(filter);

  // The hook is intentionally one-shot; it captures `filter` on first mount
  // in a ref. Subsequent filter changes (sidebar toggles) only mutate
  // client-side intersection — no refetch.
  const { items, isLoading, error } = useLotsBrowse({ initialFilter: filter });

  // --- Resin-abbreviation search bar ----------------------------------
  // Local query state mirrors the input without round-tripping through
  // LotFilter — the parser picks out structured values and merges them into
  // the sidebar baseline. Free-text leftovers in `query` stay in the input
  // only because the sidebar's own `q` field is the right home for them.
  const [query, setQuery] = React.useState('');
  const [parsedResin, setParsedResin] = React.useState<ParsedResin | null>(null);

  // Debounced input → parser. 250ms matches the controlled-text rhythm in
  // the sidebar. The effect reads sidebarBaselineRef.current at call time
  // so fresh sidebar toggles between keystrokes are picked up.
  React.useEffect(() => {
    const handle = window.setTimeout(() => {
      const trimmed = query.trim();
      const parsed = trimmed.length > 0 ? parseResinQuery(trimmed) : null;
      setParsedResin(parsed);
      const baseline = sidebarBaselineRef.current;
      const next = parsed ? mergeParsedIntoFilter(baseline, parsed) : baseline;
      setFilter((prev) =>
        lotFilterToParams(prev).toString() === lotFilterToParams(next).toString() ? prev : next,
      );
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query]);

  // --- Sidebar change → update both visible filter and baseline ref.
  const handleSidebarChange = React.useCallback((next: LotFilter) => {
    sidebarBaselineRef.current = next;
    setFilter(next);
  }, []);

  // Saved-searches state. Always fetched on mount; an anonymous caller
  // receives a 401 and stays at an empty list — the sidebar's save form
  // still works and surfaces a sign-in prompt on POST.
  const [savedSearches, setSavedSearches] = React.useState<SavedSearch[]>([]);
  const [savedSearchError, setSavedSearchError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    // Parse at the boundary so the state matches SavedSearch's T (with every
    // filter field required). Passing `?schema` to apiFetch would bind T to
    // the SCHEMA'S INPUT type, which leaves defaulted fields optional and
    // mismatches the state.
    void apiFetch('/api/saved-searches')
      .then((raw) => {
        if (!active) return;
        setSavedSearches(SavedSearchList.parse(raw).items);
      })
      .catch((err: unknown) => {
        if (!active) {
          return;
        }
        // 401 is expected for anonymous callers — that's "empty list", not
        // a real error.
        const message = err instanceof Error ? err.message : String(err);
        if (!/\(401\)/.test(message)) {
          setSavedSearchError(message);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    if (savedSearchError) {
      toast.error(savedSearchError);
      setSavedSearchError(null);
    }
  }, [savedSearchError]);

  const handleSaveSearch = React.useCallback(
    async (name: string) => {
      try {
        const payload = SavedSearchCreate.parse({ name, filter });
        const createdRaw = await apiFetch('/api/saved-searches', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        const created = SavedSearchSchema.parse(createdRaw);
        setSavedSearches((prev) => [created, ...prev]);
        toast.success(`Saved “${created.name}”. We'll email you on a match.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/\(401\)/.test(message)) {
          router.replace('/login');
          return;
        }
        toast.error(message);
      }
    },
    [filter, router],
  );

  const handleDeleteSavedSearch = React.useCallback(
    async (id: string) => {
      const before = savedSearches;
      // Optimistic remove — restore on failure.
      setSavedSearches((prev) => prev.filter((s) => s.id !== id));
      try {
        // No schema — DELETE returns `{ ok: true }` and we don't read it. The
        // 2xx status is what we care about; apiFetch throws on non-OK.
        await apiFetch(`/api/saved-searches/${id}`, { method: 'DELETE' });
      } catch (err) {
        setSavedSearches(before);
        const message = err instanceof Error ? err.message : String(err);
        toast.error(message);
      }
    },
    [savedSearches],
  );

  // Mirror filter → URL on every change (replace, no scroll, no history).
  // Empty filter drops the search string entirely so the canonical hub URL
  // is `/lots`.
  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const params = lotFilterToParams(filter);
    const qs = params.toString();
    const next = qs.length > 0 ? `/lots?${qs}` : '/lots';
    const current = window.location.pathname + window.location.search;
    if (current !== next) {
      router.replace(next, { scroll: false });
    }
  }, [filter, router]);

  // In-memory intersection — filters NOT applied server-side (mfr range,
  // glass, recycled, flame, certs) get matched here, plus a final pass so
  // the server-side keys remain authoritative even if their `where` was
  // relaxed for a typed-input race.
  const visible = React.useMemo(
    () => items.filter((lot) => matchesLotFilter(lot, filter)),
    [items, filter],
  );

  // Friendlier error feedback on the initial fetch failure. Subsequent
  // filter toggles don't refetch, so we emit at most once.
  const errorEmittedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (error && error !== errorEmittedRef.current) {
      errorEmittedRef.current = error;
      toast.error(error);
    }
  }, [error]);

  const onClear = React.useCallback(() => {
    sidebarBaselineRef.current = DEFAULT_FILTER;
    setFilter(DEFAULT_FILTER);
  }, []);

  const activeCount = activeFilterCount(filter);

  return (
    <div className="container-page flex flex-col gap-6 py-section">
      <header className="flex flex-col gap-3">
        <span className="text-eyebrow text-primary">Browse · filter · open</span>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-h2 leading-tight tracking-[-0.02em] text-foreground">
              Lots
            </h1>
            <p className="max-w-2xl text-body text-muted-foreground">
              Every active HAVE and WANTED posting. Fuse chips, grades, colors, and notes with the
              sidebar — uppercase narration matches the trading desk.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Showing {visible.length} of {items.length}
              {isLoading ? ' · loading' : ''}
            </span>
            <Button asChild variant="outline" size="sm">
              <Link href="/trading-floor">Live feed →</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/post-a-lot">Post a lot →</Link>
            </Button>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[260px_minmax(0,1fr)]">
        {/* Desktop sidebar */}
        <aside className="hidden md:block">
          <LotsFilterSidebar
            filter={filter}
            totalLoaded={items.length}
            visibleCount={visible.length}
            onChange={handleSidebarChange}
            onClear={onClear}
            savedSearches={savedSearches}
            onSaveSearch={handleSaveSearch}
            onDeleteSavedSearch={handleDeleteSavedSearch}
          />
        </aside>

        {/* Mobile filter trigger + sheet */}
        <div className="flex items-center justify-between gap-3 md:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="h-9">
                <Filter className="mr-2 h-4 w-4" />
                Filters {activeCount > 0 ? `· ${activeCount}` : ''}
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="flex w-full max-w-md flex-col gap-0 overflow-y-auto p-0"
              aria-describedby={undefined}
            >
              <SheetHeader className="border-b border-border px-4 py-4">
                <SheetTitle className="text-left text-base">Filters</SheetTitle>
              </SheetHeader>
              <div className="p-4">
                <LotsFilterSidebar
                  filter={filter}
                  totalLoaded={items.length}
                  visibleCount={visible.length}
                  onChange={handleSidebarChange}
                  onClear={onClear}
                  savedSearches={savedSearches}
                  onSaveSearch={handleSaveSearch}
                  onDeleteSavedSearch={handleDeleteSavedSearch}
                />
              </div>
            </SheetContent>
          </Sheet>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {visible.length} / {items.length}
          </span>
        </div>

        <section aria-label="Lots" className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="resin-search"
              className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground"
            >
              Resin shorthand
            </label>
            <Input
              id="resin-search"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. PA66 GF33 BK · ABS FR V0 · PC GF20 NAT · PPH 12 MFI"
              className="h-10 font-mono text-[12px] placeholder:text-[11px]"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-[11px] text-muted-foreground">
              Type industry shorthand — we&apos;ll parse polymer, glass %, color, melt-flow, and
              flame into a filter that merges with the sidebar.
            </p>
          </div>
          <ResinChips chips={parsedResin?.chips ?? null} />
          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          <LotsGrid items={visible} />
        </section>
      </div>
    </div>
  );
}
