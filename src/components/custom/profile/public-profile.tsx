// @polsia:user-owned — /u/[handle] public profile page island. Fetches
// /api/profile/[handle] for the profile + the caller's lots in a single
// round-trip. Loading / not-found / error / ready state machine. The page
// itself is a Server Component exporting `generateMetadata`; this island
// does the data plane work. The /u/<handle> surface also renders the
// per-dimension trade-rating aggregate (powered by /api/ratings/aggregate/
// [userId]) so partners can see accumulated feedback across deals.
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { RatingAggregateCard } from '@/components/custom/profile/RatingAggregateCard';
import { VerificationBadge } from '@/components/custom/profile/verification-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';
import {
  conditionLabel,
  formatLb,
  formatPricePerLb,
  polymerLabel,
  relativeAge,
} from '@/lib/business/lots';
import { ACCOUNT_TYPE_LABELS, BUSINESS_ROLE_LABELS } from '@/lib/business/profiles';
import type { LotCondition, Polymer } from '@/lib/contracts/lots';
import { LotsByHandleResponse, type ProfileItem, ProfilePublic } from '@/lib/contracts/profiles';

// Local name for the type-only alias of ProfilePublic so we can use it in
// the response parsing — `ProfilePublic` is the zod schema, `ProfilePublicType`
// is the inferred type; they happen to be the same underlying shape today.
type ProfilePublicType = ProfileItem;

const PublicProfileResponseSchema = z.object({
  profile: ProfilePublic,
  lots: LotsByHandleResponse,
});

type State =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error' }
  | {
      kind: 'ready';
      profile: ProfilePublicType;
      lots: z.infer<typeof LotsByHandleResponse>;
    };

interface PublicProfileProps {
  handle: string;
}

export function PublicProfile({ handle }: PublicProfileProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    apiFetch(`/api/profile/${encodeURIComponent(handle)}`, {
      schema: PublicProfileResponseSchema,
    })
      .then((data) => {
        if (!active) return;
        setState({ kind: 'ready', profile: data.profile, lots: data.lots });
      })
      .catch((err: unknown) => {
        if (!active) return;
        const status = err instanceof Error ? /\((\d{3})\)/.exec(err.message)?.[1] : undefined;
        if (status === '404') setState({ kind: 'not-found' });
        else setState({ kind: 'error' });
      });
    return () => {
      active = false;
    };
  }, [handle]);

  if (state.kind === 'loading') {
    return (
      <Card className="border-border bg-card/40">
        <CardContent className="py-10 text-sm text-muted-foreground">Loading profile…</CardContent>
      </Card>
    );
  }
  if (state.kind === 'not-found') {
    return (
      <Card className="border-border bg-card/40">
        <CardContent className="flex flex-col gap-3 py-10 text-sm">
          <p className="font-medium text-foreground">No profile at /u/{handle}.</p>
          <p className="text-muted-foreground">
            This handle hasn’t been claimed — or the owner has not finished signup.
          </p>
          <Button asChild variant="outline" size="sm" className="self-start">
            <Link href="/trading-floor">Back to the floor →</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (state.kind === 'error') {
    return (
      <Card className="border-border bg-card/40">
        <CardContent className="py-10 text-sm text-destructive">
          Couldn’t load this profile right now. Try again in a moment.
        </CardContent>
      </Card>
    );
  }

  const { profile, lots } = state;
  return (
    <div className="flex flex-col gap-8">
      <Card className="border-border bg-card shadow-sm">
        <CardContent className="flex flex-col gap-6 p-6 sm:p-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-col gap-2">
              <span className="text-eyebrow text-primary">@{profile.handle}</span>
              <h1 className="text-h3 font-display tracking-tight text-foreground">
                {profile.displayName}
              </h1>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {ACCOUNT_TYPE_LABELS[profile.accountType]}
                </span>
                <span aria-hidden>·</span>
                <span>{BUSINESS_ROLE_LABELS[profile.role]}</span>
                {(profile.location || profile.country) && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{[profile.location, profile.country].filter(Boolean).join(', ')}</span>
                  </>
                )}
                {profile.companyName && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{profile.companyName}</span>
                  </>
                )}
              </div>
            </div>
            <VerificationBadge status={profile.verifiedBadge} className="self-start" />
          </div>

          {profile.companyDescription ? (
            <p className="rounded-md border border-border bg-muted/30 px-4 py-3 text-body text-foreground">
              {profile.companyDescription}
            </p>
          ) : null}

          <dl className="grid grid-cols-1 gap-y-3 rounded-md border border-border bg-background px-4 py-4 text-sm sm:grid-cols-3">
            <SpecRow term="Role" value={BUSINESS_ROLE_LABELS[profile.role]} />
            <SpecRow
              term="Years in business"
              value={profile.yearsInBusiness !== null ? `${profile.yearsInBusiness}` : '—'}
            />
            <SpecRow
              term="Listed lots"
              value={`${lots.items.length} listing${lots.items.length === 1 ? '' : 's'}`}
            />
            {profile.positionTitle && <SpecRow term="Title" value={profile.positionTitle} />}
            {profile.websiteUrl && (
              <SpecRow
                term="Website"
                value={
                  <a
                    href={profile.websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand-600 hover:underline"
                  >
                    {profile.websiteUrl}
                  </a>
                }
              />
            )}
            {profile.publicEmail && (
              <SpecRow
                term="Public email"
                value={
                  <a
                    href={`mailto:${profile.publicEmail}`}
                    className="text-brand-600 hover:underline"
                  >
                    {profile.publicEmail}
                  </a>
                }
              />
            )}
          </dl>
        </CardContent>
      </Card>

      <RatingAggregateCard userId={profile.userId} />

      <section aria-label="Listings" className="flex flex-col gap-4">
        <header className="flex items-end justify-between">
          <h2 className="text-h4 font-display tracking-tight text-foreground">
            Listings by {profile.displayName}
          </h2>
          <Button asChild variant="ghost" size="sm">
            <Link href="/trading-floor">All listings →</Link>
          </Button>
        </header>
        {lots.items.length === 0 ? (
          <Card className="border-border bg-card/40">
            <CardContent className="py-8 text-sm text-muted-foreground">
              No active listings from this user yet.
            </CardContent>
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {lots.items.slice(0, 20).map((lot) => (
              <li key={lot.id}>
                <Link
                  href={`/lots/${lot.id}`}
                  className="group flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-primary/30 hover:bg-muted/30"
                >
                  <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    <span>{relativeAge(lot.createdAt)} ago</span>
                    <span className="text-right">L-{lot.id.slice(-6).toUpperCase()}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[11px] uppercase tracking-wider">
                      {lot.type}
                    </span>
                    <span className="text-foreground">{polymerLabel(lot.polymer as Polymer)}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-foreground">
                      {conditionLabel(lot.condition as LotCondition)}
                    </span>
                    <span className="text-muted-foreground">·</span>
                    <span className="font-mono text-foreground">{formatLb(lot.quantityLb)}</span>
                    {lot.country ? (
                      <span className="text-muted-foreground">· {lot.country}</span>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-caption text-foreground">
                      {formatPricePerLb(lot.askingPricePerLb).label}
                    </span>
                    <span className="text-caption text-brand-600 opacity-0 transition-opacity group-hover:opacity-100">
                      Open lot →
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SpecRow({ term, value }: { term: string; value: string | number | React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {term}
      </dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}
