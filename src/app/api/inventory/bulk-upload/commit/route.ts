// @polsia:user-owned — POST /api/inventory/bulk-upload/commit.
//
// The commit step in the new bulk-upload wizard. Re-parses the same
// multipart file the preview step sent (defense in depth: the server
// validates the file from the source again instead of trusting the
// client's per-row edits), applies the seller's final header mapping +
// per-row edits, runs the same per-row validator, then writes the
// valid rows as real `Lot` rows (status = ACTIVE) inside one
// `prisma.lot.createMany` call. Invalid rows come back under `skipped`
// with the reasons so the wizard can fix them in-app and re-commit.
//
// Auth: `requireAuth()` 401s any non-signed-in caller; every committed
// row is stamped with `postedByUserId = user.id` so the dashboard +
// lifecycle cron agree on ownership.
import 'server-only';
import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  type ParsedFile,
  parseUploadedFile,
} from '@/lib/business/inventory-bulk-upload/parse-file';
import {
  applyEdits,
  applyMapping,
  validateMappedRow,
} from '@/lib/business/inventory-bulk-upload/validate';
import { touchLotBump } from '@/lib/business/lot-lifecycle';
import { CommitRequestSchema, CommitResponseSchema } from '@/lib/contracts/inventory-bulk-upload';
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

  const jsonRaw = fd.get('payload');
  if (typeof jsonRaw !== 'string' || jsonRaw.length === 0) {
    return NextResponse.json({ error: 'Missing payload field' }, { status: 400 });
  }
  let payloadJson: unknown;
  try {
    payloadJson = JSON.parse(jsonRaw);
  } catch {
    return NextResponse.json({ error: 'Invalid payload JSON' }, { status: 400 });
  }
  const payload = CommitRequestSchema.safeParse(payloadJson);
  if (!payload.success) {
    return NextResponse.json(
      { error: 'Invalid payload', issues: payload.error.flatten() },
      { status: 400 },
    );
  }

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

  const mapping = payload.data.mapping;
  const editsByRow = payload.data.edits;

  const quantityHeader = findHeaderFor(mapping, 'quantity');
  const priceHeader = findHeaderFor(mapping, 'askingPricePerLb');

  const validRows: Array<{
    rowIndex: number;
    id: string;
    data: ReturnType<typeof pickCreateArgs>;
  }> = [];
  const skipped: Array<{
    rowIndex: number;
    message: string;
    errors: Array<{ field: string; message: string }>;
  }> = [];

  parsed.model.rows.forEach((row, idx) => {
    const rowIndex = idx + 1;
    const key = String(rowIndex);
    const rowEdit = editsByRow[key] ?? {};
    const mapped = applyMapping(row, mapping);
    const merged = applyEdits(mapped, rowEdit);
    const result = validateMappedRow(merged, {
      posterName,
      quantityHeader,
      priceHeader,
    });
    if (!result.ok) {
      skipped.push({
        rowIndex,
        message: result.errors[0]?.message ?? 'row did not validate',
        errors: result.errors.map((e) => ({ field: e.field, message: e.message })),
      });
      return;
    }
    validRows.push({
      rowIndex,
      id: generateId(),
      data: pickCreateArgs(result.data, userId),
    });
  });

  let imported: Array<{ rowIndex: number; lotId: string }> = [];
  if (validRows.length > 0) {
    // createMany doesn't return per-row IDs. We pre-generate opaque
    // collision-safe IDs so the wizard can deep-link to any committed
    // lot from the success panel. The lifecycle brief bumps
    // `lastUpdatedAt` here so the row counts as fresh in the staleness
    // window.
    const bump = touchLotBump();
    const inserted = validRows.map((v) => ({
      ...v.data,
      id: v.id,
      quantityRemaining: v.data.quantityLb,
      status: 'ACTIVE' as const,
      postedAt: new Date(),
      lastUpdatedAt: bump.lastUpdatedAt,
      lastNudgedAt: null,
      lastConfirmedAt: null,
    }));
    await prisma.lot.createMany({ data: inserted });
    imported = validRows.map((v) => ({ rowIndex: v.rowIndex, lotId: v.id }));
  }

  skipped.sort((a, b) => a.rowIndex - b.rowIndex);
  imported.sort((a, b) => a.rowIndex - b.rowIndex);

  const wire = CommitResponseSchema.parse({ imported, skipped });
  return NextResponse.json(wire, { status: 200 });
}

function pickCreateArgs(
  data: import('@/lib/contracts/lots').CreateLot & { postedByName: string },
  postedByUserId: string,
) {
  return {
    type: data.type,
    polymer: data.polymer,
    condition: data.condition,
    color: data.color,
    form: data.form,
    manufacturer: data.manufacturer ?? null,
    grade: data.grade ?? null,
    quantityLb: data.quantityLb,
    packaging: data.packaging,
    location: data.location ?? null,
    country: data.country,
    askingPricePerLb: data.askingPricePerLb ?? null,
    hasCoa: data.hasCoa,
    notes: data.notes ?? null,
    postedByName: data.postedByName,
    postedByUserId,
    visibility: data.visibility,
  };
}

function findHeaderFor(mapping: Record<string, string | null>, canonical: string): string | null {
  for (const [header, target] of Object.entries(mapping)) {
    if (target === canonical) return header;
  }
  return null;
}

/**
 * Opaque collision-safe row id. Format: prefix + timestamp + random
 * hex. Collision probability at 5000 rows is negligible.
 */
function generateId(): string {
  const stamp = Date.now().toString(36);
  const random = randomBytes(8).toString('hex');
  return `c${stamp}${random}`;
}
