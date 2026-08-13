// @polsia:user-owned — server stub for /dashboard/notifications. Mounts the
// notification inbox inside the dashboard shell (same chrome as the other
// dashboard routes) so the sidebar nav drives the route and the user's
// auth + sidebar layout are already carried by /(dashboard)/layout.tsx.
//
// Exports metadata for SEO + tab title; the interactive surface is the
// client island below. NO data fetched here — the data plane rule + the
// layout-shell-redirect pattern forbid server-side reads on this surface.
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NotificationInbox } from '@/app/(dashboard)/dashboard/notifications/_islands/notification-list';
import { siteName } from '@/lib/site';

export const metadata: Metadata = {
  title: `Notifications — ${siteName}`,
  description:
    'Your in-app inbox — saved-search matches (new WANTED postings that hit your filters), new thread messages, and replies to your own RFQs. Reverse-chronological list with read/unread state and one-tap mark-all-read.',
  alternates: { canonical: '/dashboard/notifications' },
  robots: { index: false, follow: false },
};

export default function DashboardNotificationsPage() {
  return (
    <Suspense fallback={null}>
      <NotificationInbox />
    </Suspense>
  );
}
