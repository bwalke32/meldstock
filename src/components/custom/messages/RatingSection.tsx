// @polsia:user-owned — Post-completion rating section. Mounted inside
// <ThreadReady/> ONLY when:
//   - thread.kind is LISTING or RFQ (no buyer/seller pair ⇒ no rating);
//   - thread.status === 'COMPLETED' (PENDING ⇒ the MarkCompletedButton
//     is on the surface instead; CANCELED ⇒ no rating is possible at all).
//
// On mount it reads /api/ratings/status/<threadId> to learn which
// dimensions the caller has already scored. If all five ⇒ render the
// "You've rated this transaction" confirmation card. If <5 ⇒ render the
// <RatingForm/>. If the partner's profile subsequently shows their new
// aggregate, that update is independent of this view — the public
// /api/ratings/aggregate pull on `/u/<handle>` already re-reads on every
// profile mount and is re-listed when the dispatched `ratings:submitted`
// window event fires.
'use client';

import { CheckCircle2, ClipboardCheck, Star } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { RatingForm } from '@/components/custom/messages/RatingForm';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';
import type { ThreadDetail } from '@/lib/contracts/messaging';
import { type RatingStatus, RatingStatus as RatingStatusSchema } from '@/lib/contracts/ratings';

export interface RatingSectionProps {
  threadId: string;
  thread: ThreadDetail['thread'];
  onRated: () => void;
}

// Five-dimension set is the form's source of truth (the same set as the
// enum). Used here only to compute "all rated" cheaply.
const ALL_DIMS: ReadonlyArray<RatingStatus['ratedDimensions'][number]> = [
  'MATERIAL_MATCH',
  'DOCUMENTATION',
  'PAYMENT',
  'SHIPPING',
  'COMMUNICATION',
];

export function RatingSection({ threadId, thread, onRated }: RatingSectionProps) {
  const [status, setStatus] = useState<RatingStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    apiFetch(`/api/ratings/status/${encodeURIComponent(threadId)}`, { schema: RatingStatusSchema })
      .then((data) => {
        setStatus(data);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setLoadError(message);
      });
  }, [threadId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Refresh after the form fires its completion event so the confirmation
  // card appears without a full reload.
  useEffect(() => {
    function onSubmitted() {
      refresh();
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('ratings:submitted', onSubmitted);
      return () => window.removeEventListener('ratings:submitted', onSubmitted);
    }
    return undefined;
  }, [refresh]);

  // Suppress for now if the form is unavailable (room or no partner); the
  // caller is expected NOT to mount this component in those states.
  if (thread.kind === 'BROKER_GROUP') return null;

  const isCompleted = thread.threadStatus === 'COMPLETED';
  const ratedSet = new Set(status?.ratedDimensions ?? []);
  const allRated = ALL_DIMS.every((d) => ratedSet.has(d));

  return (
    <Card className="border-border bg-card shadow-sm">
      <CardHeader className="gap-2 border-b border-border">
        <div className="flex items-center gap-2">
          <Star aria-hidden="true" className="size-4 text-primary" />
          <span className="text-eyebrow text-primary">Rate this transaction</span>
        </div>
        <CardTitle className="font-display text-h4 tracking-[-0.02em]">
          {isCompleted
            ? allRated
              ? "You've rated this transaction"
              : `Rate ${thread.otherParty?.companyName ?? thread.otherParty?.displayName ?? 'your counterparty'}`
            : 'Waiting for close'}
        </CardTitle>
        <CardDescription>
          {isCompleted
            ? allRated
              ? 'Thanks — your scores update this user’s public trade profile as soon as your rating lands.'
              : 'Score all five dimensions. Your scores feed this user’s public rating profile.'
            : 'Once you mark the deal completed, you can score the counterparty across five dimensions.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-5">
        {loadError ? (
          <output className="text-[11px] text-destructive">
            Could not load rating status — try refreshing.
          </output>
        ) : status === null ? (
          <p className="text-sm text-muted-foreground">Loading rating status…</p>
        ) : allRated ? (
          <RatedConfirmation dimensions={Array.from(ratedSet)} onRated={onRated} />
        ) : (
          <RatingForm threadId={threadId} onSubmitted={onRated} />
        )}
      </CardContent>
    </Card>
  );
}

function RatedConfirmation({
  dimensions,
  onRated,
}: {
  dimensions: ReadonlyArray<RatingStatus['ratedDimensions'][number]>;
  onRated: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-brand-500/30 bg-brand-500/5 px-4 py-4">
      <div className="flex items-center gap-2">
        <CheckCircle2 aria-hidden="true" className="size-4 text-brand-600" />
        <span className="font-medium text-foreground">You’ve already rated this transaction.</span>
      </div>
      <ul className="flex flex-wrap items-center gap-2 text-[11px]">
        {dimensions.map((d) => (
          <li
            key={d}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-1 font-mono uppercase tracking-wider text-muted-foreground"
          >
            <ClipboardCheck aria-hidden="true" className="size-3" />
            {d}
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground">
        Ratings are one-shot per dimension per transaction. To fix a mistake, contact support —
        we’ll re-open the row.
      </p>
      <button
        type="button"
        onClick={onRated}
        className="self-start text-[11px] text-primary underline-offset-2 hover:underline"
      >
        Refresh status
      </button>
    </div>
  );
}
