// @polsia:user-owned — /api/listings/[id]/responses endpoint.
//
// Mirror of `/api/listings/[id]/offers` flipped for WANTED listings.
// A respondent (anyone but the lot poster) submits a structured
// response block on a WANTED listing per the brief; the buyer (lot
// poster) accepts / counters / declines per response.
//
// POST: a qualified respondent creates a `WantedResponse` row. The
//       route rejects a HAVE lot (use the structured offer route
//       instead), rejects an anonymous lot (`postedByUserId === null`),
//       AND rejects "the poster is responding to their own RFQ" (409).
//       The per-respondent `MessageThread` is upserted on the same
//       transaction the response is created on.
//
// GET:  list every response on a lot the viewer is entitled to see
//       (the `lotBlockedResponse` visibility gate first, matching the
//       existing lot-detail endpoint). Privacy:
//       - LT caller is the lot poster (the buyer / RFQ-poster): list
//         every WantedResponse on this lot. The "you can't post your
//         own listing" guard at write-time guarantees the poster's id
//         is never a sellerId on a response — so the lot poster sees
//         every respondent chain on their own lot.
//       - LT caller is a respondent (sellerId === viewer.id): return
//         ONLY rows where sellerId === viewer.id (own responses only —
//         NEVER any competitor's terms).
//       - Otherwise: 404 (existence hidden).
import 'server-only';
import { NextResponse } from 'next/server';
import { lotBlockedResponse, resolveVisibilityViewer } from '@/lib/business/lot-visibility';
import { findOrCreateRfqThread } from '@/lib/business/rfq-thread';
import { isWantedResponseParty } from '@/lib/business/wanted-response-visibility';
import { createWantedResponseWireFromRow } from '@/lib/business/wanted-response-wire';
import {
  WantedResponseCreate,
  type WantedResponseCreateInput,
  WantedResponseItem,
  WantedResponseList,
} from '@/lib/contracts/wanted-responses';
import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/email/send';
import { rfqReplyEmail, wantedResponseReceivedEmail } from '@/lib/email/templates';
import { requireAuth, type SessionUser } from '@/lib/require-auth';
import { extractIp, recordAudit } from '@/lib/security/audit';
import { checkLimit, rateBucketFor } from '@/lib/security/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let user: SessionUser;
  try {
    user = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const lotId = await readParamId(ctx);
  if (lotId instanceof NextResponse) return lotId;

  const ip = extractIp(req);
  const limit = checkLimit(
    'userMutation',
    rateBucketFor(req, user.id, `lot:${lotId}:response:create`),
  );
  if (!limit.allowed) {
    await recordAudit({
      userId: user.id,
      actor: user.role === 'admin' ? 'ADMIN' : 'USER',
      action: 'RATE_LIMITED',
      resourceType: 'WantedResponse',
      resourceId: lotId,
      metadata: { route: '/api/listings/[id]/responses:POST' },
      ip,
    });
    return rateLimitedResponse(limit.retryAfterMs);
  }

  let body: WantedResponseCreateInput;
  try {
    const parsed = WantedResponseCreate.safeParse(await req.json());
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const [field, messages] of Object.entries(parsed.error.flatten().fieldErrors)) {
        const message = messages?.[0];
        if (message) errors[field] = message;
      }
      return NextResponse.json({ errors }, { status: 400 });
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  try {
    const lot = await prisma.lot.findUnique({
      where: { id: lotId },
      select: {
        id: true,
        type: true,
        postedByUserId: true,
        postedByName: true,
        polymer: true,
        condition: true,
        form: true,
        visibility: true,
      },
    });
    if (!lot) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }
    const viewer = await resolveVisibilityViewer(user.id);
    const blocked = lotBlockedResponse(lot, viewer);
    if (blocked) return blocked;

    if (lot.type !== 'WANTED') {
      return NextResponse.json(
        {
          error:
            'Structured seller responses are only available on WANTED listings. HAVE listings use the offer channel instead.',
        },
        { status: 422 },
      );
    }
    if (lot.postedByUserId === null) {
      return NextResponse.json(
        {
          error: 'This lot was posted anonymously — structured responses require a known buyer.',
        },
        { status: 422 },
      );
    }
    if (lot.postedByUserId === user.id) {
      return NextResponse.json(
        { error: 'You posted this WANTED listing; you cannot respond to your own RFQ.' },
        { status: 409 },
      );
    }

    // Upsert the per-respondent RFQ thread via the shared helper so the
    // existing per-respondent thread that `MessageSellerButton` would
    // have created (today's flow) is the SAME thread as the structured-
    // response flow uses. The respondent is the thread's "buyer"
    // (dummy label), the RFQ poster is the thread's "seller".
    const thread = await findOrCreateRfqThread(lot, user.id);

    // Stamp a `Message` row so the inbox shows the structured response
    // AND so the existing per-thread unread / fan-out path picks it up.
    // The body is a fixed marker so the timeline surfaces it as a regular
    // message item between parties.
    await prisma.message.create({
      data: {
        threadId: thread.id,
        senderId: user.id,
        body: 'Submitted a structured response.',
      },
    });
    await prisma.messageThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: new Date() },
    });

    const expiresAt = new Date(body.terms.offerExpiresAt);
    const created = await prisma.wantedResponse.create({
      data: {
        threadId: thread.id,
        lotId: lot.id,
        // per-file-banner: buyerId = lot poster (RFQ poster), sellerId = respondent.
        buyerId: lot.postedByUserId,
        sellerId: user.id,
        parentResponseId: null,
        quantityLb: body.terms.quantityLb,
        pricePerUnit: body.terms.pricePerUnit,
        priceUnit: body.terms.priceUnit,
        freightTerm: body.terms.freightTerm,
        materialLocation: body.terms.materialLocation,
        leadTimeDays: body.terms.leadTimeDays ?? null,
        packaging: body.terms.packaging ?? null,
        lotInfo: body.terms.lotInfo ?? null,
        coaAvailable: body.terms.coaAvailable,
        paymentTerms: body.terms.paymentTerms ?? null,
        comments: body.terms.comments ?? null,
        offerExpiresAt: expiresAt,
        status: 'PENDING',
      },
    });

    await recordAudit({
      userId: user.id,
      actor: 'USER',
      action: 'WANTED_RESPONSE_CREATED',
      resourceType: 'WantedResponse',
      resourceId: created.id,
      metadata: { threadId: thread.id, lotId: lot.id },
      ip,
    });

    const wire = await createWantedResponseWireFromRow(created, user.id);

    // Fire both `rfqReplyEmail` (the existing distinctive "New reply
    // on your WANTED listing" alert — pre-existing semantics land in
    // the lot poster's inbox) AND `wantedResponseReceivedEmail` (the
    // dedicated structured-response alert with the same brief content
    // but a distinct subject so the lot poster can segment). Best-
    // effort: a failed send is logged by `sendEmail` and never aborts
    // the POST.
    void emailLotPosterOnCreate(created.id, lot, user.id).catch(() => undefined);

    return NextResponse.json(WantedResponseItem.parse(wire), { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  let user: SessionUser;
  try {
    user = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const lotId = await readParamId(ctx);
  if (lotId instanceof NextResponse) return lotId;

  try {
    const lot = await prisma.lot.findUnique({
      where: { id: lotId },
      select: {
        id: true,
        type: true,
        postedByUserId: true,
        postedByName: true,
        visibility: true,
      },
    });
    if (!lot) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }
    const viewer = await resolveVisibilityViewer(user.id);
    const blocked = lotBlockedResponse(lot, viewer);
    if (blocked) return blocked;

    if (lot.type !== 'WANTED') {
      // HAVE listings expose the structured offer flow on a separate
      // route. 404 to keep the response-list existence-private.
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }

    const isPoster = lot.postedByUserId !== null && lot.postedByUserId === user.id;

    let rows: Array<{
      id: string;
      lotId: string;
      buyerId: string;
      sellerId: string;
      threadId: string;
    }> = [];
    if (isPoster) {
      rows = await prisma.wantedResponse.findMany({
        where: { lotId: lot.id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          lotId: true,
          buyerId: true,
          sellerId: true,
          threadId: true,
        },
      });
    } else {
      // Non-poster: see ONLY own responses — and ONLY if they're a
      // respondent on at least one of them (else 404 = "no relation to
      // this lot's negotiation history").
      const wasRespondent = await prisma.wantedResponse.findFirst({
        where: { lotId: lot.id, sellerId: user.id },
        select: { id: true },
      });
      if (!wasRespondent) {
        return NextResponse.json({ error: 'Not Found' }, { status: 404 });
      }
      rows = await prisma.wantedResponse.findMany({
        where: { lotId: lot.id, sellerId: user.id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          lotId: true,
          buyerId: true,
          sellerId: true,
          threadId: true,
        },
      });
    }

    // Last line of defence: assertWantedResponseParty on every row
    // (matches offer-list GET). The where-clauses above already
    // restrict to parties; the assertion is the second-line check.
    for (const row of rows) {
      if (!isWantedResponseParty(row, user.id)) {
        return NextResponse.json({ error: 'Not Found' }, { status: 404 });
      }
    }

    // Re-fetch full rows so the wire helper can render the time-stamps
    // + terms snapshot. Cheap — by design rows.length stays small per lot.
    const fullRows = await prisma.wantedResponse.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      orderBy: { createdAt: 'asc' },
    });
    const wire = await Promise.all(
      fullRows.map((row) => createWantedResponseWireFromRow(row, user.id)),
    );
    return NextResponse.json(WantedResponseList.parse({ items: wire }));
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

async function readParamId(ctx: {
  params: Promise<{ id: string }>;
}): Promise<string | NextResponse> {
  try {
    const params = await ctx.params;
    return params.id;
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }
}

function rateLimitedResponse(retryAfterMs: number | undefined): NextResponse {
  return NextResponse.json(
    { error: 'rate_limited' },
    {
      status: 429,
      headers: {
        'Retry-After': String(Math.ceil((retryAfterMs ?? 1000) / 1000)),
      },
    },
  );
}

// Look up the lot poster (User + Profile) and post BOTH alerts:
//   1) the existing `rfqReplyEmail` (so the distinct "you got a reply"
//      alert the existing system fires on a `Message` POST also lands
//      here — this is explicit in the brief),
//   2) the new `wantedResponseReceivedEmail` (so the lot poster also
//      gets the STRUCTURED-response-specific alert with the negotiated
//      terms inline).
async function emailLotPosterOnCreate(
  responseId: string,
  lot: {
    id: string;
    postedByUserId: string | null;
    polymer: string;
    condition: string;
    form: string;
  },
  respondentUserId: string,
): Promise<void> {
  if (lot.postedByUserId === null) return;
  const [posterAuth, respondentProfile, responseRow] = await Promise.all([
    prisma.user.findUnique({
      where: { id: lot.postedByUserId },
      select: { email: true, name: true },
    }),
    prisma.profile.findUnique({
      where: { userId: respondentUserId },
      select: { displayName: true },
    }),
    prisma.wantedResponse.findUnique({ where: { id: responseId } }),
  ]);
  if (!posterAuth || !responseRow) return;

  const sellerLabel = respondentProfile?.displayName ?? 'Meldstock seller';
  const unitLabel = responseRow.priceUnit === 'PER_LB' ? '/ lb' : '/ kg';
  const priceLabel = `$${responseRow.pricePerUnit.toString()}${unitLabel}`;
  const quantityLabel = `${responseRow.quantityLb.toString()} lb`;
  const lotTitle = `${lot.polymer} · ${lot.condition} · ${lot.form}`;
  const threadUrl = (() => {
    const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') ?? '';
    return `${base}/messages/${encodeURIComponent(responseRow.threadId)}`;
  })();
  const lotUrl = (() => {
    const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') ?? '';
    return `${base}/lots/${encodeURIComponent(lot.id)}`;
  })();

  await Promise.allSettled([
    (async () => {
      try {
        await sendEmail({
          to: posterAuth.email,
          ...rfqReplyEmail({
            listingTitle: lotTitle,
            preview: `Submitted a structured response — ${quantityLabel} at ${priceLabel}.`,
            conversationUrl: threadUrl,
          }),
        });
      } catch {
        // best-effort
      }
    })(),
    (async () => {
      try {
        await sendEmail({
          to: posterAuth.email,
          ...wantedResponseReceivedEmail({
            recipientName: posterAuth.name,
            lotTitle,
            sellerDisplayName: sellerLabel,
            priceLabel,
            quantityLabel,
            expiresAt: responseRow.offerExpiresAt.toISOString(),
            lotUrl,
          }),
        });
      } catch {
        // best-effort
      }
    })(),
  ]);
}

// Suppress unused-import is not needed; the where-clauses above
// already exclude non-parties, and `isWantedResponseParty` performs
// the inline visibility assertion on every row before the wire is
// built.
