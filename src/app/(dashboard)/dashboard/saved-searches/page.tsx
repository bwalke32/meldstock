// @polsia:user-owned — server stub for /dashboard/saved-searches. Mounts the
// manager inside the dashboard shell (same chrome as the other dashboard
// routes) so the sidebar nav drives the route and the user's auth state is
// already carried by /(dashboard)/layout.tsx.
//
// Exports metadata for SEO + tab title; the interactive surface is the
// client island below.
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SavedSearchesManager } from '@/components/custom/dashboard/saved-searches-manager';
import { siteName } from '@/lib/site';

export const metadata: Metadata = {
  title: `Saved searches — ${siteName}`,
  description:
    'Manage the filter sets that email you on matches — toggle alerts, edit, delete, or jump straight back into /lots with the filter applied.',
  alternates: { canonical: '/dashboard/saved-searches' },
  robots: { index: false, follow: false },
};

export default function DashboardSavedSearchesPage() {
  return (
    <Suspense fallback={null}>
      <SavedSearchesManager />
    </Suspense>
  );
}
