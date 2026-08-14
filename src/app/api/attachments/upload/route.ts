// @polsia:user-owned — POST /api/attachments/upload.
//
// Upload a single attachment (image, PDF, spreadsheet) for use on the
// thread-message writer. The R2 CDN URL is NEVER returned on the wire —
// we stamp an OPAQUE relative path the client uses as the href on
// `Message.attachmentUrl`. The download proxy at
// `/api/threads/<threadId>/attachments/<msgId>/download` re-checks the
// thread participant gate before streaming bytes (a CDN URL would be
// guessable from the cuid + slug).
//
// The response contains a server-issued encrypted attachment token. The
// message endpoint verifies its uploader and persists the opaque token in
// the legacy attachmentUrl column; clients never submit or receive the raw
// upstream storage URL.
//
// Rate-limit (G4): per-user upload preset. Audit on 429 so spikes are
// observable.
import 'server-only';
import FormDataNode from 'form-data';
import { NextResponse } from 'next/server';
import { AttachmentUploadResponse } from '@/lib/contracts/messaging';
import { requireAuth } from '@/lib/require-auth';
import {
  AttachmentConfigurationError,
  issueAttachmentToken,
} from '@/lib/security/attachment-token';
import { extractIp, recordAudit } from '@/lib/security/audit';
import { checkLimit, extractIp as headerIp, rateBucketFor } from '@/lib/security/rate-limit';

export const dynamic = 'force-dynamic';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

export async function POST(req: Request) {
  let userId: string;
  try {
    userId = (await requireAuth()).id;
  } catch (res) {
    return res as Response;
  }
  const ip = extractIp(req) ?? headerIp(req);

  const limit = checkLimit('upload', rateBucketFor(req, userId, 'attachment-upload'));
  if (!limit.allowed) {
    await recordAudit({
      userId,
      action: 'RATE_LIMITED',
      resourceType: 'Message',
      metadata: { route: '/api/attachments/upload:POST' },
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

  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 400 });
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: 'File too large' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = (file as File).name ?? 'upload';
  if (filename.length > 255) {
    return NextResponse.json({ error: 'Filename is too long' }, { status: 400 });
  }

  const uploadForm = new FormDataNode();
  uploadForm.append('file', buffer, { filename, contentType: file.type });

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeFetch = require('node-fetch') as typeof import('node-fetch').default;
  if (!process.env.POLSIA_API_KEY) {
    return NextResponse.json({ error: 'Attachment storage unavailable' }, { status: 503 });
  }

  let r2Res: Awaited<ReturnType<typeof nodeFetch>>;
  try {
    r2Res = await nodeFetch('https://polsia.com/api/proxy/r2/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.POLSIA_API_KEY}`,
        ...uploadForm.getHeaders(),
      },
      body: uploadForm,
    });
  } catch {
    return NextResponse.json({ error: 'Attachment storage unavailable' }, { status: 502 });
  }

  const r2Json = (await r2Res.json().catch(() => null)) as {
    success: boolean;
    file?: { url: string; filename: string; mime_type: string };
  } | null;
  if (!r2Json?.success || !r2Json.file) {
    return NextResponse.json({ error: 'Attachment storage unavailable' }, { status: 502 });
  }

  // The raw provider URL is sealed into an authenticated token and never
  // crosses the client trust boundary as a directly fetchable value.
  try {
    const wire = AttachmentUploadResponse.parse({
      token: issueAttachmentToken({
        upstreamUrl: r2Json.file.url,
        uploadedBy: userId,
        filename: r2Json.file.filename,
        mimeType: r2Json.file.mime_type,
      }),
      filename: r2Json.file.filename,
      mimeType: r2Json.file.mime_type,
    });
    return NextResponse.json(wire, { status: 201 });
  } catch (error) {
    const status = error instanceof AttachmentConfigurationError ? 503 : 502;
    return NextResponse.json({ error: 'Attachment storage unavailable' }, { status });
  }
}
