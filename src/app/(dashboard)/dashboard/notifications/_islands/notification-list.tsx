// @polsia:user-owned — client island for /dashboard/notifications.
//
// Reverse-chronological inbox of every event that already fires email
// fan-out (saved-search match, new thread message, RFQ reply on own
// posting). Two row kinds:
//
//   - SAVED_SEARCH_MATCH — "your saved search \"<name>\" matched a new
//     listing", links to /lots with the matched filter pre-applied.
//   - THREAD_MESSAGE — "<sender> sent a message", links to the dashboard
//     inbox at /dashboard/messages?thread=<id>. RFQ replies flag a
//     distinct label because the originating listing is the user's own.
//
// Polish:
//   - "Mark all read" header button → POST /api/notifications/mark-all-read.
//   - Clicking any row → PATCH /api/notifications/[id]/read (idempotent),
//     then router.push to the underlying surface — so the row collapses to
//     "read" the next time the list is fetched, AND the badge counter drops.
//   - Polls /api/notifications every 30s visible / 120s hidden. Listens
//     for both `notifications:invalidate` (own mutations) and
//     `messages-unread:invalidate` (peer islands).
//   - Discards `nextCursor === null` so no extra fetch fires on the last
//     page.
//
// Narrowing: `payload` arrives as `unknown`. Each row narrows via a kind-
// keyed zod schema so a contract drift throws loudly instead of silently
// rendering ["Object object"] in the row text.
'use client';

import { Bell, Check, Inbox as InboxIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch } from '@/lib/api-client';
import { useSession } from '@/lib/auth-client';
import { relativeAge } from '@/lib/business/lots';
import { LotFilter, lotFilterToParams } from '@/lib/contracts/lots-filters';
import {
  type NotificationItem,
  NotificationList as NotificationListSchema,
} from '@/lib/contracts/notifications';

const INVALIDATE_EVENT = 'notifications:invalidate';
const PEER_INVALIDATE_EVENT = 'messages-unread:invalidate';
const ACTIVE_INTERVAL_MS = 30_000;
const HIDDEN_INTERVAL_MS = 120_000;

// Per-kind payload schemas — the kind enum is the discriminator. Each one
// is a defensive parse so a stale payload shape throws openly rather than
// silently rendering.
const SavedSearchMatchPayload = z.object({
  lotId: z.string(),
  savedSearchNames: z.array(z.string()),
  sampleFilter: LotFilter,
});
const ThreadMessagePayload = z.object({
  threadId: z.string(),
  messageId: z.string(),
  senderName: z.string(),
  isRfqReply: z.boolean(),
});

type Narrowed =
  | { kind: 'SAVED_SEARCH_MATCH'; payload: z.infer<typeof SavedSearchMatchPayload> }
  | { kind: 'THREAD_MESSAGE'; payload: z.infer<typeof ThreadMessagePayload> };

function narrow(item: NotificationItem): Narrowed | null {
  if (item.kind === 'SAVED_SEARCH_MATCH') {
    const parsed = SavedSearchMatchPayload.safeParse(item.payload);
    return parsed.success ? { kind: 'SAVED_SEARCH_MATCH', payload: parsed.data } : null;
  }
  if (item.kind === 'THREAD_MESSAGE') {
    const parsed = ThreadMessagePayload.safeParse(item.payload);
    return parsed.success ? { kind: 'THREAD_MESSAGE', payload: parsed.data } : null;
  }
  return null;
}

