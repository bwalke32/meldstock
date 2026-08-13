// @polsia:user-owned
'use client';

import { Bell, Bookmark, Inbox, LayoutDashboard, PackageSearch, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useMessagesUnread } from '@/hooks/use-messages-unread';
import { cn } from '@/lib/utils';
import { NotificationsBadge } from './notifications-badge';

export function DashboardNav() {
  const pathname = usePathname();
  const { summary } = useMessagesUnread();
  const unreadTotal = summary?.unreadCount ?? 0;

  return (
    <nav
      aria-label="Dashboard"
      className="flex gap-2 overflow-x-auto pb-1 lg:grid lg:overflow-visible lg:pb-0"
    >
      <NavLink
        href="/dashboard"
        label="Overview"
        icon={LayoutDashboard}
        active={pathname === '/dashboard'}
      />
      <NavLink
        href="/dashboard/notifications"
        label="Notifications"
        icon={Bell}
        active={pathname?.startsWith('/dashboard/notifications') ?? false}
        extra={<NotificationsBadge />}
      />
      <NavLink
        href="/dashboard/messages"
        label="Messages"
        icon={Inbox}
        active={pathname?.startsWith('/dashboard/messages') ?? false}
        badge={unreadTotal > 0 ? unreadTotal : null}
      />
      <NavLink
        href="/dashboard/network"
        label="Network"
        icon={Users}
        active={pathname === '/dashboard/network'}
      />
      <NavLink
        href="/dashboard/inventory"
        label="My listings"
        icon={PackageSearch}
        // Match the inventory page AND the bulk-upload sub-page so the
        // nav chip stays lit when the user jumps into the CSV uploader.
        active={
          pathname === '/dashboard/inventory' ||
          pathname?.startsWith('/dashboard/inventory/') === true
        }
      />
      <NavLink
        href="/dashboard/saved-searches"
        label="Saved searches"
        icon={Bookmark}
        active={pathname?.startsWith('/dashboard/saved-searches') ?? false}
      />
    </nav>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  badge = null,
  extra = null,
}: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  active: boolean;
  badge?: number | null;
  // Slot for an arbitrary trailing element (e.g. the notifications pill)
  // — kept separate from `badge` so the badge count and the slot live
  // side-by-side without colliding on the same slot.
  extra?: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors',
        active
          ? 'bg-secondary text-secondary-foreground'
          : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground',
      )}
    >
      <Icon aria-hidden="true" className="size-4" />
      <span>{label}</span>
      {badge !== null ? (
        <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-primary px-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary-foreground tabular-nums">
          <span className="sr-only">{badge} unread messages</span>
          <span aria-hidden="true">{badge > 99 ? '99+' : badge}</span>
        </span>
      ) : null}
      {extra}
    </Link>
  );
}
