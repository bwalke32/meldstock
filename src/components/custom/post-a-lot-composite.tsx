// @polsia:user-owned — /post-a-lot client island. Renders the form and the
// live feed below it; a fresh submission prepends to the feed so the new lot is
// immediately visible without waiting for the next poll.
'use client';

import { useCallback } from 'react';
import { PostALotForm } from '@/components/custom/post-a-lot-form';
import { RecentLotsFeed } from '@/components/custom/recent-lots-feed';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useLotsFeed } from '@/hooks/use-lots-feed';
import type { LotItem } from '@/lib/contracts/lots';

export function PostALotComposite() {
  const { items, isLoading, error, lastRefreshedAt, refreshNow } = useLotsFeed();

  // After a submission, force a refresh so the freshly-created row reads back
  // from the server with a stable `createdAt` (refreshNow returns the new list).
  const handleCreated = useCallback(
    (_lot: LotItem) => {
      void refreshNow();
    },
    [refreshNow],
  );

  return (
    <div className="container-page flex flex-col gap-8 py-section">
      <header className="flex flex-col gap-2">
        <span className="text-eyebrow text-primary">Post a lot</span>
        <h1 className="font-display text-h2 leading-tight tracking-[-0.02em] text-foreground">
          List a lot from the press cell.
        </h1>
        <p className="text-body text-muted-foreground">
          Capture the spec sheet — polymer, condition, color, form, manufacturer, grade, quantity,
          packaging, location, asking price, COA availability. Mobile-first; takes about 90 seconds.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,520px)_1fr]">
        <Card className="border-border bg-card shadow-sm">
          <CardHeader className="gap-1">
            <CardTitle className="font-display text-lg tracking-tight text-foreground">
              Listing details
            </CardTitle>
            <CardDescription>All required fields marked on the form.</CardDescription>
          </CardHeader>
          <CardContent>
            <PostALotForm onCreated={handleCreated} compact />
          </CardContent>
        </Card>

        <section aria-label="Recent trades" className="flex flex-col gap-3">
          {error ? (
            <Card className="border-border bg-card">
              <CardContent className="py-6 text-sm text-destructive">{error}</CardContent>
            </Card>
          ) : isLoading && items.length === 0 ? (
            <Card className="border-border bg-card">
              <CardContent className="py-6 text-sm text-muted-foreground">
                Loading recent lots…
              </CardContent>
            </Card>
          ) : (
            <RecentLotsFeed items={items} lastRefreshedAt={lastRefreshedAt} />
          )}
          <p className="text-[11px] text-muted-foreground">
            New postings land at the top with a brief pulse. Every 5 s while the tab is visible; 30
            s when hidden.
          </p>
        </section>
      </div>
    </div>
  );
}
