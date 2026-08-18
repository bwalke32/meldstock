// @polsia:user-owned — POST /api/lots/[id]/documents
//
// Attach one or more PDFs (COA / TDS / SDS / certifications / test reports)
// to a lot. Each multipart upload carries a sibling `type` text field giving
// the DocumentType (`COA` default if omitted). Caps apply at the lot level
// (max 5 docs) and per file (max 50 MB). After a successful upload, the lot's
// `hasCoa` flag is flipped to true — matching the brief's redefinition that
// the COA checkbox means "≥ 1 document attached", not user-toggled.
//
// Auth: `requireAuth()` + owner check (`lot.postedByUserId === userId`).
// Anonymous posters have no `postedByUserId` so they're rejected here by
// construction; that aligns with the new semantic (an anonymous lot can't
// carry a "documents attached" meaning).
//
// Files ride through the R2 proxy exactly as `src/app/api/attachments/upload`
// does — `node-fetch` + `form-data` (native fetch breaks form-data streams;
// see .agents/skill-docs/r2-proxy/SKILL.md).
//
// Wire hardening: the `url` stamped on every response is the OPAQUE
// relative download proxy path (`/api/lots/<lotId>/documents/<docId>/
// download`) — the raw R2 CDN URL is write-only (catalog-only on the wire).
// The proxy re-checks the lot viewer gate so the URL can't be probed.
//
// Auditing: every successful upload stamps `LOT_DOCUMENT_UPLOADED` so a
// future senior reviewer can audit which broker attached which docs to
// which lot. Per-route rate-limit caps bursts so a malicious owner can't
// flood the lot cap to lock the broker out of their own documents.
//
// No GET here — documents ship inside `/api/lots/[id]`'s LotDetailResponse
// so the detail page only ever fetches once.
import 'server-only';
import { NextResponse } from 'next/server';
import { documentDownloadUrl } from '@/lib/contracts/documents';
import { DocumentTypeEnum } from '@/lib/contracts/lots';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/require-auth';
import { extractIp, recordAudit } from '@/lib/security/audit';
import { checkLimit, extractIp as headerIp, rateBucketFor } from '@/lib/security/rate-limit';
import { services } from '@/lib/services';
import type { StoredObject } from '@/lib/services/types';

export const dynamic = 'force-dynamic';

const MAX_DOCUMENTS_PER_LOT = 5;
const MAX_BYTES_PER_FILE = 50 * 1024 * 1024; // 50 MB, matches r2-proxy Documents limit
const ALLOWED_MIME = new Set(['application/pdf']);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = (await requireAuth()).id;
  } catch (res) {
    return res as Response;
  }
  const { id: lotId } = await ctx.params;
  const ip = extractIp(req) ?? headerIp(req);

  // Per-user upload rate limit (covers brute-force floods before any
  // R2 bandwidth is consumed). Identifies via session userId.
  const limit = checkLimit('upload', rateBucketFor(req, userId, `lot:${lotId}:docs`));
  if (!limit.allowed) {
    await recordAudit({
      userId,
      action: 'RATE_LIMITED',
      resourceType: 'Lot',
      resourceId: lotId,
      metadata: { route: '/api/lots/[id]/documents:POST', reason: 'rate_limit' },
      ip,
    });
    return NextResponse.json(
      { error: 'rate_limited' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((limit.retryAfterMs ?? 1000) / 1000)),
        },
      },
    );
  }

  const lot = await prisma.lot.findUnique({
    where: { id: lotId },
    select: { id: true, postedByUserId: true },
  });
  if (!lot) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }
  if (lot.postedByUserId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 });
  }

  const files: Array<{
    file: Blob;
    filename: string;
    type: 'COA' | 'TDS' | 'SDS' | 'CERTIFICATION' | 'TEST_REPORT' | 'OTHER';
  }> = [];
  let pendingType: 'COA' | 'TDS' | 'SDS' | 'CERTIFICATION' | 'TEST_REPORT' | 'OTHER' = 'COA';
  for (const [key, value] of fd.entries()) {
    if (key === 'type' && typeof value === 'string') {
      const parsed = DocumentTypeEnum.safeParse(value);
      if (parsed.success) pendingType = parsed.data;
      continue;
    }
    if (key === 'file' && value instanceof Blob) {
      files.push({
        file: value,
        filename: (value as File).name ?? 'upload.pdf',
        type: pendingType,
      });
    }
  }
  if (files.length === 0) {
    return NextResponse.json({ error: 'No files were submitted' }, { status: 400 });
  }

  const existingCount = await prisma.document.count({ where: { lotId } });
  if (existingCount + files.length > MAX_DOCUMENTS_PER_LOT) {
    return NextResponse.json(
      {
        error: `Up to ${MAX_DOCUMENTS_PER_LOT} documents per lot (already attached: ${existingCount}, attempted: ${files.length}).`,
      },
      { status: 400 },
    );
  }

  for (const f of files) {
    if (!ALLOWED_MIME.has(f.file.type)) {
      return NextResponse.json(
        { error: `${f.filename}: only PDF files are allowed` },
        { status: 400 },
      );
    }
    if (f.file.size > MAX_BYTES_PER_FILE) {
      return NextResponse.json(
        { error: `${f.filename}: file exceeds 50 MB limit` },
        { status: 400 },
      );
    }
  }

  const createdDocs: Array<{
    id: string;
    lotId: string;
    type: 'COA' | 'TDS' | 'SDS' | 'CERTIFICATION' | 'TEST_REPORT' | 'OTHER';
    filename: string;
    url: string;
    mimeType: string;
    createdAt: Date;
  }> = [];

  for (const f of files) {
    const buffer = Buffer.from(await f.file.arrayBuffer());
    let stored: StoredObject;
    try {
      stored = await services.storage.put({
        bytes: buffer,
        filename: f.filename,
        mimeType: f.file.type,
      });
    } catch {
      return NextResponse.json(
        { error: 'Upload failed', uploaded: createdDocs.map((d) => d.id) },
        { status: 502 },
      );
    }
    const persisted = await prisma.document.create({
      data: {
        lotId,
        type: f.type,
        filename: stored.filename,
        url: stored.key,
        mimeType: stored.mimeType,
      },
    });
    createdDocs.push(persisted);
  }

  await prisma.lot.update({
    where: { id: lotId },
    data: { hasCoa: true },
  });

  // Audit every successful upload — captures per-document type so a
  // future audit can answer "which broker attached a COA to this lot?".
  await recordAudit({
    userId,
    action: 'LOT_DOCUMENT_UPLOADED',
    resourceType: 'Lot',
    resourceId: lotId,
    metadata: {
      documentIds: createdDocs.map((d) => d.id),
      types: createdDocs.map((d) => d.type),
      count: createdDocs.length,
    },
    ip,
  });

  return NextResponse.json(
    {
      items: createdDocs.map((d) => ({
        id: d.id,
        lotId: d.lotId,
        type: d.type,
        filename: d.filename,
        url: documentDownloadUrl(d.lotId, d.id),
        mimeType: d.mimeType,
        createdAt: d.createdAt.toISOString(),
      })),
    },
    { status: 201 },
  );
}
