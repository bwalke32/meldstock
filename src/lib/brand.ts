// @polsia:user-owned — brand identity. Edit freely. `site.ts` re-exports
// siteName/siteDescription; `manifest.ts` + `opengraph-image.tsx` read `brandVisual`.

export const siteName = 'Meldstock';
export const siteDescription =
  'Live HAVE/WANTED trading floor for plastics resin — brokers, molders, extruders, recyclers, and compounders push spec-sheet listings, see a self-refreshing feed, and negotiate via private threads. Built around PPWR, US state EPR, and FDA migration.';

// PWA + social-share colors. HEX only (the oklch() tokens in globals.css aren't
// readable here) — set to match your brand seed.
export const brandVisual = {
  /** PWA browser-UI / status-bar color. */
  themeColor: '#c2680a',
  /** PWA splash + install background. */
  backgroundColor: '#0f0d09',
  /** Social-share (OG/Twitter) image. */
  og: {
    background: '#0f0d09',
    foreground: '#fbf8f1',
    /** Second line under the site name; '' hides it. */
    tagline: 'Live plastics trading floor.',
  },
} as const;
