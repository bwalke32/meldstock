// @polsia:user-owned — polling hook for the per-lot message thread.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { type LotMessage, LotMessageList } from '@/lib/contracts/lots';

const ACTIVE_INTERVAL_MS = 5_000;
const HIDDEN_INTERVAL_MS = 30_000;

export interface UseLotMessagesOptions {
  intervalMs?: number;
  immediate?: boolean;
}

export interface UseLotMessagesResult {
  messages: LotMessage[];
  isLoading: boolean;
  error: string | null;
  refreshNow: () => Promise<void>;
}

export function useLotMessages(
  lotId: string,
  { intervalMs = ACTIVE_INTERVAL_MS, immediate = true }: UseLotMessagesOptions = {},
): UseLotMessagesResult {
  const [messages, setMessages] = useState<LotMessage[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(immediate);
  const [error, setError] = useState<string | null>(null);

  const refreshNow = useCallback(async () => {
    try {
      const data = await apiFetch(`/api/lots/${encodeURIComponent(lotId)}/messages`, {
        schema: LotMessageList,
      });
      setMessages(data.items);
      setError(null);
    } catch {
      setError('Thread unavailable.');
    } finally {
      setIsLoading(false);
    }
  }, [lotId]);

  useEffect(() => {
    if (!immediate) {
      return;
    }
    if (!lotId) {
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
  }, [immediate, intervalMs, lotId, refreshNow]);

  return { messages, isLoading, error, refreshNow };
}
