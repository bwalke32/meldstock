// @polsia:user-owned — polling hook for the dashboard notifications badge.
//
// Architecturally parallel to `useMessagesUnread` but with a longer cadence
// (30s active / 120s hidden) — the inbox isn't a chat, so 30s is plenty
// for an inbound event to be reflected in the badge count, and a hidden
// tab can stretch to 120s without missing the moment of relevance.
//
// On error it surfaces a string instead of throwing — the badge renders
// nothing (no count pill) and the next tick retries. 401 is the dashboard-
// redirect signal.
//
// Two invalidate signals:
//   - `notifications:invalidate` — fired by the inbox island after a
//     mark-read mutation (PATCH, mark-all-read) so this hook refreshes
//     immediately rather than waiting for the next interval tick.
//   - `messages-unread:invalidate` — fired elsewhere (e.g. an inbox island
//     in a different sub-route) so cross-island fan-out fires on the same
//     tick even if the source was a thread-side action.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { UnreadCount } from '@/lib/contracts/notifications';

const ACTIVE_INTERVAL_MS = 30_000;
const HIDDEN_INTERVAL_MS = 120_000;
const INVALIDATE_EVENT = 'notifications:invalidate';
const PEER_INVALIDATE_EVENT = 'messages-unread:invalidate';

export interface UseNotificationsUnreadOptions {
  intervalMs?: number;
  immediate?: boolean;
}

export interface UseNotificationsUnreadResult {
  count: number;
  isLoading: boolean;
  error: string | null;
  refreshNow: () => Promise<void>;
}

export function useNotificationsUnread({
  intervalMs = ACTIVE_INTERVAL_MS,
  immediate = true,
}: UseNotificationsUnreadOptions = {}): UseNotificationsUnreadResult {
  const [count, setCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(immediate);
  const [error, setError] = useState<string | null>(null);

  const refreshNow = useCallback(async () => {
    try {
      const data = await apiFetch('/api/notifications/unread-count', { schema: UnreadCount });
      setCount(data.count);
      setError(null);
    } catch {
      setError("Couldn't load notifications.");
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
      if (!active) return;
      refreshNow();
    };

    const scheduleNext = () => {
      const cadence = document.hidden ? HIDDEN_INTERVAL_MS : intervalMs;
      interval = setInterval(tick, cadence);
    };

    const onVisibility = () => {
      if (interval) clearInterval(interval);
      if (!document.hidden) tick();
      scheduleNext();
    };

    const onInvalidate = () => {
      if (!active) return;
      tick();
    };

    tick();
    scheduleNext();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener(INVALIDATE_EVENT, onInvalidate);
    window.addEventListener(PEER_INVALIDATE_EVENT, onInvalidate);

    return () => {
      active = false;
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener(INVALIDATE_EVENT, onInvalidate);
      window.removeEventListener(PEER_INVALIDATE_EVENT, onInvalidate);
    };
  }, [immediate, intervalMs, refreshNow]);

  return { count, isLoading, error, refreshNow };
}
