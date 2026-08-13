// @polsia:user-owned — POST /api/lots/bulk.
//
// Bulk-create lots from a single CSV payload pasted by a signed-in seller.
// Per-row validation happens BEFORE the DB round-trip so we can return
// per-row success/error in input order and only send validated rows through
// `prisma.lot.createMany`. One request, one response, no fan-out to the
// saved-search email pipeline (the brief scopes email fan-out OUT — would
// produce up to N*savedSearches emails and bust the proxy rate-limit on real
// imports; flagged here for future work).
//
// Auth: `requireAuth()` returns a 401 the island surfaces via apiFetch (it
// throws on non-2xx). Body cap: 1 MB. Row cap: 500.
import 'server-only';
import { NextResponse } from 'next/server';
import type { CreateLot as CreateLotInput } from '@/lib/contracts/lots';
import { BulkLotsResponse } from '@/lib/contracts/lots-bulk';
import { parseLotsCsv, validateAndMapLotRow, validateCsvHeaders } from '@/lib/csv/lots';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB — 500 rows × ~2 KB/row is comfortably below
const MAX_ROWS = 500;

type BulkResultEntry =
  | { rowIndex: number; status: 'created'; message: string }
  | { rowIndex: number; status: 'error'; message: string };

export async function POST(req: Request) {
  // Auth gate + name lookup. requireAuth() throws a 401 Response on failure;
  // we catch + return so apiFetch's error path on the island sees a clean
  // status code instead of a thrown promise.
  let userId: string;
  let postedByName: string;
  try {
    const user = await requireAuth();
    userId = user.id;
    // Pull the user's display name once so the row-level validator can
    // default `posted_by_name` for any row that omits the optional column.
    const userRow = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    postedByName = userRow?.name?.trim() || user.name?.trim() || 'Seller';
  } catch (res) {
    return res as Response;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const csv = (body as { csv?: unknown }).csv;
  if (typeof csv !== 'string' || csv.length === 0) {
    return NextResponse.json({ error: 'CSV is empty' }, { status: 400 });
  }
  if (Buffer.byteLength(csv, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: `CSV exceeds the ${MAX_BODY_BYTES / 1024} KB body limit` },
      { status: 413 },
    );
  }

  const parsed = parseLotsCsv(csv);
  if (parsed.headers.length === 0) {
    return NextResponse.json({ error: 'CSV is empty' }, { status: 400 });
  }
  const headerCheck = validateCsvHeaders(parsed.headers);
  if (!headerCheck.ok) {
    return NextResponse.json(
      { error: `CSV is missing required column(s): ${headerCheck.missing.join(', ')}` },
      { status: 400 },
    );
  }
  if (parsed.rows.length === 0) {
    return NextResponse.json({ error: 'CSV contained a header but no data rows' }, { status: 400 });
  }
  if (parsed.rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `CSV has ${parsed.rows.length} data rows; the cap is ${MAX_ROWS}` },
      { status: 413 },
    );
  }

  // Validation pass first — we never call Prisma with invalid data, so
  // createMany can't reject rows. Results queue in the same array; we keep
  // the per-row index around so the response table mirrors the source
  // spreadsheet.
  const results: BulkResultEntry[] = [];
  const validRows: Array<{ rowIndex: number; data: CreateLotInput }> = [];

  // `for..of` so the row variable isn't widened to `LotCsvRow | undefined`
  // under noUncheckedIndexedAccess — TS still gets the right element type.
  parsed.rows.forEach((row, i) => {
    const rowIndex = i + 1; // 1-based = the sheet row number a seller sees
    const result = validateAndMapLotRow(row, { name: postedByName });
    if (result.ok) {
      validRows.push({ rowIndex, data: result.data });
    } else {
      results.push({ rowIndex, status: 'error', message: result.error });
    }
  });

  let created = 0;
  if (validRows.length > 0) {
    const inserted = await prisma.lot.createMany({
      data: validRows.map((row) => {
        const d = row.data;
        return {
          type: d.type,
          polymer: d.polymer,
          condition: d.condition,
          color: d.color,
          form: d.form,
          manufacturer: d.manufacturer ?? null,
          grade: d.grade ?? null,
          quantityLb: d.quantityLb,
          packaging: d.packaging,
          location: d.location ?? null,
          country: d.country,
          askingPricePerLb: d.askingPricePerLb ?? null,
          hasCoa: d.hasCoa,
          notes: d.notes ?? null,
          postedByName: d.postedByName,
          postedByUserId: userId,
          visibility: d.visibility,
          // Lifecycle brief — `quantityRemaining` defaults from `quantityLb`
          // on CSV import so the CSV upload doesn't have to learn a new
          // optional column. The PATCH endpoint allows partial-qty updates.
          quantityRemaining: d.quantityRemaining ?? d.quantityLb,
        };
      }),
    });
    created = inserted.count;
    // createMany returns only the row count (no per-row ids). For the bulk
    // flow the headline is the summary numbers; per-row ids are flagged
    // here as future work — would require pre-generating cuids and passing
    // them as `id` so the island could deep-link to a single created lot.
    for (const row of validRows) {
      results.push({ rowIndex: row.rowIndex, status: 'created', message: 'created' });
    }
  }

  // Sort by input row index so the response table mirrors the source
  // spreadsheet (errors pushed during the validation pass; created rows
  // pushed after — they merge in iteration order but the sort guarantees
  // a stable input-order view even if validation ever changes shape).
  results.sort((a, b) => a.rowIndex - b.rowIndex);

  const response = BulkLotsResponse.parse({
    summary: { total: parsed.rows.length, created, errored: parsed.rows.length - created },
    results,
  });
  return NextResponse.json(response, { status: 200 });
}
