// @polsia:user-owned — server stub for /lots/[id]. Exports metadata for SEO;
// body delegates to the client island that fetches /api/lots/[id].
import type { Metadata } from 'next';
import { LotDetail } from '@/components/custom/lot-detail';
import { siteName } from '@/lib/site';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const shortId = id.slice(-6).toUpperCase();
  return {
    title: `Lot L-${shortId} — ${siteName}`,
    description:
      'Listing detail — polymer, condition, color, form, manufacturer, grade, quantity, packaging, location, COA, asking price, and the private negotiation thread.',
    alternates: { canonical: `/lots/${id}` },
  };
}

export default async function LotDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="container-page flex flex-col gap-6 py-section">
      <LotDetail id={id} />
    </main>
  );
}
