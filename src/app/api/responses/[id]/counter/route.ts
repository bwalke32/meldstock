// @polsia:user-owned — /api/responses/[id]/counter — buyer COUNTER endpoint
// on the WANTED side. The plan constrains COUNTER to the BUYER (= RFQ
// poster) here — the eager inversion from the HAVE Offer flow where
// the SELLER counters. The chain alternates seller → buyer → seller →
// buyer; by induction every counter row is buyer-owned.
//
//   1. The current row transitions to COUNTERED (its `counteredAt`
//      timestamp stamped once);
//   2. A NEW `WantedResponse` row is created with parentResponseId =
//      current row, status = PENDING, and the buyer-supplied terms;
//   3. Both sides receive `wantedResponseCounteredEmail` so the seller
//      can reframe further without opening the lot page.
//
// All counter-side state lives in one Prisma transaction so a
// concurrent action on the same row can't slip a partial write.
import 'server-only';
import { NextResponse } from 'next/server';
import { assertWantedResponseParty } from '@/lib/business/wanted-response-visibility';
import { createWantedResponseWireFromRow } from '@/lib/business/wanted-response-wire';
import {
  WantedResponseCounter,
  type WantedResponseCounterInput,
} from '@/lib/contracts/wanted-responses';
import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/email/send';
import { wantedResponseCounteredEmail } from '@/lib/email/templates';
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

  let responseId: string;
  try {
    const params = await ctx.params;
    responseId = params.id;
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  const ip = extractIp(req);
  const limit = checkLimit(
    'userMutation',
    rateBucketFor(req, user.id, `response:${responseId}:counter`),
  );
  if (!limit.allowed) {
    await recordAudit({
      userId: user.id,
      actor: user.role === 'admin' ? 'ADMIN' : 'USER',
      action: 'RATE_LIMITED',
      resourceType: 'WantedResponse',
      resourceId: responseId,
      metadata: { route: '/api/responses/[id]/counter:POST' },
      ip,
    });
    return NextResponse.json(
      { error: 'rate_limited' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((limit.retryAfterMs ?? 1000) / 1000)) },
      },
    );
  }

  let body: WantedResponseCounterInput;
  try {
    const parsed = WantedResponseCounter.safeParse(await req.json());
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
    const current = await prisma.wantedResponse.findUnique({
      where: { id: responseId },
      select: {
        id: true,
        threadId: true,
        lotId: true,
        buyerId: true,
        sellerId: true,
        status: true,
      },
    });
    const gate = assertWantedResponseParty(current, user.id);
    if (gate) return gate;
    if (!current) return NextResponse.json({ error: 'Not Found' }, { status: 404 });

    if (user.id !== current.buyerId) {
      return NextResponse.json(
        {
          error:
            'Only the buyer (the RFQ poster) can counter a structured response; the seller should submit a fresh response instead.',
        },
        { status: 403 },
      );
    }
    if (current.status !== 'PENDING') {
      return NextResponse.json(
        { error: 'Only pending responses can be countered.' },
        { status: 409 },
      );
    }

    const now = new Date();
    const counter = await prisma.$transaction(async (tx) => {
      await tx.wantedResponse.update({
        where: { id: current.id },
        data: { status: 'COUNTERED', counteredAt: now },
      });
      return await tx.wantedResponse.create({
        data: {
          threadId: current.threadId,
          lotId: current.lotId,
          // Children inherit buyer/seller from the parent — the chain
          // is one user-owned table. Author of THIS row is the buyer
          // (RFQ poster), since counter is buyer-only.
          buyerId: current.buyerId,
          sellerId: current.sellerId,
          parentResponseId: current.id,
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
          offerExpiresAt: new Date(body.terms.offerExpiresAt),
          status: 'PENDING',
        },
      });
    });

    await recordAudit({
      userId: user.id,
      actor: 'USER',
      action: 'WANTED_RESPONSE_COUNTERED',
      resourceType: 'WantedResponse',
      resourceId: counter.id,
      metadata: {
        threadId: current.threadId,
        lotId: current.lotId,
        parentResponseId: current.id,
      },
      ip,
    });

    const wire = await createWantedResponseWireFromRow(counter, user.id);

    void emailCountered(counter.id, user.id).catch(() => undefined);

    return NextResponse.json(wire, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// Notify BOTH parties when a counter is stamped. The plan mandates
// "Email both parties" — the buyer-side mail confirms their own action
// persisted, the seller-side mail tells them terms are now their turn
// to revise.
async function emailCountered(counterResponseId: string, whoCountered: string): Promise<void> {
  const counterRow = await prisma.wantedResponse.findUnique({
    where: { id: counterResponseId },
  });
  if (!counterRow) return;
  const [buyerAuth, sellerAuth, lotRow, whoCounteredProfile] = await Promise.all([
    prisma.user.findUnique({
      where: { id: counterRow.buyerId },
      select: { email: true, name: true },
    }),
    prisma.user.findUnique({
      where: { id: counterRow.sellerId },
      select: { email: true, name: true },
    }),
    prisma.lot.findUnique({
      where: { id: counterRow.lotId },
      select: { id: true, polymer: true, condition: true, form: true },
    }),
    prisma.profile.findUnique({
      where: { userId: whoCountered },
      select: { displayName: true },
    }),
  ]);
  if (!buyerAuth || !sellerAuth || !lotRow) return;

  const lotTitle = `${lotRow.polymer} · ${lotRow.condition} · ${lotRow.form}`;
  const byDisplayName = whoCounteredProfile?.displayName ?? 'Meldstock buyer';
  const unitLabel = counterRow.priceUnit === 'PER_LB' ? '/ lb' : '/ kg';
  const priceLabel = `$${counterRow.pricePerUnit.toString()}${unitLabel}`;
  const quantityLabel = `${counterRow.quantityLb.toString()} lb`;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') ?? '';
  const lotUrl = `${baseUrl}/lots/${encodeURIComponent(lotRow.id)}`;

  await Promise.allSettled(
    [buyerAuth, sellerAuth].map(async (recipient) => {
      try {
        await sendEmail({
          to: recipient.email,
          ...wantedResponseCounteredEmail({
            recipientName: recipient.name,
            lotTitle,
            byDisplayName,
            priceLabel,
            quantityLabel,
            expiresAt: counterRow.offerExpiresAt.toISOString(),
            lotUrl,
          }),
        });
      } catch {
        // best-effort
      }
    }),
  );
}
