// @polsia:user-owned — server stub for /dashboard/messages. Mounts the inbox
// inside the dashboard shell (same chrome as /dashboard/overview and
// /dashboard/network) so the nav drives the page and the user's auth is
// already carried by the layout. Exports metadata for SEO + tab title; the
// interactive surface is the client island below. No data fetched here.
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { MessagesInbox } from '@/app/(dashboard)/dashboard/messages/_islands/MessagesInbox';
import { siteName } from '@/lib/site';

export const metadata: Metadata = {
  title: `Messages — ${siteName}`,
  description:
    'Your full inbox of private threads and broker-group rooms inside the dashboard. Browse listing-scoped conversations, see unread counts at a glance, open any conversation without leaving the dashboard, or create a multi-person room from your network.',
  alternates: { canonical: '/dashboard/messages' },
  robots: { index: false, follow: false },
};

export default function DashboardMessagesPage() {
  return (
    <Suspense fallback={null}>
      <MessagesInbox />
    </Suspense>
  );
}
