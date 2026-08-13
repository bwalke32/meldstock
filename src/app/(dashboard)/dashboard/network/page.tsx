// @polsia:user-owned — server stub for /dashboard/network. Exports metadata so
// SEO + navigation work; the actual interactive surface is the client island
// below. Auth gating happens client-side (the dashboard shell redirects
// unauth users to /login). No data fetched here.
import type { Metadata } from 'next';
import { NetworkManagement } from '@/components/custom/dashboard/network-management';
import { siteName } from '@/lib/site';

export const metadata: Metadata = {
  title: `Network — ${siteName}`,
  description:
    'Manage your My network of private connections on Meldstock — the audience for any lot you post with “My network” visibility.',
  alternates: { canonical: '/dashboard/network' },
  robots: { index: false, follow: false },
};

export default function NetworkPage() {
  return <NetworkManagement />;
}
