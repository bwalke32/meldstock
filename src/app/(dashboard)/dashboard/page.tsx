// @polsia:user-owned — server stub for /dashboard. Exports metadata so SEO
// works; the actual interactive surface is the client island below. No data
// is fetched here — auth gating happens client-side (on 401 the island
// redirects to /login), and counts/inventory come from /api/dashboard/overview.
import type { Metadata } from 'next';
import { DashboardOverviewClient } from '@/components/custom/dashboard/dashboard-overview';
import { siteName } from '@/lib/site';

export const metadata: Metadata = {
  title: `Dashboard — ${siteName}`,
  description:
    'Your floor on Meldstock — post new lots, watch open RFQs in your space, and pick up message threads in one screen.',
  alternates: { canonical: '/dashboard' },
  robots: { index: false, follow: false },
};

export default function DashboardPage() {
  return <DashboardOverviewClient />;
}
