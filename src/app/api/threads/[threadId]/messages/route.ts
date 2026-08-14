// @polsia:user-owned — /api/threads/[threadId]/messages endpoint.
//
// POST: append a message to the thread, bump lastMessageAt on the parent,
// in one transaction so the inbox sort stays consistent. Authorization:
// current participant in `ThreadParticipant` (gate migrates legacy 1:1
// threads on its first read); otherwise 403.
//
// ANONYMOUS hardening (G2): when the source lot is ANONYMOUS AND the
// sender is the lot's posting owner, the fan-out's `senderName` (email
// subject + inbox row) is masked to "the seller" — matches the lot wire's
// ANONYMOUS_SCRUB, so neither the inbox row nor the email fan-out can
// leak the broker's real displayName. The actual message body is still
// delivered to the participant — only the inferred identity (displayName)
// is masked. `anonymityFor(thread, senderId)` centralises the rule.
//
// Rate limiting (G4): per-(userId, threadId) at the thread-message
// preset so a participant can't spam-buffer the digest. Audit on every
// masked fan-out so a senior reviewer can later see when ANONYMOUS
// masks were applied.
import 'server-only';
import { NextResponse } from 'next/server';
import { type AnonymityMode, anonymityFor, maskedSenderName } from '@/lib/business/anonymity';
import { conditionLabel, polymerLabel } from '@/lib/business/lots';
import {
  flushDueThreadDigests,
  recordThreadMessage,
  stampThreadDigest,
  tryClaimThreadDigest,
} from '@/lib/business/notifications';
import { isThreadParticipant } from '@/lib/business/thread-participants';
import { attachmentDownloadUrl } from '@/lib/contracts/documents';
import type { LotCondition, Polymer } from '@/lib/contracts/lots';
import { CreateMessage, MessageItem } from '@/lib/contracts/messaging';
import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/email/send';
import { rfqReplyEmail, threadMessageEmail } from '@/lib/email/templates';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { resolveAttachmentToken } from '@/lib/security/attachment-token';
import { extractIp, recordAudit } from '@/lib/security/audit';
import { checkLimit, extractIp as headerIp, rateBucketFor } from '@/lib/security/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ threadId: string }> }) {
  let user: SessionUser;
  try {
    user = await requireAuth(req);
  } catch (res) {
    return res as Response;
  }

  let threadId: string;
  try {
    const params = await ctx.params;
    threadId = params.threadId;
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  const ip = extractIp(req) ?? headerIp(req);

  // Per-(userId, threadId) rate-limit BEFORE the DB write so a brute-
  // force spammer can't tie up the transaction queue. Audit on 429.
  const limit = checkLimit('threadMessagesPost', rateBucketFor(req, user.id, `thread:${threadId}`));
  if (!limit.allowed) {
    await recordAudit({
      userId: user.id,
      actor: user.role === 'admin' ? 'ADMIN' : 'USER',
      action: 'RATE_LIMITED',
      resourceType: 'Thread',
      resourceId: threadId,
      metadata: { route: '/api/threads/[threadId]/messages:POST' },
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

  let body: string;
  let attachmentToken: string | undefined;
  try {
    const parsed = CreateMessage.safeParse(await req.json());
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const [field, messages] of Object.entries(parsed.error.flatten().fieldErrors)) {
        const message = messages?.[0];
        if (message) errors[field] = message;
      }
      return NextResponse.json({ errors }, { status: 400 });
    }
    body = parsed.data.body;
    attachmentToken = parsed.data.attachmentToken;
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  try {
    const thread = await prisma.messageThread.findUnique({ where: { id: threadId } });
    if (!thread) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }
    const participant = await isThreadParticipant(thread, user.id);
    if (!participant) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let attachment: { token: string; filename: string; mimeType: string } | undefined;
    if (attachmentToken) {
      try {
        const resolved = resolveAttachmentToken(attachmentToken, {
          expectedUploadedBy: user.id,
          maxAgeMs: 60 * 60 * 1000,
        });
        attachment = {
          token: attachmentToken,
          filename: resolved.filename,
          mimeType: resolved.mimeType,
        };
      } catch {
        return NextResponse.json({ error: 'Invalid attachment reference' }, { status: 400 });
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const msg = await tx.message.create({
        data: {
          threadId: thread.id,
          senderId: user.id,
          body,
          attachmentUrl: attachment?.token,
          attachmentFilename: attachment?.filename,
          attachmentMimeType: attachment?.mimeType,
        },
      });
      await tx.messageThread.update({
        where: { id: thread.id },
        data: { lastMessageAt: new Date() },
      });
      return msg;
    });

    void fanOutThreadMessage(thread, user, created).catch(() => {});

    const wire = MessageItem.parse({
      id: created.id,
      threadId: created.threadId,
      senderId: created.senderId,
      body: created.body,
      createdAt: created.createdAt.toISOString(),
      attachmentUrl: created.attachmentUrl ? attachmentDownloadUrl(thread.id, created.id) : null,
      attachmentFilename: created.attachmentFilename ?? null,
      attachmentMimeType: created.attachmentMimeType ?? null,
    });
    return NextResponse.json(wire, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// After a message is created, fan out an email to every thread participant
// except the sender. Skips recipients already at-or-after this message's
// `createdAt` (same rule the dashboard unread widget uses). Failures are
// swallowed.
//
// ANONYMOUS hardening (G2): when the source lot is ANONYMOUS AND the
// sender is the lot's owner, the fan-out `senderName` (passed into the
// generic `threadMessageEmail` AND the inbox row's `senderName` payload)
// is masked to "the seller". The masking applies to the EMAIL ONLY —
// the actual message body remains on the wire to the recipient UI.
// Audit row stamps `SENSITIVE_THREAD_MESSAGE_FANNED_OUT`.
async function fanOutThreadMessage(
  thread: { id: string; lotId: string | null; subject: string },
  sender: SessionUser,
  message: { id: string; createdAt: Date; body: string },
): Promise<void> {
  try {
    const [senderProfile, lot, participants, cursors] = await Promise.all([
      prisma.profile.findUnique({
        where: { userId: sender.id },
        select: { displayName: true },
      }),
      thread.lotId !== null
        ? prisma.lot.findUnique({
            where: { id: thread.lotId },
            select: {
              polymer: true,
              condition: true,
              form: true,
              type: true,
              postedByUserId: true,
              visibility: true,
            },
          })
        : Promise.resolve(null),
      prisma.threadParticipant.findMany({
        where: { threadId: thread.id, userId: { not: sender.id } },
        select: { userId: true },
      }),
      prisma.threadReadState.findMany({
        where: { threadId: thread.id },
        select: { userId: true, lastReadAt: true },
      }),
    ]);
    if (participants.length === 0) return;

    const cursorByUser = new Map(cursors.map((c) => [c.userId, c.lastReadAt]));
    const recipientIds = participants
      .filter((p) => {
        const cursor = cursorByUser.get(p.userId);
        return !(cursor && cursor.getTime() >= message.createdAt.getTime());
      })
      .map((p) => p.userId);
    if (recipientIds.length === 0) return;

    const [profiles, users] = await Promise.all([
      prisma.profile.findMany({
        where: { userId: { in: recipientIds } },
        select: { userId: true, displayName: true },
      }),
      prisma.user.findMany({
        where: { id: { in: recipientIds } },
        select: { id: true, email: true, name: true },
      }),
    ]);
    const profileByUser = new Map(profiles.map((p) => [p.userId, p]));

    // Anonymity rule (centralised): on ANONYMOUS-lot threads where the
    // SENDER is the lot poster, the fan-out surfaces "the seller"
    // instead of the broker's real displayName. The buyer's identity on
    // an ANONYMOUS listing is intentional (the seller needs to know
    // who's making an enquiry).
    const anonymity: AnonymityMode = anonymityFor(
      lot ? { visibility: lot.visibility, postedByUserId: lot.postedByUserId } : null,
      sender.id,
    );
    const safeSenderName = maskedSenderName(anonymity, senderProfile?.displayName ?? sender.name);

    if (anonymity === 'ANONYMOUS_LOT_SIDE') {
      await recordAudit({
        userId: sender.id,
        action: 'SENSITIVE_THREAD_MESSAGE_FANNED_OUT',
        resourceType: 'Thread',
        resourceId: thread.id,
        metadata: {
          messageId: message.id,
          recipientCount: recipientIds.length,
          reason: 'anonymous_lot_side',
        },
      });
    }

    const lotTitle = lot
      ? `${polymerLabel(lot.polymer as Polymer)} · ${conditionLabel(lot.condition as LotCondition)}`
      : thread.subject;
    const preview = truncate(message.body, 120);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') ?? '';
    const conversationUrl = `${baseUrl}/messages/${thread.id}`;
    const isRfqReply = thread.lotId !== null && lot?.type === 'WANTED';

    try {
      await flushDueThreadDigests({
        threadId: thread.id,
        threadSubject: lotTitle,
        conversationUrl,
      });
    } catch {
      // Whole-flush failure — the per-recipient loop below still runs.
    }

    // Distinctive "buyer replied to your WANTED posting" alert — goes ONLY to
    // the lot's posting owner, NOT to every thread participant. The rfqReply
    // path intentionally surfaces the buyer's NAME (the seller needs to
    // know who replied), so the ANONYMOUS_LOT_SIDE mask does NOT apply
    // here. The buyer-reply path is NEVER the masking branch because the
    // source sender is a buyer on a WANTED listing.
    if (isRfqReply && lot && lot.postedByUserId !== null && lot.postedByUserId !== sender.id) {
      try {
        const owner = await prisma.user.findUnique({
          where: { id: lot.postedByUserId },
          select: { id: true, email: true },
        });
        if (owner?.email) {
          try {
            await sendEmail({
              to: owner.email,
              ...rfqReplyEmail({ listingTitle: lotTitle, preview, conversationUrl }),
            });
          } catch {
            // Per-recipient failure — never poisons the fan-out.
          }
        }
      } catch {
        // Owner-lookup failure — never poisons the POST response.
      }
    }

    await Promise.allSettled(
      users.map(async (u) => {
        if (!u.email) return;
        const profile = profileByUser.get(u.id);
        const recipientName = profile?.displayName ?? u.name;

        const claim = tryClaimThreadDigest(u.id, thread.id);
        if (claim.state === 'send-now') {
          try {
            await sendEmail({
              to: u.email,
              ...threadMessageEmail({
                recipientName,
                senderName: safeSenderName,
                lotTitle,
                preview,
                conversationUrl,
              }),
            });
          } catch {
            // Per-recipient sends can't poison the fan-out.
          }
        }
        stampThreadDigest(
          u.id,
          thread.id,
          { senderName: safeSenderName, preview, sentAt: message.createdAt },
          { email: u.email, recipientName },
        );

        const isRfqReplyRow = thread.lotId !== null && lot?.type === 'WANTED';
        recordThreadMessage(u.id, {
          threadId: thread.id,
          messageId: message.id,
          senderName: safeSenderName,
          isRfqReply: isRfqReplyRow,
        }).catch(() => {});
      }),
    );
  } catch {
    // Whole-block failure (e.g. DB blip) — never reach the POST response.
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}
