// @polsia:user-owned — one-shot fetch hook for the /lots browse island.
// Pulls the filtered set once on mount. No polling here — the trading-floor
// page is the live-feed surface; /lots is the browse-and-filter surface
// and a silent re-fetch would mask the user's filter choices.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { type LotItem, LotList } from '@/lib/contracts/lots';
import { DEFAULT_FILTER, type LotFilter, lotFilterToParams } from '@/lib/contracts/lots-filters';

export interface UseLotsBrowseOptions {
  /** Initial filter parsed from the URL. Captured only on the first effect
   *  tick — subsequent prop changes are filtered client-side, not re-fetched. */
  initialFilter?: LotFilter;
  /** Run an initial fetch on mount. */
  immediate?: boolean;
}

export interface UseLotsBrowseResult {
  items: LotItem[];
  isLoading: boolean;
  error: string | null;
  /** Re-fetch with the captured initial filter (used by retry buttons). */
  refresh: () => Promise<void>;
}

export function useLotsBrowse({
  initialFilter,
  immediate = true,
}: UseLotsBrowseOptions = {}): UseLotsBrowseResult {
  const [items, setItems] = useState<LotItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(immediate);
  const [error, setError] = useState<string | null>(null);

  // useRef's argument is only evaluated on the first render — capture the
  // filter once. Even if the parent renders a new `initialFilter` object,
  // we still issue the fetch exactly once.
  const initialRef = useRef<LotFilter>(initialFilter ?? DEFAULT_FILTER);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const params = lotFilterToParams(initialRef.current);
      params.set('limit', String(initialRef.current.limit));
      const data = await apiFetch(`/api/lots?${params.toString()}`, { schema: LotList });
      setItems(data.items);
      setError(null);
    } catch {
      setError('Browse unavailable. Retry in a moment.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!immediate) {
      return;
    }
    void refresh();
  }, [immediate, refresh]);

  return { items, isLoading, error, refresh };
}
