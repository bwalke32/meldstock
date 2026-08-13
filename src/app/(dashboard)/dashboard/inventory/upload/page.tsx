// @polsia:user-owned — /dashboard/inventory/upload server stub. Mounts
// the new bulk-upload wizard client island inside the dashboard shell
// (same chrome as /dashboard, /dashboard/messages, /dashboard/network).
// Wizard owns its own state machine + API round-trips — the page is a
// thin shell that exports `metadata` + `robots: noindex` so SEO doesn't
// index this power-user surface.
import type { Metadata } from 'next';
import { ImportWizard } from '@/components/custom/dashboard/inventory/import-wizard';
import { siteName } from '@/lib/site';

export const metadata: Metadata = {
  title: `Bulk import lots — ${siteName}`,
  description:
    'Upload a CSV or Excel sheet, map columns, preview every row, fix typos inline, then import only the lots you approve.',
  alternates: { canonical: '/dashboard/inventory/upload' },
  robots: { index: false, follow: false },
};

export default function DashboardInventoryUploadPage() {
  return <ImportWizard />;
}
