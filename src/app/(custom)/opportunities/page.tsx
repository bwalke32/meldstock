import type { Metadata } from 'next';
import { SourcingOpportunities } from '@/components/custom/sourcing-opportunities';
import { siteName } from '@/lib/site';

export const metadata: Metadata = {
  title: `Sourcing opportunities — ${siteName}`,
  description:
    'Review private, structured injection-molding resin requests and respond with an exact grade, qualified equivalent, or sourcing path.',
  alternates: { canonical: '/opportunities' },
  robots: { index: false, follow: false },
};

export default function OpportunitiesPage() {
  return <SourcingOpportunities />;
}
