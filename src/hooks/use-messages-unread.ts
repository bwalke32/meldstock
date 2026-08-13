// @polsia:user-owned — polling hook for the /dashboard unread widget.
//
// Less aggressive cadence than `useLotMessages`: a top-of-dashboard glance
// doesn't need 5s freshness; 15s while visible is plenty for a counterparty's
// reply to register, and a hidden tab can stretch to 60s without anyone
// noticing.
//
// On error it surfaces a string instead of throwing — the card renders an
// error state and the next tick retries. 401 is the dashboard-redirect
// signal (unmount before the next paint is fine).
//
// `messages-unread:invalidate` — a window event fired by the `<Thread/>`
// island whenever a participant is added to a thread. The widget refreshes
// immediately so the freshly-added user (who isn't in any other user's
// inbox yet) starts being counted toward their own unread total on the
// very next paint rather than waiting for the next interval tick.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import {
  type UnreadSummary,
  UnreadSummary as UnreadSummarySchema,
} from '@/lib/contracts/messages-unread';

const ACTIVE_INTERVAL_MS = 15_000;
const HIDDEN_INTERVAL_MS = 60_000;
const INVALIDATE_EVENT = 'messages-unread:invalidate';

export interface UseMessagesUnreadOptions {
  intervalMs?: number;
  immediate?: boolean;
}

export interface UseMessagesUnreadResult {
  summary: UnreadSummary | null;
  isLoading: boolean;
  error: string | null;
  refreshNow: () => Promise<void>;
}

export function useMessagesUnread({
  intervalMs = ACTIVE_INTERVAL_MS,
  immediate = true,
}: UseMessagesUnreadOptions = {}): UseMessagesUnreadResult {
  const [summary, setSummary] = useState<UnreadSummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(immediate);
  const [error, setError] = useState<string | null>(null);

  const refreshNow = useCallback(async () => {
    try {
      const data = await apiFetch('/api/messages/unread', { schema: UnreadSummarySchema });
      setSummary(data);
      setError(null);
    } catch {
      setError('Couldn’t load unread messages.');
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
        tick();
      }
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

    return () => {
      active = false;
      if (interval) {
        clearInterval(interval);
      }
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener(INVALIDATE_EVENT, onInvalidate);
    };
  }, [immediate, intervalMs, refreshNow]);

  return { summary, isLoading, error, refreshNow };
}