export function NotificationInbox() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'empty' }
    | { kind: 'error' }
    | { kind: 'ready'; items: NotificationItem[]; nextCursor: string | null }
  >({ kind: 'loading' });

  // Redirect unauth callers — the dashboard shell already does this but
  // having a belt here covers the brief transition state where useSession
  // resolves before the shell effect fires.
  useEffect(() => {
    if (isPending) return;
    if (!session?.user) router.replace('/login');
  }, [isPending, router, session?.user]);

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch('/api/notifications', { schema: NotificationListSchema });
      if (data.items.length === 0) {
        setState({ kind: 'empty' });
      } else {
        setState({ kind: 'ready', items: data.items, nextCursor: data.nextCursor });
      }
    } catch {
      setState({ kind: 'error' });
    }
  }, []);

  // Initial fetch + interval polling. The hook re-runs `refresh` whenever
  // the user transitions to authed.
  useEffect(() => {
    if (isPending || !session?.user) return;
    let active = true;
    let interval: ReturnType<typeof setInterval> | null = null;

    const tick = () => {
      if (!active) return;
      void refresh();
    };

    const scheduleNext = () => {
      const cadence = document.hidden ? HIDDEN_INTERVAL_MS : ACTIVE_INTERVAL_MS;
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
  }, [isPending, refresh, session?.user]);

  // PATCH a row read + dispatch invalidate so the badge refetches. Done
  // BEFORE the router.push so the badge clears the moment the inbound
  // nav lands at the destination (rather than after).
  const markRead = useCallback((id: string) => {
    void apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' })
      .catch(() => {})
      .finally(() => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event(INVALIDATE_EVENT));
        }
      });
  }, []);

  const markAllRead = useCallback(async () => {
    try {
      await apiFetch('/api/notifications/mark-all-read', { method: 'POST' });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(INVALIDATE_EVENT));
      }
      await refresh();
    } catch {
      // swallow; the next tick re-tries
    }
  }, [refresh]);

  // Click a SAVED_SEARCH_MATCH → /lots?q=<saved-search-name>&<matched-filter>
  // (the `?q=` seeds the input with the watch name so the matched lot lands
  // on the result grid even on a fresh empty filter)
  const targetForSavedSearchMatch = (payload: z.infer<typeof SavedSearchMatchPayload>): string => {
    const params = lotFilterToParams(payload.sampleFilter);
    const primary = payload.savedSearchNames[0];
    if (primary) params.set('q', primary);
    const qs = params.toString();
    return qs.length > 0 ? `/lots?${qs}` : '/lots';
  };

  // Click a THREAD_MESSAGE → existing /dashboard/messages?thread=<id> route
  // (the right pane reads `?thread` and reuses <Thread/>).
  const targetForThreadMessage = (payload: z.infer<typeof ThreadMessagePayload>): string =>
    `/dashboard/messages?thread=${encodeURIComponent(payload.threadId)}`;

  const navigateAndMark = useCallback(
    (id: string, href: string) => {
      markRead(id);
      router.push(href);
    },
    [markRead, router],
  );

  if (isPending || state.kind === 'loading') return <InboxSkeleton />;

  if (!session?.user) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="py-10 text-sm text-muted-foreground">
          Redirecting to sign in…
        </CardContent>
      </Card>
    );
  }

  const unreadCount =
    state.kind === 'ready' ? state.items.filter((i) => i.readAt === null).length : 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-h2 tracking-[-0.02em]">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            {state.kind === 'ready'
              ? unreadCount === 0
                ? 'You’re caught up — nothing unread.'
                : `${unreadCount} unread of ${state.items.length} on this page.`
              : 'New messages, RFQ replies, and saved-search matches — reverse chronological.'}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void markAllRead()}
          disabled={state.kind !== 'ready' || unreadCount === 0}
        >
          <Check aria-hidden="true" className="mr-1 size-3.5" />
          Mark all read
        </Button>
      </header>

      {state.kind === 'error' ? (
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="font-display text-h3 tracking-tight">
              Couldn’t load notifications
            </CardTitle>
            <CardDescription>Try again in a moment.</CardDescription>
          </CardHeader>
        </Card>
      ) : state.kind === 'empty' ? (
        <EmptyState />
      ) : (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          {state.items.map((item) => {
            const narrowed = narrow(item);
            const unread = item.readAt === null;
            const age = relativeAge(item.createdAt);
            return (
              <li key={item.id}>
                <NotificationRow
                  item={item}
                  narrowed={narrowed}
                  unread={unread}
                  age={age}
                  navigateAndMark={navigateAndMark}
                  targetForSavedSearchMatch={targetForSavedSearchMatch}
                  targetForThreadMessage={targetForThreadMessage}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function NotificationRow({
  item,
  narrowed,
  unread,
  age,
  navigateAndMark,
  targetForSavedSearchMatch,
  targetForThreadMessage,
}: {
  item: NotificationItem;
  narrowed: Narrowed | null;
  unread: boolean;
  age: string;
  navigateAndMark: (id: string, href: string) => void;
  targetForSavedSearchMatch: (payload: z.infer<typeof SavedSearchMatchPayload>) => string;
  targetForThreadMessage: (payload: z.infer<typeof ThreadMessagePayload>) => string;
}) {
  const baseClass =
    'flex w-full items-start gap-3 px-5 py-4 text-left transition-colors focus-visible:outline-none';

  if (narrowed === null) {
    // Schema drift — the row exists but the payload is unrecognised.
    // Surface the kind so an operator can spot the regression instead of
    // silently rendering nothing.
    return (
      <div className={`${baseClass} cursor-default bg-background`}>
        <Bell aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm text-foreground">Unknown notification: {item.kind}</span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {age}
          </span>
        </div>
      </div>
    );
  }

  if (narrowed.kind === 'SAVED_SEARCH_MATCH') {
    const target = targetForSavedSearchMatch(narrowed.payload);
    const primaryName = narrowed.payload.savedSearchNames[0] ?? 'your saved search';
    const more = narrowed.payload.savedSearchNames.length - 1;
    return (
      <button
        type="button"
        onClick={() => navigateAndMark(item.id, target)}
        className={
          unread
            ? `${baseClass} hover:bg-primary/[0.06] focus-visible:bg-primary/[0.06] border-l-2 border-primary bg-primary/[0.04]`
            : `${baseClass} hover:bg-accent/40 focus-visible:bg-accent/40 bg-card`
        }
      >
        <Bell aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm font-medium text-foreground">
            Saved search “{primaryName}”{more > 0 ? ` + ${more} more` : ''} matched a new listing.
          </span>
          <span className="text-caption text-muted-foreground">
            {unread ? 'Unread' : 'Read'} ·{' '}
            <Link
              href={target}
              onClick={(e) => e.stopPropagation()}
              className="underline-offset-4 hover:underline"
            >
              Open lot list with your filter applied →
            </Link>
          </span>
        </div>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {age}
        </span>
      </button>
    );
  }

  // THREAD_MESSAGE
  const { senderName, isRfqReply } = narrowed.payload;
  const target = targetForThreadMessage(narrowed.payload);
  const lead = isRfqReply
    ? `${senderName} replied to your WANTED posting.`
    : `${senderName} sent you a message.`;
  return (
    <button
      type="button"
      onClick={() => navigateAndMark(item.id, target)}
      className={
        unread
          ? `${baseClass} hover:bg-primary/[0.06] focus-visible:bg-primary/[0.06] border-l-2 border-primary bg-primary/[0.04]`
          : `${baseClass} hover:bg-accent/40 focus-visible:bg-accent/40 bg-card`
      }
    >
      <InboxIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm font-medium text-foreground">{lead}</span>
        <span className="text-caption text-muted-foreground">
          {unread ? 'Unread' : 'Read'} ·{' '}
          <Link
            href={target}
            onClick={(e) => e.stopPropagation()}
            className="underline-offset-4 hover:underline"
          >
            Open conversation →
          </Link>
        </span>
      </div>
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {age}
      </span>
    </button>
  );
}

function EmptyState() {
  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="font-display text-h3 tracking-tight">No notifications yet</CardTitle>
        <CardDescription>
          New thread messages, replies to your WANTED postings, and saved-search matches will land
          here as they happen — you’ll get a badge in the sidebar whenever one comes in.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/lots">Browse the trading floor →</Link>
        </Button>
        <Button asChild size="sm">
          <Link href="/dashboard/messages">Open messages</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function InboxSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-4 w-72" />
      <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        {[0, 1, 2].map((i) => (
          <li key={`row-${i}`} className="flex items-start gap-3 px-5 py-4">
            <Skeleton className="mt-0.5 size-4 shrink-0 rounded" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-72" />
              <Skeleton className="h-3 w-48" />
            </div>
            <Skeleton className="h-3 w-12" />
          </li>
        ))}
      </ul>
    </div>
  );
}
