// @polsia:user-owned — Public per-dimension rating aggregate card rendered
// on the public `/u/<handle>` profile. One row per dimension
// (MATERIAL_MATCH et al), stars out of 5 + a small rating count, plus an
// empty-state when the user has no rating history yet. Mounts high in the
// page (between the basic-info card and "Listings by <name>") so it sits
// in the SAME eye-line as the headline verification badge.
//
// Single round-trip to /api/ratings/aggregate/[userId] — the data plane
// only ships avg + count, no rater userIds, no per-thread context, and no
// commenter text. Consistent with the public posture of
// /api/profile/[handle].
'use client';

import { Star } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch } from '@/lib/api-client';
import {
  type RatingAggregate,
  RatingAggregate as RatingAggregateSchema,
  type RatingDimension,
} from '@/lib/contracts/ratings';

const DIMS: { key: RatingDimension; label: string }[] = [
  { key: 'MATERIAL_MATCH', label: 'Material match' },
  { key: 'DOCUMENTATION', label: 'Documentation' },
  { key: 'PAYMENT', label: 'Payment' },
  { key: 'SHIPPING', label: 'Shipping' },
  { key: 'COMMUNICATION', label: 'Communication' },
];

export interface RatingAggregateCardProps {
  userId: string;
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; aggregate: RatingAggregate }
  | { kind: 'error' };

export function RatingAggregateCard({ userId }: RatingAggregateCardProps) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    apiFetch(`/api/ratings/aggregate/${encodeURIComponent(userId)}`, {
      schema: RatingAggregateSchema,
    })
      .then((data) => {
        if (!active) return;
        setState({ kind: 'ready', aggregate: data });
      })
      .catch((err: unknown) => {
        if (!active) return;
        const status = err instanceof Error ? /\((\d{3})\)/.exec(err.message)?.[1] : undefined;
        if (status === '401') {
          router.replace('/login');
          return;
        }
        setState({ kind: 'error' });
      });

    // Re-fetch after a rate-submit event in the messaging island so the
    // partner's profile reflects their new score without a manual reload.
    function onSubmitted() {
      apiFetch(`/api/ratings/aggregate/${encodeURIComponent(userId)}`, {
        schema: RatingAggregateSchema,
      })
        .then((data) => {
          if (!active) return;
          setState({ kind: 'ready', aggregate: data });
        })
        .catch(() => undefined);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('ratings:submitted', onSubmitted);
    }
    return () => {
      active = false;
      if (typeof window !== 'undefined') {
        window.removeEventListener('ratings:submitted', onSubmitted);
      }
    };
  }, [router, userId]);

  const totalCount =
    state.kind === 'ready'
      ? DIMS.reduce((sum, d) => sum + (state.aggregate[d.key]?.count ?? 0), 0)
      : 0;

  return (
    <Card className="border-border bg-card/40">
      <CardHeader className="gap-2 border-b border-border">
        <div className="flex items-center gap-2">
          <Star aria-hidden="true" className="size-4 text-primary" />
          <span className="text-eyebrow text-primary">Trade ratings</span>
        </div>
        <CardTitle className="font-display text-h4 tracking-[-0.02em]">
          {totalCount === 0
            ? 'No ratings yet'
            : `${totalCount} rating${totalCount === 1 ? '' : 's'} from completed deals`}
        </CardTitle>
        <CardDescription>
          {totalCount === 0
            ? 'Scores from completed deals on this profile.'
            : 'Avg out of 5 across all completed deals. One rating per dimension per deal.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-5">
        {state.kind === 'loading' ? (
          <RatingSkeleton />
        ) : state.kind === 'error' ? (
          <p className="text-[11px] text-destructive">Couldn’t load ratings — try again.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {DIMS.map((d) => {
              const row = state.aggregate[d.key];
              if (row === undefined || row.count === 0) {
                return (
                  <li
                    key={d.key}
                    className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background px-3 py-2"
                  >
                    <span className="text-sm font-medium text-foreground">{d.label}</span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      no ratings
                    </span>
                  </li>
                );
              }
              const pct = (row.avg / 5) * 100;
              return (
                <li
                  key={d.key}
                  className="flex flex-col gap-1 rounded-md border border-border/60 bg-background px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-foreground">{d.label}</span>
                    <span className="font-mono text-[11px] text-foreground">
                      <span aria-hidden="true">★</span>
                      {row.avg.toFixed(1)}
                      <span className="text-muted-foreground">/5</span>{' '}
                      <span className="text-muted-foreground">
                        · {row.count} rating{row.count === 1 ? '' : 's'}
                      </span>
                    </span>
                  </div>
                  <div
                    className="h-1 w-full overflow-hidden rounded-full bg-muted"
                    role="presentation"
                  >
                    <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RatingSkeleton() {
  return (
    <ul className="flex flex-col gap-2">
      {[0, 1, 2, 3, 4].map((i) => (
        <li
          key={i}
          className="flex flex-col gap-1 rounded-md border border-border/60 bg-background px-3 py-2"
        >
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-20" />
          </div>
          <Skeleton className="h-1 w-full" />
        </li>
      ))}
    </ul>
  );
}
