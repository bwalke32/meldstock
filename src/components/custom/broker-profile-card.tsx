// @polsia:user-owned — /brokers/[id] client island. Fetches the broker
// profile + counts from /api/brokers/[id] once and renders a marketing
// card (displayName + handle + verification badge + memberSince +
// activeListings + closedDeals). The page exports metadata SEO; this
// island does the data plane work.
//
// Anchored from /lots/[id] (seller line) and the message-thread header
// (`otherParty.counterpartyIsBroker`). Server-stamped on the lot / thread
// wire so the link survives the render-server round-trip without an
// extra profile fetch.
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { VerificationBadge } from '@/components/custom/profile/verification-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';
import { ACCOUNT_TYPE_LABELS, BUSINESS_ROLE_LABELS } from '@/lib/business/profiles';
import type { BrokerProfileItem } from '@/lib/contracts/brokers';
import { BrokerProfileResponse as BrokerProfileResponseSchema } from '@/lib/contracts/brokers';

type State =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error' }
  | { kind: 'ready'; item: BrokerProfileItem };

export interface BrokerProfileCardProps {
  id: string;
}

export function BrokerProfileCard({ id }: BrokerProfileCardProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    apiFetch(`/api/brokers/${encodeURIComponent(id)}`, {
      schema: BrokerProfileResponseSchema,
    })
      .then((data) => {
        if (!active) return;
        setState({ kind: 'ready', item: data.item });
      })
      .catch((err: unknown) => {
        if (!active) return;
        const status = err instanceof Error ? /\((\d{3})\)/.exec(err.message)?.[1] : undefined;
        if (status === '404') {
          setState({ kind: 'not-found' });
        } else {
          setState({ kind: 'error' });
        }
      });
    return () => {
      active = false;
    };
  }, [id]);

  if (state.kind === 'loading') {
    return (
      <Card className="border-border bg-card/40">
        <CardContent className="py-10 text-sm text-muted-foreground">Loading broker…</CardContent>
      </Card>
    );
  }

  if (state.kind === 'not-found') {
    return (
      <Card className="border-border bg-card/40">
        <CardHeader>
          <CardTitle className="font-display text-h3 tracking-tight">Broker not found</CardTitle>
          <CardDescription>
            No broker profile matches this id. They may have closed their account, or the link is
            wrong.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm">
            <Link href="/trading-floor">Back to trading floor →</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (state.kind === 'error') {
    return (
      <Card className="border-border bg-card/40">
        <CardHeader>
          <CardTitle className="font-display text-h3 tracking-tight">
            Couldn't load profile
          </CardTitle>
          <CardDescription>Try again in a moment.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm">
            <Link href="/trading-floor">Back to trading floor →</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return <Ready item={state.item} />;
}

function Ready({ item }: { item: BrokerProfileItem }) {
  const memberSince = formatMemberSince(item.memberSince);
  const activeListingsLabel = `${item.activeListingsCount} ${
    item.activeListingsCount === 1 ? 'listing' : 'listings'
  }`;
  const closedDealsLabel = `${item.closedDealsCount} ${
    item.closedDealsCount === 1 ? 'deal' : 'deals'
  }`;

  return (
    <div className="flex flex-col gap-6">
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="gap-3 border-b border-border">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-col gap-2">
              <span className="text-eyebrow text-primary">
                Broker
                {item.handle ? (
                  <span className="text-eyebrow text-muted-foreground"> · @{item.handle}</span>
                ) : null}
              </span>
              <CardTitle className="font-display text-h2 leading-tight tracking-[-0.02em] text-foreground">
                {item.displayName}
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {ACCOUNT_TYPE_LABELS[item.accountType]}
                </span>
                <span aria-hidden>·</span>
                <span>{BUSINESS_ROLE_LABELS[item.role]}</span>
                {item.companyName ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>{item.companyName}</span>
                  </>
                ) : null}
              </div>
            </div>
            <VerificationBadge status={item.verifiedBadge} className="self-start" />
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-5 pt-5">
          {memberSince ? (
            <p className="text-sm text-muted-foreground">Member since {memberSince}.</p>
          ) : null}

          <dl className="grid grid-cols-1 gap-y-3 rounded-md border border-border bg-muted/30 px-4 py-4 text-sm sm:grid-cols-3">
            <SpecRow term="Active listings" value={activeListingsLabel} />
            <SpecRow term="Closed deals" value={closedDealsLabel} />
            <SpecRow term="Verified company" value={item.verifiedCompany ? 'Yes' : 'No'} />
          </dl>

          <div className="flex flex-wrap items-center gap-2">
            {item.handle ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/u/${item.handle}`}>View full profile →</Link>
              </Button>
            ) : null}
            <Button asChild variant="ghost" size="sm">
              <Link href="/trading-floor">Back to trading floor →</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SpecRow({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {term}
      </dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}

function formatMemberSince(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
