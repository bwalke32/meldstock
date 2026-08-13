// @polsia:user-owned — server stub for /lots browse. Exports metadata for SEO;
// the data plane + interactivity live in LotsBrowse.
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LotsBrowse } from '@/components/custom/lots-browse';
import { siteName } from '@/lib/site';

export const metadata: Metadata = {
  title: `Lots — ${siteName}`,
  description:
    'Browse every active HAVE and WANTED lot — filter by polymer, condition, grade, color, melt flow, glass %, recycled content, flame rating and certifications. URL-shareable.',
  alternates: { canonical: '/lots' },
};

export default function LotsPage() {
  return (
    <Suspense fallback={null}>
      <LotsBrowse />
    </Suspense>
  );
}
