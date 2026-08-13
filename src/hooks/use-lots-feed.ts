// @polsia:user-owned — polling hook for /api/lots. Slows down to 30s when the
// tab is hidden so multi-tenant usage stays sane.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { type LotItem, LotList } from '@/lib/contracts/lots';

const ACTIVE_INTERVAL_MS = 5_000;
const HIDDEN_INTERVAL_MS = 30_000;

export interface UseLotsFeedOptions {
  /** Override the polling cadence (ms) while the tab is visible. */
  intervalMs?: number;
  /** Run an initial fetch on mount. */
  immediate?: boolean;
}

export interface UseLotsFeedResult {
  items: LotItem[];
  isLoading: boolean;
  error: string | null;
  lastRefreshedAt: number | null;
  refreshNow: () => Promise<void>;
}

export function useLotsFeed({
  intervalMs = ACTIVE_INTERVAL_MS,
  immediate = true,
}: UseLotsFeedOptions = {}): UseLotsFeedResult {
  const [items, setItems] = useState<LotItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(immediate);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);

  const refreshNow = useCallback(async () => {
    try {
      const data = await apiFetch('/api/lots', { schema: LotList });
      setItems(data.items);
      setLastRefreshedAt(Date.now());
      setError(null);
    } catch {
      setError('Live feed unavailable.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!immediate) {
      return;
    }
    let active = true;
    let interval: ReturnType<typeof setInterval> | null = null;

    const tick = () => {
      if (!active) {
        return;
      }
      refreshNow();
    };

    const scheduleNext = () => {
      const cadence = document.hidden ? HIDDEN_INTERVAL_MS : intervalMs;
      interval = setInterval(tick, cadence);
    };

    const onVisibility = () => {
      if (interval) {
        clearInterval(interval);
      }
      if (!document.hidden) {
        // Refresh immediately when the tab regains focus so the user sees new items.
        tick();
      }
      scheduleNext();
    };

    tick();
    scheduleNext();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      active = false;
      if (interval) {
        clearInterval(interval);
      }
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [immediate, intervalMs, refreshNow]);

  return { items, isLoading, error, lastRefreshedAt, refreshNow };
}
