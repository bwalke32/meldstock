// @polsia:user-owned — brand identity. Edit freely. `site.ts` re-exports
// siteName/siteDescription; `manifest.ts` + `opengraph-image.tsx` read `brandVisual`.

export const siteName = 'Meldstock';
export const siteDescription =
  'A private thermoplastic sourcing network connecting injection molders with the brokers and resin sales specialists best equipped to solve each material request.';

// PWA + social-share colors. HEX only (the oklch() tokens in globals.css aren't
// readable here) — set to match your brand seed.
export const brandVisual = {
  /** PWA browser-UI / status-bar color. */
  themeColor: '#0f766e',
  /** PWA splash + install background. */
  backgroundColor: '#071c1b',
  /** Social-share (OG/Twitter) image. */
  og: {
    background: '#071c1b',
    foreground: '#fbf8f1',
    /** Second line under the site name; '' hides it. */
    tagline: 'One request. The right resin specialists.',
  },
} as const;
