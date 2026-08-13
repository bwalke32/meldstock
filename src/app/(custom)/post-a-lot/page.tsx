// @polsia:user-owned — server stub for /post-a-lot. Exports metadata so SEO
// works; the actual interactive surface is the client island below.
import type { Metadata } from 'next';
import { PostALotComposite } from '@/components/custom/post-a-lot-composite';
import { siteName } from '@/lib/site';

export const metadata: Metadata = {
  title: `Post a lot — ${siteName}`,
  description:
    'Push a resin lot to the trading floor — polymer, condition, color, form, manufacturer, grade, quantity, packaging, location, asking price, COA, notes, and a per-listing visibility selector (Public, Verified only, Anonymous). Mobile-first, takes about 90 seconds.',
  alternates: { canonical: '/post-a-lot' },
};

export default function PostALotPage() {
  return <PostALotComposite />;
}
