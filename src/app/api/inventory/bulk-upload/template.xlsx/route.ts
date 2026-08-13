// @polsia:user-owned — GET /api/inventory/bulk-upload/template.xlsx.
//
// Returns a canonical XLSX with all the recognised column headers the
// new bulk-upload wizard auto-maps plus one demo row. Generated via
// SheetJS on the fly. Server-only; `requireAuth()` gates the route so
// anonymous callers can't scrape the canonical column list.
import 'server-only';
import * as XLSX from 'xlsx';
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

export async function GET(_req: Request) {
  try {
    await requireAuth();
  } catch (res) {
    return res as Response;
  }
  const headers = BULK_UPLOAD_CANONICAL_FIELDS;
  const aoa: Array<Array<string>> = [[...headers], headers.map((h) => DEMO_ROW[h] ?? '')];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Lots');
  // `bookType: 'xlsx'` returns a node Buffer compatible with Response.
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return new Response(buf, {
    status: 200,
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="lots-template.xlsx"',
      'cache-control': 'no-store',
    },
  });
}
