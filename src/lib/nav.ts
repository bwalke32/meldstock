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
  /** When true, hide once a session exists (used for sign-in/sign-up links). */
  hideWhenAuthenticated?: boolean;
  /** Render as the single high-emphasis conversion action. */
  emphasis?: boolean;
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
  { label: 'How it works', href: '/#how-it-works', group: 'primary', order: 0 },
  { label: 'For molders', href: '/#for-molders', group: 'primary', order: 1 },
  { label: 'For specialists', href: '/#for-specialists', group: 'primary', order: 2 },
  { label: 'Pricing', href: '/#pricing', group: 'primary', order: 3 },

  // One public conversion action plus a quiet sign-in link.
  {
    label: 'Sign in',
    href: '/login',
    group: 'secondary',
    hideWhenAuthenticated: true,
    order: 0,
  },
  {
    label: 'Request material',
    href: '/request-material',
    group: 'secondary',
    emphasis: true,
    order: 1,
  },

  // Authenticated users get only the core request/reply surfaces in the header.
  {
    label: 'My requests',
    href: '/dashboard/inventory',
    group: 'secondary',
    requiresAuth: true,
    order: 0,
  },
  { label: 'Messages', href: '/messages', group: 'secondary', requiresAuth: true, order: 0.5 },

  // The earlier marketplace tools remain reachable by URL while the product
  // pivot is validated; removing them from the public navigation is reversible.
  { label: 'How it works', href: '/#how-it-works', group: 'footer', order: 0 },
  { label: 'For molders', href: '/#for-molders', group: 'footer', order: 1 },
  { label: 'For specialists', href: '/#for-specialists', group: 'footer', order: 2 },
  { label: 'Pricing', href: '/#pricing', group: 'footer', order: 3 },
  { label: 'FAQ', href: '/#faq', group: 'footer', order: 4 },
];
