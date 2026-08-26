// @polsia:user-owned — app navigation rendered by SiteNav/SiteFooter and read by
// the sitemap. Edit it as pages are added or removed.

export type NavGroup = 'primary' | 'secondary' | 'footer';

export interface NavItem {
  label: string;
  href: string;
  group: NavGroup;
  menu?: string;
  requiresAuth?: boolean;
  hideWhenAuthenticated?: boolean;
  emphasis?: boolean;
  order?: number;
}

export const navItems: NavItem[] = [
  { label: 'How matching works', href: '/#matching', group: 'primary', order: 0 },
  { label: 'Specialist opportunities', href: '/opportunities', group: 'primary', order: 1 },

  {
    label: 'Sign in',
    href: '/login',
    group: 'secondary',
    hideWhenAuthenticated: true,
    order: 0,
  },
  {
    label: 'Build a sourcing brief',
    href: '/request-material',
    group: 'secondary',
    emphasis: true,
    order: 1,
  },

  {
    label: 'My requests',
    href: '/dashboard/inventory',
    group: 'secondary',
    requiresAuth: true,
    order: 0,
  },
  {
    label: 'Messages',
    href: '/messages',
    group: 'secondary',
    requiresAuth: true,
    order: 0.5,
  },

  { label: 'Source material', href: '/request-material', group: 'footer', order: 0 },
  { label: 'Opportunity desk', href: '/opportunities', group: 'footer', order: 1 },
  { label: 'How matching works', href: '/#matching', group: 'footer', order: 2 },
  { label: 'Sign in', href: '/login', group: 'footer', order: 3 },
];
