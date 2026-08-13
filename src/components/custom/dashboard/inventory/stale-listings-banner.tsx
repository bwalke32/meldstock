// @polsia:user-owned — /dashboard/inventory stale-nudge banner.
//
// Server reads are off, but this island GETs /api/lots/stale on mount so
// it lights up only when the viewer has ACTIVE listings that crossed the
// 30-day staleness window. The same predicate drives the cron, so the
// banner can't drift from the email. Each stale row gets a one-click
// "still have" confirm OR a "deactivate" button — both routes return 204
// and the banner refreshes itself.
'use client';

import { CheckCircle2, Clock4, Loader2, Pause, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';
import { relativeAge } from '@/lib/business/lots';
import { StaleLotsResponse } from '@/lib/contracts/lots-lifecycle';

type ViewState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | { kind: 'ready'; items: StaleLotsResponse['items'] };

export function StaleListingsBanner() {
  const [state, setState] = useState<ViewState>({ kind: 'loading' });
  const [pending, setPending] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const response = await apiFetch('/api/lots/stale', { schema: StaleLotsResponse });
      if (response.items.length === 0) setState({ kind: 'empty' });
      else setState({ kind: 'ready', items: response.items });
    } catch (err: unknown) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleConfirm = useCallback(
    async (id: string, title: string) => {
      setPending(`confirm:${id}`);
      try {
        await apiFetch(`/api/lots/${id}/confirm-available`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        toast.success(`Marked "${title}" as still available`);
        await refresh();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setPending(null);
      }
    },
    [refresh],
  );

  const handleDeactivate = useCallback(
    async (id: string, title: string) => {
      setPending(`deactivate:${id}`);
      try {
        await apiFetch(`/api/lots/${id}/deactivate`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        toast.success(`Deactivated "${title}"`);
        await refresh();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setPending(null);
      }
    },
    [refresh],
  );

  if (state.kind === 'loading') {
    return (
      <Card className="border-border/60 bg-card shadow-sm">
        <CardContent className="flex items-center gap-2 p-6 text-body text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking for stale listings…
        </CardContent>
      </Card>
    );
  }

  if (state.kind === 'error') {
    return (
      <Card className="border-warning/40 bg-warning/5 shadow-sm">
        <CardContent className="flex flex-col gap-2 p-6">
          <div className="flex items-center gap-2 text-body font-medium text-foreground">
            <Clock4 className="h-4 w-4 text-warning" />
            Stale-listing banner unavailable
          </div>
          <p className="break-all text-caption text-muted-foreground">{state.message}</p>
        </CardContent>
      </Card>
    );
  }

  if (state.kind === 'empty') return null;

  return (
    <Card className="border-warning/40 bg-warning/5 shadow-sm">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-h3 tracking-[-0.01em]">
            <span className="flex items-center gap-2 text-warning">
              <Clock4 className="h-5 w-5" />
              Listings need a check-in
            </span>
          </CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              setDismissed(state.kind === 'ready' ? (state.items[0]?.id ?? 'all') : 'all')
            }
            aria-label="Dismiss banner"
          >
            <X className="mr-1 h-4 w-4" />
            Dismiss
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-body text-muted-foreground">
          These ACTIVE listings have sat idle for over 30 days. Confirm ones you still have — the
          rest will be marked <span className="font-mono">EXPIRED</span> by the daily nudge.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {state.items.map((item) => {
            const busy = pending === `confirm:${item.id}` || pending === `deactivate:${item.id}`;
            const isThisDismissed = dismissed === item.id;
            return (
              <div
                key={item.id}
                className={
                  'flex flex-col gap-3 rounded-md border border-border bg-card p-4 shadow-sm' +
                  (isThisDismissed ? ' hidden' : '')
                }
              >
                <div className="flex flex-col gap-1">
                  <span className="text-body font-medium text-foreground">{item.title}</span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    L-{item.id.slice(-6)} · last touched {relativeAge(item.lastUpdatedAt)} ago
                  </span>
                  {item.staleness === 'expire' ? (
                    <span className="font-mono text-[10px] uppercase tracking-wider text-destructive">
                      Long-idle — auto-expire soon
                    </span>
                  ) : (
                    <span className="font-mono text-[10px] uppercase tracking-wider text-warning">
                      Idle 30+d
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleConfirm(item.id, item.title)}
                    disabled={busy}
                  >
                    {pending === `confirm:${item.id}` ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-1 h-4 w-4" />
                    )}
                    Still have this
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => void handleDeactivate(item.id, item.title)}
                    disabled={busy}
                  >
                    {pending === `deactivate:${item.id}` ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <Pause className="mr-1 h-4 w-4" />
                    )}
                    Deactivate
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
