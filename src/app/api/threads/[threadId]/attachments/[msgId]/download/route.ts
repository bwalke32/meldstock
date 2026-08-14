// @polsia:user-owned — GET /api/threads/[threadId]/attachments/[msgId]/download
//
// Per-message attachment download proxy. Same hardening as the
// /api/lots/[id]/documents/[docId]/download sibling — re-checks the
// thread participant gate BEFORE streaming bytes so a leaked CDN URL
// can't be probed by a non-participant.
//
// 401 for unauth, 403 for auth-but-not-a-participant, 404 for non-
// existent / wrong-thread message. Audit per access.
import 'server-only';
import { NextResponse } from 'next/server';
import { anonymousAttachmentFilename, hidesAnonymousSeller } from '@/lib/business/anonymity';
import { isThreadParticipant } from '@/lib/business/thread-participants';
import { prisma } from '@/lib/db';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { resolveAttachmentToken } from '@/lib/security/attachment-token';
import { extractIp, recordAudit } from '@/lib/security/audit';
import { checkLimit, extractIp as headerIp, rateBucketFor } from '@/lib/security/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ threadId: string; msgId: string }> },
) {
  let user: SessionUser;
  try {
    user = await requireAuth(req);
  } catch (res) {
    return res as Response;
  }

  try {
    const { threadId, msgId } = await ctx.params;
    const ip = extractIp(req) ?? headerIp(req);

    const limit = checkLimit(
      'listRead',
      rateBucketFor(req, user.id, `thread:${threadId}:attach-download`),
    );
    if (!limit.allowed) {
      await recordAudit({
        userId: user.id,
        actor: user.role === 'admin' ? 'ADMIN' : 'USER',
        action: 'RATE_LIMITED',
        resourceType: 'Message',
        resourceId: msgId,
        metadata: { route: '/api/threads/[threadId]/attachments/[msgId]:GET' },
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

    const [thread, msg] = await Promise.all([
      prisma.messageThread.findUnique({
        where: { id: threadId },
        select: {
          id: true,
          buyerId: true,
          sellerId: true,
          createdAt: true,
          kind: true,
          createdById: true,
          lotId: true,
        },
      }),
      prisma.message.findUnique({
        where: { id: msgId },
        select: {
          id: true,
          threadId: true,
          attachmentUrl: true,
          attachmentFilename: true,
          attachmentMimeType: true,
          senderId: true,
        },
      }),
    ]);
    if (!thread) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }
    const participant = await isThreadParticipant(thread, user.id);
    if (!participant) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!msg || msg.threadId !== threadId || !msg.attachmentUrl) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }

    let attachment: ReturnType<typeof resolveAttachmentToken>;
    try {
      attachment = resolveAttachmentToken(msg.attachmentUrl);
    } catch {
      // Legacy raw URLs and forged tokens fail closed: never server-fetch
      // a value that came directly from a message write.
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }

    const upstream = await fetch(attachment.upstreamUrl, {
      cache: 'no-store',
      redirect: 'error',
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: 'Attachment temporarily unavailable' }, { status: 502 });
    }
    const buf = Buffer.from(await upstream.arrayBuffer());

    await recordAudit({
      userId: user.id,
      actor: user.role === 'admin' ? 'ADMIN' : 'USER',
      action: 'LOT_DOCUMENT_DOWNLOADED',
      resourceType: 'Message',
      resourceId: msgId,
      metadata: {
        threadId,
        filename: msg.attachmentFilename ?? null,
        bytes: buf.length,
        kind: 'thread_attachment',
      },
      ip,
    });

    const lot = thread.lotId
      ? await prisma.lot.findUnique({
          where: { id: thread.lotId },
          select: { visibility: true, postedByUserId: true },
        })
      : null;
    const hideSellerFilename =
      msg.senderId === thread.sellerId && hidesAnonymousSeller(lot, user.id);
    const safeName = (
      hideSellerFilename
        ? anonymousAttachmentFilename(msg.id, msg.attachmentMimeType)
        : (msg.attachmentFilename ?? 'attachment')
    ).replace(/["\r\n]/g, '');
    return new Response(buf, {
      headers: {
        'content-type': msg.attachmentMimeType ?? 'application/octet-stream',
        'content-length': String(buf.length),
        'content-disposition': `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
        'cache-control': 'private, no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
