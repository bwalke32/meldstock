// @polsia:user-owned — /dashboard/network client island. Manages the caller's
// "My network" of connections (the backing set for MY_NETWORK visibility
// tier on lot postings).
//
// State machine: loading / empty / ready / error / submitting.
//   Add: typed handle OR email → optimistic insert, toast on failure with
//        revert. Server is the source of truth on duplicate handling.
//   Remove: optimistic removal + restore on failure.
//
// The page is rendered server-side by `(dashboard)/dashboard/network/page.tsx`
// which is just a metadata shell + DashboardShell redirect for anon users.
'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch } from '@/lib/api-client';
import { useSession } from '@/lib/auth-client';
import {
  ConnectionActionResponse,
  ConnectionDecisionInput,
  type ConnectionItem,
  ConnectionList,
  CreateConnectionInput,
  RemoveConnectionInput,
} from '@/lib/contracts/connections';

export function NetworkManagement() {
  const router = useRouter();
  const session = useSession();
  const [items, setItems] = useState<ConnectionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [draft, setDraft] = useState('');
  const errorEmittedRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch('/api/connections', { schema: ConnectionList })
      .then((d) => {
        if (active) setItems(d.items);
      })
      .catch((err: unknown) => {
        if (!active) return;
        const message = err instanceof Error ? err.message : String(err);
        if (/\(401\)/.test(message)) {
          router.replace('/login');
          return;
        }
        setError(message);
      });
    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (error && error !== errorEmittedRef.current) {
      errorEmittedRef.current = error;
      toast.error(error);
    }
  }, [error]);

  async function handleAdd() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const parsed = CreateConnectionInput.parse({ identifier: trimmed });
      const res = await apiFetch<ConnectionActionResponse>('/api/connections', {
        method: 'POST',
        body: JSON.stringify(parsed),
        schema: ConnectionActionResponse,
      });
      if (!res.ok) {
        toast.error('Could not add to network');
        return;
      }
      // Re-pull the list so the new row's denormalised values (handle,
      // displayName, companyName, email, createdAt) come from the server.
      // Local optimistic insert can leave the row stale.
      const refreshed = await apiFetch('/api/connections', { schema: ConnectionList });
      setItems(refreshed.items);
      setDraft('');
      toast.success('Connection request sent.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const cause = (err as { cause?: { error?: string } })?.cause;
      toast.error(
        (cause?.error ?? /already|network|exist|self/i.test(message))
          ? message
          : 'Could not add to network',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDecision(item: ConnectionItem, action: 'ACCEPT' | 'REJECT') {
    setSubmitting(true);
    try {
      const parsed = ConnectionDecisionInput.parse({ connectionId: item.id, action });
      await apiFetch<ConnectionActionResponse>('/api/connections', {
        method: 'PATCH',
        body: JSON.stringify(parsed),
        schema: ConnectionActionResponse,
      });
      const refreshed = await apiFetch('/api/connections', { schema: ConnectionList });
      setItems(refreshed.items);
      toast.success(action === 'ACCEPT' ? 'Connection accepted.' : 'Connection request rejected.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(item: ConnectionItem) {
    setSubmitting(true);
    const backup = items;
    setItems((prev) => (prev ? prev.filter((p) => p.id !== item.id) : prev));
    try {
      const parsed = RemoveConnectionInput.parse({ connectionId: item.id });
      await apiFetch<ConnectionActionResponse>('/api/connections', {
        method: 'DELETE',
        body: JSON.stringify(parsed),
        schema: ConnectionActionResponse,
      });
      toast.success(
        item.direction === 'OUTGOING' ? 'Connection request canceled.' : 'Connection removed.',
      );
    } catch (err) {
      // Restore on failure — the server is the source of truth.
      setItems(backup);
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  const isLoading = items === null && !error;
  const isEmpty = !isLoading && (items?.length ?? 0) === 0;
  const meEmail = session.data?.user?.email ?? null;
  const incoming = items?.filter((item) => item.direction === 'INCOMING') ?? [];
  const outgoing =
    items?.filter(
      (item) => item.direction === 'OUTGOING' || item.direction === 'RECONFIRMATION_REQUIRED',
    ) ?? [];
  const accepted = items?.filter((item) => item.direction === 'ACCEPTED') ?? [];

  return (
    <div className="flex flex-col gap-6">
      <NetworkHero myEmail={meEmail} />

      <Card className="border-border/70 shadow-sm">
        <CardContent className="flex flex-col gap-4 p-6">
          <div className="flex flex-col gap-1">
            <Label htmlFor="add-identifier" className="text-sm font-medium">
              Send a connection request
            </Label>
            <p className="text-[0.8rem] text-muted-foreground">
              Identify a trusted trading contact by handle or email. Access begins only after
              acceptance.
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              id="add-identifier"
              autoComplete="off"
              placeholder="@acme-polymers · buyer@acme.com"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleAdd();
                }
              }}
              className="h-11 flex-1"
              disabled={submitting}
            />
            <Button
              type="button"
              onClick={() => void handleAdd()}
              disabled={submitting || draft.trim().length === 0}
              className="h-11 shrink-0"
            >
              {submitting ? 'Sending…' : 'Connect'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-sm">
        <CardContent className="flex flex-col gap-3 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">Trusted network</h2>
            {items ? (
              <span className="text-[0.8rem] text-muted-foreground">
                {items.length === 1 ? '1 contact' : `${items.length} contacts`}
              </span>
            ) : null}
          </div>
          {isLoading ? (
            <ul className="flex flex-col gap-2">
              <Skeleton className="h-14 w-full rounded-md" />
              <Skeleton className="h-14 w-full rounded-md" />
              <Skeleton className="h-14 w-full rounded-md" />
            </ul>
          ) : isEmpty ? (
            <EmptyState />
          ) : (
            <div className="flex flex-col gap-5">
              {[
                { title: 'Incoming requests', rows: incoming },
                { title: 'Outgoing / pending', rows: outgoing },
                { title: 'Accepted connections', rows: accepted },
              ].map((section) => (
                <section key={section.title} className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold text-foreground">{section.title}</h3>
                  {section.rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">None.</p>
                  ) : null}
                  <ul className="flex flex-col gap-2">
                    {section.rows.map((c) => (
                      <li
                        key={c.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background p-3"
                      >
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate text-sm font-medium text-foreground">
                            {c.displayName ?? c.handle ?? c.email ?? 'Unnamed contact'}
                          </span>
                          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                            {c.handle ? `@${c.handle}` : ''}
                            {c.handle && c.companyName ? ' · ' : ''}
                            {c.companyName ? c.companyName : ''}
                            {c.handle || c.companyName ? ' · ' : ''}
                            {c.email ? c.email : ''}
                          </span>
                          <span className="text-xs font-medium text-muted-foreground">
                            {c.direction === 'ACCEPTED'
                              ? 'Connected'
                              : c.direction === 'RECONFIRMATION_REQUIRED'
                                ? 'Reconfirmation required'
                                : 'Pending'}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          {c.direction === 'INCOMING' ? (
                            <>
                              <Button
                                size="sm"
                                type="button"
                                onClick={() => void handleDecision(c, 'ACCEPT')}
                                disabled={submitting}
                              >
                                Accept
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                type="button"
                                onClick={() => void handleDecision(c, 'REJECT')}
                                disabled={submitting}
                              >
                                Reject
                              </Button>
                            </>
                          ) : null}
                          {c.direction !== 'INCOMING' ? (
                            <Button
                              variant="outline"
                              size="sm"
                              type="button"
                              onClick={() => void handleRemove(c)}
                              disabled={submitting}
                            >
                              {c.direction === 'OUTGOING' ? 'Cancel' : 'Remove'}
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="rounded-md border border-border/60 bg-muted/20 p-4 text-[0.85rem] text-muted-foreground">
        <strong className="font-semibold text-foreground">How visibility works.</strong> A lot set
        to <em>“My network”</em> is visible only to accepted connections. Pending and legacy
        reconfirmation-required relationships do not grant access. A lot set to{' '}
        <em>“Selected companies”</em> is gated separately per posting — the handles/emails you type
        into the form’s chip-list at post time, not this central list.
      </p>
    </div>
  );
}

function NetworkHero({ myEmail }: { myEmail: string | null }) {
  return (
    <Card className="border-border/70 bg-gradient-to-br from-brand-100 via-card to-card shadow-md">
      <CardContent className="flex flex-col gap-2 p-6">
        <span className="text-eyebrow">Dashboard · Network</span>
        <h1 className="font-display text-h2 leading-tight tracking-[-0.02em] text-foreground">
          My network
        </h1>
        <p className="max-w-2xl text-body text-muted-foreground">
          Send and manage connection requests for trusted B2B trading relationships. Only accepted
          connections can view lots posted with “My network” visibility.{' '}
          {myEmail ? (
            <>
              To test, add your own email ({myEmail}) and post a lot with “Selected companies” too —
              your own handle or email is enough to unlock it.
            </>
          ) : null}
        </p>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-border bg-background p-6 text-sm">
      <span className="font-semibold text-foreground">Your network is empty.</span>
      <p className="text-muted-foreground">
        Send a connection request above. The recipient must accept before either party can view the
        other’s “My network” lots.
      </p>
    </div>
  );
}
