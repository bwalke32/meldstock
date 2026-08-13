// @polsia:user-owned — POST /api/inventory/bulk-upload/preview.
//
// Read-only validation endpoint for the wizard's "Map → Preview → Errors"
// steps. Parses the uploaded file (CSV or XLSX), auto-recognizes the
// sheet headers, applies the seller's header mapping (so re-runs after a
// mapping tweak reuse previously-set decisions), and returns a per-row
// preview payload. **No DB write ever runs** — this is purely a parser
// + validator pass so the seller can iterate the mapping before commit.
//
// Server-only. Auth-gated. Multipart body cap 10 MB. Row cap 5000.
//
// The route handler's response payload shares the zod contract at
// @/lib/contracts/inventory-bulk-upload so the wizard and the handler
// can't drift on shape.
import 'server-only';
import { NextResponse } from 'next/server';
import { recognizeHeaders } from '@/lib/business/inventory-bulk-upload/columns';
import {
  type ParsedFile,
  parseUploadedFile,
} from '@/lib/business/inventory-bulk-upload/parse-file';
import { applyMapping, validateMappedRow } from '@/lib/business/inventory-bulk-upload/validate';
import { PreviewResponseSchema } from '@/lib/contracts/inventory-bulk-upload';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/require-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let userId: string;
  let posterName: string;
  try {
    const user = await requireAuth();
    userId = user.id;
    const userRow = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    posterName = userRow?.name?.trim() || user.name?.trim() || 'Seller';
  } catch (res) {
    return res as Response;
  }

  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 });
  }

  const file = fd.get('file');
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'Missing file field' }, { status: 400 });
  }

  // Optional pre-mapped headers: seller clicks "Re-preview" after
  // adjusting the dropdown in the mapping step; we honour their chosen
  // mapping instead of re-running recognizer on each iteration. Sent as
  // JSON in a sibling field so FormData isn't burdened with a string
  // containing `{`/`}`.
  const overrideMappingRaw = fd.get('mapping');
  const overrideMapping: Record<string, string | null> | null =
    typeof overrideMappingRaw === 'string' && overrideMappingRaw.length > 0
      ? safeParseMapping(overrideMappingRaw)
      : null;

  let parsed: ParsedFile;
  try {
    parsed = await parseUploadedFile(file as File);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not parse file';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (parsed.model.headers.length === 0) {
    return NextResponse.json({ error: 'File is empty (no header row)' }, { status: 400 });
  }
  if (parsed.model.rows.length === 0) {
    return NextResponse.json(
      { error: 'File contained a header but no data rows' },
      { status: 400 },
    );
  }

  const recognized = recognizeHeaders(parsed.model.headers);
  // Seller overrides win over auto-recognition. Recognized mapping is
  // the seed; we flip any source-header the seller re-mapped to its
  // explicit canonical or `null` (ignore).
  const mapping: Record<string, string | null> = { ...recognized.mapping };
  if (overrideMapping) {
    for (const [header, target] of Object.entries(overrideMapping)) {
      if (!(header in mapping)) continue;
      mapping[header] = target;
    }
  }

  // Look up the original source headers so the per-row validator can
  // infer kg-vs-lb from the literal column the seller used.
  const quantityHeader = findHeaderFor(mapping, 'quantity');
  const priceHeader = findHeaderFor(mapping, 'askingPricePerLb');

  const previewRows = parsed.model.rows.map((row, idx) => {
    const rowIndex = idx + 1;
    const mapped = applyMapping(row, mapping);
    const result = validateMappedRow(mapped, {
      posterName,
      quantityHeader,
      priceHeader,
    });
    const valuesObj: Record<string, string> = {};
    for (const [k, v] of Object.entries(mapped.values)) {
      if (v !== undefined) valuesObj[k] = v;
    }
    return {
      rowIndex,
      source: row,
      values: valuesObj,
      ok: result.ok,
      errors: result.ok ? [] : result.errors.map((e) => ({ field: e.field, message: e.message })),
      normalized: result.normalized,
    };
  });

  const validCount = previewRows.filter((r) => r.ok).length;
  const wire = PreviewResponseSchema.parse({
    summary: {
      total: previewRows.length,
      valid: validCount,
      errored: previewRows.length - validCount,
    },
    mapping,
    ambiguous: recognized.ambiguous,
    rows: previewRows,
  });
  return NextResponse.json(wire, { status: 200 });
}

function safeParseMapping(raw: string): Record<string, string | null> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const out: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v === null) out[k] = null;
      else if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

function findHeaderFor(mapping: Record<string, string | null>, canonical: string): string | null {
  for (const [header, target] of Object.entries(mapping)) {
    if (target === canonical) return header;
  }
  return null;
}
