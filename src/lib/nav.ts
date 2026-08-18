// @polsia:user-owned — app navigation rendered by SiteNav/SiteFooter and read by
// the sitemap. Edit it as pages are added or removed.
// This list is a convenience, not module registration.

export type NavGroup = 'primary' | 'secondary' | 'footer';

export interface NavItem {
  /** Visible link text. */
  label: string;
  /** App route, e.g. '/' or '/dashboard'. */
  href: string;
  /** Where it renders: top-nav 'primary'/'secondary', or 'footer'. */
  group: NavGroup;
  /** Group `primary` items into a dropdown: items sharing a `menu` value collapse
   *  into one "<menu> ⌄" top-bar slot (e.g. `menu: 'Resources'` on Blog/Docs/
   *  Changelog). Keeps the bar short. Ignored for 'secondary'/'footer'. */
  menu?: string;
  /** When true, render only if a session exists (see site-nav.tsx). */
  requiresAuth?: boolean;
  /** Sort key within a group (ascending); unordered items fall to the end. */
  order?: number;
}

// Keep the bar short: ~3-5 primary slots, group the tail with `menu`, push the
// rest to 'footer' (SiteNav overflows extras into a "More" dropdown). Example:
//   { label: 'Pricing', href: '/pricing', group: 'primary' },
//   { label: 'Blog',    href: '/blog',    group: 'primary', menu: 'Resources' },
//   { label: 'Docs',    href: '/docs',    group: 'primary', menu: 'Resources' },
//   { label: 'Sign in', href: '/login',   group: 'secondary' },
//
// In-page anchors (/#features, /#lots) are valid hrefs for a single-page launch.
export const navItems: NavItem[] = [
  { label: 'Trading floor', href: '/trading-floor', group: 'primary', order: 0 },
  { label: 'Lots', href: '/lots', group: 'primary', order: 1 },
  { label: 'Marketplace', href: '/#lots', group: 'primary', order: 2 },
  { label: 'Intelligence', href: '/#intelligence', group: 'primary', order: 3 },
  { label: 'Docs', href: '/#faq', group: 'primary', menu: 'Resources', order: 4 },
  { label: 'Grade index', href: '/#grades', group: 'primary', menu: 'Resources', order: 5 },

  // Conversion CTAs in the secondary cluster of the top bar.
  { label: 'Post a lot', href: '/post-a-lot', group: 'secondary', order: 0 },
  { label: 'Sign in', href: '/login', group: 'secondary', order: 1 },
  { label: 'Create account', href: '/signup', group: 'secondary', order: 2 },
  { label: 'Messages', href: '/messages', group: 'secondary', requiresAuth: true, order: 2.5 },
  { label: 'Dashboard', href: '/dashboard', group: 'secondary', requiresAuth: true, order: 3 },
  {
    label: 'Saved searches',
    href: '/dashboard/saved-searches',
    group: 'secondary',
    requiresAuth: true,
    // Lands between Dashboard (3) and Network (3.5) so the four dashboard
    // routes render in the order: Dashboard, Saved searches, Network. Same
    // auth-gated pattern as the other dashboard entries; the page's own
    // `robots: noindex` keeps it out of the public sitemap even though the
    // link itself surfaces for authed visitors.
    order: 3.4,
  },
  {
    label: 'Network',
    href: '/dashboard/network',
    group: 'secondary',
    requiresAuth: true,
    order: 3.5,
  },
  // Inventory dashboard entry — the lot lifecycle table (refresh / bulk
  // deactivate / confirm-available). Lands just below Network (3.5) so the
  // four dashboard routes render in the order: Saved searches, Network,
  // My listings. Auth-gated alongside the rest; the page itself sets
  // `robots: noindex` so it never leaks into the public sitemap.
  {
    label: 'My listings',
    href: '/dashboard/inventory',
    group: 'secondary',
    requiresAuth: true,
    order: 3.2,
  },
  { label: 'My profile', href: '/profile', group: 'secondary', requiresAuth: true, order: 4 },

  // Long tail — footer.
  { label: 'Compliance', href: '/#compliance', group: 'footer', order: 0 },
  { label: 'Workflow', href: '/#workflow', group: 'footer', order: 1 },
  { label: 'Pricing', href: '/#pricing', group: 'footer', order: 2 },
  { label: 'FAQ', href: '/#faq', group: 'footer', order: 3 },
  { label: 'Contact', href: 'mailto:contact@meldstock.example', group: 'footer', order: 4 },
];
