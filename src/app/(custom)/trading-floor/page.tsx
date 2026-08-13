// @polsia:user-owned — /trading-floor server stub. Exports metadata; the data
// plane and interactivity live in TradingFloor.
import type { Metadata } from 'next';
import { TradingFloor } from '@/components/custom/trading-floor';
import { siteName } from '@/lib/site';

export const metadata: Metadata = {
  title: `Trading Floor — ${siteName}`,
  description:
    'Live HAVE/WANTED trading floor for plastics resin — brokers, molders, and recyclers post spec-sheet listings and reply via private threads.',
  alternates: { canonical: '/trading-floor' },
};

export default function TradingFloorPage() {
  return <TradingFloor />;
}
