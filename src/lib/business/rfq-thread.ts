// @polsia:user-owned — find-or-create the per-(WANTED lot, respondent)
// MessageThread, the same upsert that `/api/threads` POST performs.
//
// On a WANTED lot the structured-response and the legacy
// `MessageSellerButton` flows both need a thread keyed on
// `(lotId, buyerId=respondent)` — the respondent is the thread's
// "buyer" (they initiated the thread, dummy semantic) and the lot
// poster is the thread's "seller". Both sides already wired to the
// existing `ThreadParticipant` backfill so an
// `ensureParticipantRoster(thread)` is always called on the upserted
// row before returning.
//
// The route used to duplicate this logic in-line; we consolidate it
// here so the structured-response POST and `MessageSellerButton` can
// converge on a single helper. Public behaviour is unchanged (the
// POST arm in /api/threads still sources from this helper's behaviour,
// but is left in-place so the existing test surface isn't disturbed).
//
// Server-only — imports Prisma.
import 'server-only';
import { ensureParticipantRoster } from '@/lib/business/thread-participants';
import { prisma } from '@/lib/db';

export type RfqThreadRow = {
  id: string;
  lotId: string | null;
  buyerId: string | null;
  sellerId: string | null;
  subject: string;
  rfqId: string | null;
  kind: 'LISTING' | 'RFQ';
  createdAt: Date;
};

type LotLike = {
  id: string;
  type: string;
  polymer: string;
  condition: string;
  form: string;
  postedByUserId: string | null;
};

export async function findOrCreateRfqThread(
  lot: LotLike,
  respondentUserId: string,
): Promise<RfqThreadRow> {
  if (lot.type !== 'WANTED') {
    throw new Error('findOrCreateRfqThread called with a non-WANTED lot');
  }
  if (lot.postedByUserId === null) {
    throw new Error('findOrCreateRfqThread called with anonymous lot');
  }
  const rfqId = lot.id;
  const subject = `${lot.polymer} · ${lot.condition} · ${lot.form}`;
  const thread = await prisma.messageThread.upsert({
    where: { lotId_buyerId: { lotId: lot.id, buyerId: respondentUserId } },
    update: { rfqId, kind: 'RFQ' },
    create: {
      kind: 'RFQ',
      lotId: lot.id,
      buyerId: respondentUserId,
      sellerId: lot.postedByUserId,
      subject,
      rfqId,
    },
  });
  // Seed the participant table so the existing messaging surface
  // (inbox list, thread detail) sees the buyer/seller pair.
  await ensureParticipantRoster(thread);
  return thread as unknown as RfqThreadRow;
}
