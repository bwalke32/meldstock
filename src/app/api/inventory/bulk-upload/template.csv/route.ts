// @polsia:user-owned — GET /api/inventory/bulk-upload/template.csv.
//
// Returns a canonical CSV with all the recognised column headers the
// new bulk-upload wizard auto-maps plus one demo row. Server-only;
// `requireAuth()` gates the route so anonymous callers can't scrape
// the canonical column list. Generated on the fly (no caching needed
// at this size).
import 'server-only';
import { BULK_UPLOAD_CANONICAL_FIELDS } from '@/lib/business/inventory-bulk-upload/columns';
import { requireAuth } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

const DEMO_ROW: Record<string, string> = {
  type: 'HAVE',
  polymer: 'ABS',
  condition: 'PRIME_VIRGIN',
  grade: 'LG ABS-121H',
  manufacturer: 'LG Chem',
  quantity: '1000',
  unit: 'lb',
  askingPricePerLb: '1.20',
  packaging: 'Supersacks',
  form: 'Pellets',
  color: 'Black',
  country: 'USA',
  location: 'Houston, TX',
  notes: '',
  visibility: 'verified_companies',
  lotReference: 'A-001',
};

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET(_req: Request) {
  try {
    await requireAuth();
  } catch (res) {
    return res as Response;
  }
  const headers = BULK_UPLOAD_CANONICAL_FIELDS;
  const lines = [headers.join(','), headers.map((h) => csvEscape(DEMO_ROW[h] ?? '')).join(',')];
  const csv = `${lines.join('\n')}\n`;
  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="lots-template.csv"',
      'cache-control': 'no-store',
    },
  });
}
