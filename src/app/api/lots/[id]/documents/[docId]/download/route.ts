// @polsia:user-owned — GET /api/lots/[lotId]/documents/[docId]/download
//
// Per-document download proxy. Re-checks the lot viewer gate BEFORE
// streaming bytes, then forwards the R2 CDN response to the browser
// with the right Content-Type + Content-Disposition headers so the
// document saves with the broker's original filename.
//
// Why a proxy? The raw R2 CDN URL is guessable from `<company_slug>/<cuid>.<ext>`
// (per the r2-proxy contract) — anyone who saw the URL once (via the
// /api/lots/[id] detail response, the document list rendered on a page,
// or scraped profile responses) could re-fetch it with no auth. The
// proxy re-checks the lot viewer gate every request, so:
//
//   - 401 for an unauthed caller
//   - 403 for an authed caller who can't see the lot (gated normally)
//   - 404 for a non-existent / wrong-lot document (existence is hidden)
//
// Audit: each access stamps LOT_DOCUMENT_DOWNLOADED so a senior reviewer
// can later answer "who accessed which document when".
import 'server-only';
import { NextResponse } from 'next/server';
import { anonymousDocumentFilename } from '@/lib/business/anonymity';
import { lotBlockedResponse, resolveVisibilityViewer } from '@/lib/business/lot-visibility';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/require-auth';
import { extractIp, recordAudit } from '@/lib/security/audit';
import { checkLimit, extractIp as headerIp, rateBucketFor } from '@/lib/security/rate-limit';
import { services } from '@/lib/services';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string; docId: string }> }) {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try {
    user = await requireAuth(req);
  } catch (res) {
    return res as Response;
  }
  try {
    const { id: lotId, docId } = await ctx.params;
    const userId = user.id;
    const userRole = user.role;
    const ip = extractIp(req) ?? headerIp(req);

    // Per-lot download rate limit — caps brute-force scrapes against a
    // single lot. Audit even on 429 so suspicious traffic is observable.
    const limit = checkLimit('listRead', rateBucketFor(req, userId, `lot:${lotId}:doc-download`));
    if (!limit.allowed) {
      await recordAudit({
        userId,
        actor: userRole === 'admin' ? 'ADMIN' : 'USER',
        action: 'RATE_LIMITED',
        resourceType: 'Document',
        resourceId: docId,
        metadata: { route: '/api/lots/[id]/documents/[docId]:GET' },
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

    const viewer = await resolveVisibilityViewer(userId);
    const [lot, doc] = await Promise.all([
      prisma.lot.findUnique({
        where: { id: lotId },
        select: {
          id: true,
          visibility: true,
          postedByUserId: true,
          selectedCompanyIdentifiers: true,
        },
      }),
      prisma.document.findUnique({
        where: { id: docId },
        select: {
          id: true,
          lotId: true,
          filename: true,
          url: true,
          mimeType: true,
        },
      }),
    ]);
    if (!lot) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }
    const blocked = lotBlockedResponse(lot, viewer);
    if (blocked) return blocked;
    if (!doc || doc.lotId !== lotId) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }

    let stored: { bytes: Buffer; mimeType?: string };
    try {
      stored = await services.storage.get(doc.url);
    } catch {
      return NextResponse.json({ error: 'Document temporarily unavailable' }, { status: 502 });
    }
    const buf = stored.bytes;

    await recordAudit({
      userId,
      actor: userRole === 'admin' ? 'ADMIN' : 'USER',
      action: 'LOT_DOCUMENT_DOWNLOADED',
      resourceType: 'Document',
      resourceId: docId,
      metadata: { lotId, filename: doc.filename, mimeType: doc.mimeType, bytes: buf.length },
      ip,
    });

    const safeName = (
      lot.visibility === 'ANONYMOUS' ? anonymousDocumentFilename('document', doc.id) : doc.filename
    ).replace(/["\r\n]/g, '');
    return new Response(buf, {
      headers: {
        'content-type': doc.mimeType || 'application/octet-stream',
        'content-length': String(buf.length),
        'content-disposition': `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
        'cache-control': 'private, no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
