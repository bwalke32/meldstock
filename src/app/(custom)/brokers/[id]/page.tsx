// @polsia:user-owned — /brokers/[id] Server Component shell. Exports
// `generateMetadata` for SEO; body delegates to the client island that
// fetches /api/brokers/[id]. Metadata title is intentionally a static
// placeholder — the page MUST NOT fetch in its body (data-plane rule),
// and an untyped param-based fragment would either crash or feel
// inconsistent across calls. The display name flickers in once the
// island resolves; on first paint the title reads "Broker · ..." and the
// /api/brokers/[id] lookup supplies the full name on hydration.
import type { Metadata } from 'next';
import { BrokerProfileCard } from '@/components/custom/broker-profile-card';
import { siteName } from '@/lib/site';

interface PageProps {
  params: Promise<{ id: string }>;
}

// SEO metadata for the broker profile surface. Title is intentionally a
// static phrase + the site name — the page Server Component cannot
// await prisma in its body. The display name lands after the API
// resolves on the client; SEO crawlers read this placeholder.
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Broker profile — ${siteName}`,
    description: `Public broker profile on ${siteName} — display name, verified-company status, member-since date, active listings count, and closed-deals record.`,
    alternates: { canonical: `/brokers/${id}` },
  };
}

export default async function BrokerProfilePage({ params }: PageProps) {
  const { id } = await params;
  return (
    <main className="container-page flex flex-col gap-6 py-section">
      <BrokerProfileCard id={id} />
    </main>
  );
}
