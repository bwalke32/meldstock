// @polsia:user-owned — /dashboard/inventory server stub. Mounts the
// stale-listings banner (GETs /api/lots/stale on mount), the bulk-import
// CTA card, and the per-row actions table (GETs /api/lots/mine). No data
// fetch happens here — auth + column-level gating live in the route
// handlers so the page stays a thin shell that composes the islands.
import type { Metadata } from 'next';
import { ImportCtaCard } from '@/components/custom/dashboard/inventory/import-cta-card';
import { MyListingsTable } from '@/components/custom/dashboard/inventory/my-listings-table';
import { StaleListingsBanner } from '@/components/custom/dashboard/inventory/stale-listings-banner';
import { siteName } from '@/lib/site';

export const metadata: Metadata = {
  title: `My listings — ${siteName}`,
  description:
    'Manage your inventory on Meldstock — refresh to bump timestamps, edit remaining quantity, mark sold, deactivate, or confirm a stale listing is still available.',
  alternates: { canonical: '/dashboard/inventory' },
  robots: { index: false, follow: false },
};

export default async function DashboardInventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // `?focus=<lotId>` deep-links from the stale-nudge email so a recipient
  // lands on the exact row that's stale. Server hands it to the client
  // island so we don't need to re-parse query in the browser.
  const rawFocus = params.focus;
  const focusId = typeof rawFocus === 'string' && rawFocus.length > 0 ? rawFocus : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 rounded-2xl border border-border bg-gradient-to-br from-brand-100 via-card to-card p-6 shadow-md md:p-8">
        <span className="text-eyebrow">Inventory</span>
        <h1 className="font-display text-h2 leading-tight tracking-[-0.02em] text-foreground">
          My listings
        </h1>
        <p className="max-w-2xl text-body text-muted-foreground">
          Refresh to bump timestamps, edit remaining quantity, mark items sold, or deactivate
          listings you no longer have. Select rows to bulk-edit. Stale listings — anything idle for
          30+ days — will surface up here so you can confirm or remove them before the daily nudge
          auto-expires them.
        </p>
      </header>

      <ImportCtaCard />
      <StaleListingsBanner />
      <MyListingsTable focusId={focusId} />
    </div>
  );
}
