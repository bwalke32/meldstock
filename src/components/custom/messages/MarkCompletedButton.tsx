// @polsia:user-owned — Mark-as-completed pill. Rendered inside <ThreadReady/>
// ONLY when the thread is a LISTING/RFQ (i.e. it has a buyer/seller pair)
// AND its `status` is still PENDING. PATCHes /api/threads/[id]/status with
// the chosen target status (COMPLETED to close the deal — this is what
// unlocks the partner's rating form — or CANCELED to abort without rating)
// and bumps a window event so <Thread/>'s parent effect re-fetches the
// detail endpoint and replays through ThreadReady with the new ribbon.
//
// Errors are surfaced via the same kind-first toast pattern used elsewhere
// in this repo (see messages/thread.tsx). Network/server errors stay toast-
// level — the caller's local state isn't preemptively mutated, so a failed
// PATCH leaves the pill usable for a retry.
'use client';

import { CheckCircle2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';

export interface MarkCompletedButtonProps {
  threadId: string;
}

export function MarkCompletedButton({ threadId }: MarkCompletedButtonProps) {
  const [pending, setPending] = useState<'COMPLETED' | 'CANCELED' | null>(null);

  async function flip(target: 'COMPLETED' | 'CANCELED') {
    if (pending !== null) return;
    setPending(target);
    try {
      await apiFetch(`/api/threads/${encodeURIComponent(threadId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: target }),
        // Caller doesn't depend on the response body — the dispatched
        // window event triggers a full detail re-fetch in <Thread/>.
      });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('thread-status:invalidate'));
      }
      if (target === 'COMPLETED') {
        toast.success('Deal closed. You can now rate the transaction.');
      } else {
        toast.success('Deal canceled.');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const body = (err as { cause?: { error?: string } } | undefined)?.cause;
      toast.error(body?.error ?? `Could not update deal status (${message}).`);
    } finally {
      setPending(null);
    }
  }

  return (
    <section
      aria-label="Update deal state"
      className="flex flex-wrap items-center gap-2 rounded-md border border-brand-500/30 bg-brand-500/5 px-3 py-2"
    >
      <span className="text-eyebrow text-brand-700">DEAL STATE · PENDING</span>
      <Button
        type="button"
        size="sm"
        variant="default"
        disabled={pending !== null}
        onClick={() => flip('COMPLETED')}
        aria-label="Mark this deal as completed"
      >
        <CheckCircle2 aria-hidden="true" className="mr-1.5 size-3.5" />
        {pending === 'COMPLETED' ? 'Closing…' : 'Mark as completed'}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending !== null}
        onClick={() => flip('CANCELED')}
        aria-label="Cancel this deal without rating"
      >
        <XCircle aria-hidden="true" className="mr-1.5 size-3.5" />
        {pending === 'CANCELED' ? 'Canceling…' : 'Cancel deal'}
      </Button>
    </section>
  );
}
