// @polsia:user-owned — thin presentational wrapper that drives the
// dashboard sidebar's notifications-badge slot. Calls the polling hook
// and renders a numeric pill (caps at 99+, same shape as the Messages
// badge) so the visual rhythm of the sidebar doesn't shift when a new
// bell + count appears.
//
// Render shape mirrors `NavLink` in `dashboard-nav.tsx` so the slot it
// sits in (next to the other NavLinks in the sidebar) reads as the
// same component family.
'use client';

import { useNotificationsUnread } from '@/hooks/use-notifications-unread';

export function NotificationsBadge() {
  const { count } = useNotificationsUnread();
  if (count <= 0) return null;

  return (
    <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-primary px-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary-foreground tabular-nums">
      <span className="sr-only">{count} unread notifications</span>
      <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
    </span>
  );
}
