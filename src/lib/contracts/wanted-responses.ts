// @polsia:user-owned — shared zod contract for the structured
// seller-response / counter-offer resource on WANTED/RFQ listings.
// Imported by the route handlers (server) AND the client islands
// (client); keeps form ↔ API shape in lockstep so server validation
// errors can flow onto form fields via applyServerErrors in
// src/lib/forms.ts.
//
// Each `WantedResponse` is an immutable negotiation event: the
// respondent seller's initial block, the buyer's counter, etc. The
// negotiation's full history is reconstructed by walking the
// `parentResponseId` chain. On ACCEPT the row's `acceptedAt` is stamped
// AND the parent `MessageThread.dealStatus` advances to ACCEPTED so the
// existing 5-dimension Rating form / MarkCompletedButton flow takes
// over once the seller flips the closeout state.
//
// Action-flag inversion vs the HAVE `Offer` flow: in the `Offer` flow
// the SELLER counters and WITHDRAWS — the buyer can accept/decline.
// Here on WANTED, the BUYER (= RFQ poster) does canCounter, canAccept
// and canDecline; the SELLER (= respondent) canCounter is REJECTED at
// the route (403). canWithdraw follows author parity: the AUTHOR is
// the seller for root rows (parentResponseId === null), the buyer for
// counter rows — alternating by induction.

import { z } from 'zod';
import { FreightTermEnum, PriceUnitEnum } from '@/lib/contracts/offers';

// --- Status enum mirrors prisma/schema/wanted-responses.prisma. -----------
export const WantedResponseStatusEnum = z.enum([
  'PENDING',
  'COUNTERED',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'WITHDRAWN',
]);
export type WantedResponseStatus = z.infer<typeof WantedResponseStatusEnum>;

// --- The shared terms object on every WantedResponse row + every POST body.
// Fields mirror the HAVE Offer shape plus the brief's new fields:
// `materialLocation` (REQUIRED — distinct from ship-to), `leadTimeDays`,
// `packaging`, `lotInfo`, `coaAvailable`.
export const WantedResponseTerms = z.object({
  quantityLb: z.number().positive('Quantity must be greater than zero'),
  pricePerUnit: z.number().nonnegative('Price cannot be negative'),
  priceUnit: PriceUnitEnum,
  freightTerm: FreightTermEnum,
  materialLocation: z
    .string()
    .min(2, 'Enter the location of the material')
    .max(200, 'Material location is too long'),
  leadTimeDays: z
    .number()
    .int('Lead time must be a whole number of days')
    .nonnegative('Lead time cannot be negative')
    .optional()
    .nullable(),
  packaging: z.string().max(120, 'Packaging is too long').optional().nullable(),
  lotInfo: z.string().max(1500, 'Lot info is too long').optional().nullable(),
  coaAvailable: z.boolean(),
  paymentTerms: z.string().max(120, 'Payment terms are too long').optional().nullable(),
  comments: z.string().max(1500, 'Comments are too long').optional().nullable(),
  offerExpiresAt: z
    .string()
    .datetime({ offset: true })
    .refine((v) => {
      const stamp = new Date(v).getTime();
      return Number.isFinite(stamp) && stamp > Date.now();
    }, 'Expiration must be in the future'),
});
export type WantedResponseTermsInput = z.infer<typeof WantedResponseTerms>;

// --- Write shapes. -------------------------------------------------------
export const WantedResponseCreate = z.object({
  terms: WantedResponseTerms,
});
export type WantedResponseCreateInput = z.infer<typeof WantedResponseCreate>;

export const WantedResponseCounter = z.object({
  terms: WantedResponseTerms,
});
export type WantedResponseCounterInput = z.infer<typeof WantedResponseCounter>;

// No-body action shape — accept / decline / withdraw don't need fields.
export const WantedResponseAction = z.object({}).strict();
export type WantedResponseActionInput = z.infer<typeof WantedResponseAction>;

// --- Read shape (persisted WantedResponse returned by GET / POST). -----
// Decimal columns serialise as strings (matching OfferItem + LotItem).
export const WantedResponseItem = z.object({
  id: z.string(),
  threadId: z.string(),
  lotId: z.string(),
  // Wires carry the raw ids so client islands can group by seller
  // (the timeline renders one column per respondent chain). Display
  // names are included too for human-readable labels without a second
  // fetch.
  sellerId: z.string(),
  buyerId: z.string(),
  // Public-facing role tags for the timeline UI — derived server-side.
  // `sellerDisplayName` = respondent (counter-seller on HAVE Offer
  // becomes the "seller" here too). `buyerDisplayName` = RFQ poster.
  sellerDisplayName: z.string(),
  buyerDisplayName: z.string(),
  parentResponseId: z.string().nullable(),
  status: WantedResponseStatusEnum,
  terms: z.object({
    quantityLb: z.string(),
    pricePerUnit: z.string(),
    priceUnit: PriceUnitEnum,
    freightTerm: FreightTermEnum,
    materialLocation: z.string(),
    leadTimeDays: z.number().int().nonnegative().nullable(),
    packaging: z.string().nullable(),
    lotInfo: z.string().nullable(),
    coaAvailable: z.boolean(),
    paymentTerms: z.string().nullable(),
    comments: z.string().nullable(),
    offerExpiresAt: z.string(),
  }),
  createdAt: z.string(),
  offerExpiresAt: z.string(),
  counteredAt: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  declinedAt: z.string().nullable(),
  withdrawnAt: z.string().nullable(),
  // Server-stamped action flags for the timeline UI. NULL when the
  // viewer is not a party on the row (visibility gate trips elsewhere,
  // but this is the second line of defense).
  actionFlags: z
    .object({
      // True iff I'm the buyer (= RFQ poster) on a PENDING row.
      canWithdraw: z.boolean(),
      // True iff I'm the buyer (= RFQ poster) on a PENDING row —
      // counter is BUYER-only on the WANTED side (eager inversion from
      // HAVE's SELLER-only counter).
      canCounter: z.boolean(),
      // True iff I'm the buyer (= RFQ poster) on a PENDING row — the
      // buyer accepts the seller's response.
      canAccept: z.boolean(),
      // True iff I'm the buyer (= RFQ poster) on a PENDING row.
      canDecline: z.boolean(),
    })
    .nullable(),
});
export type WantedResponseItem = z.infer<typeof WantedResponseItem>;

export const WantedResponseList = z.object({ items: z.array(WantedResponseItem) });
export type WantedResponseListResponse = z.infer<typeof WantedResponseList>;
