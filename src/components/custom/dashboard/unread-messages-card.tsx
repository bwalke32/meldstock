// @polsia:user-owned — dashboard "Unread messages" card. Pulls cross-thread
// unread summary from /api/messages/unread and renders a glance surface:
// big count + 3 most-recent active threads with sender + lot title + body
// preview + time-ago, each linking into the conversation.
//
// Layout: card goes between the metric tiles and the saved-searches card on
// the overview. Uses the existing DashboardCard primitive so the visual
// rhythm matches neighbouring tiles — same title + description + action slot
// pattern as SavedSearchesCard.
'use client';

import { Inbox } from 'lucide-react';
import Link from 'next/link';
import { DashboardCard } from '@/components/custom/dashboard/dashboard-card';
import { RfqLabel } from '@/components/custom/messages/rfq-label';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useMessagesUnread } from '@/hooks/use-messages-unread';
import { relativeAge } from '@/lib/business/lots';
import type { UnreadSummary } from '@/lib/contracts/messages-unread';

export function UnreadMessagesCard() {
  const { summary, isLoading, error } = useMessagesUnread();

  if (error) {
    return (
      <DashboardCard
        title="Unread messages"
        description="Latest threads waiting on a reply."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/messages">View inbox →</Link>
          </Button>
        }
      >
        <p className="text-caption text-muted-foreground">
          Couldn’t load unread messages right now — pull-to-refresh by reloading.
        </p>
      </DashboardCard>
    );
  }

  return (
    <DashboardCard
      title="Unread messages"
      description="Latest threads waiting on a reply."
      action={
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/messages">
            <Inbox className="mr-1 h-3 w-3" />
            View inbox
          </Link>
        </Button>
      }
    >
      <UnreadBody summary={summary} isLoading={isLoading} />
    </DashboardCard>
  );
}

function UnreadBody({ summary, isLoading }: { summary: UnreadSummary | null; isLoading: boolean }) {
  if (isLoading || summary === null) {
    return (
      <ul className="flex flex-col gap-2">
        <Skeleton className="h-16 w-full rounded-md" />
        <Skeleton className="h-16 w-full rounded-md" />
        <Skeleton className="h-16 w-full rounded-md" />
      </ul>
    );
  }

  if (summary.unreadCount === 0) {
    return (
      <div className="flex flex-col gap-2 text-body text-muted-foreground">
        <span>You’re caught up — no unread messages.</span>
        <span className="text-caption">
          Open{' '}
          <Link
            href="/dashboard/messages"
            className="font-mono text-foreground underline-offset-4 hover:underline"
          >
            Dashboard inbox
          </Link>{' '}
          to see your full inbox.
        </span>
      </div>
    );
  }

  const countLabel =
    summary.unreadCount === 1 ? '1 thread waiting' : `${summary.unreadCount} threads waiting`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-h2 leading-none tracking-[-0.02em] text-foreground tabular-nums">
          {summary.unreadCount}
        </span>
        <span className="text-caption text-muted-foreground">{countLabel}</span>
      </div>
      <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-md border border-border/60 bg-background">
        {summary.recent.map((row) => (
          <li key={row.threadId}>
            <Link
              href={`/dashboard/messages?thread=${row.threadId}`}
              className="flex flex-col gap-1 px-3 py-2 transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate font-mono text-[10px] uppercase tracking-wider text-primary">
                  {row.rfq ? (
                    // Row itself is the link to /dashboard/messages?thread=<id>;
                    // disable the inner back-link to /lots/<id> to avoid
                    // nested anchors.
                    <RfqLabel rfq={row.rfq} withLink={false} />
                  ) : (
                    row.lotTitle
                  )}
                </span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {relativeAge(row.lastMessageAt)}
                </span>
              </div>
              <span className="truncate text-body font-semibold text-foreground">
                {row.otherPartyName}
              </span>
              <span className="line-clamp-2 text-caption text-muted-foreground">
                {row.lastMessageBody}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
