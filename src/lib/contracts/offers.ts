// @polsia:user-owned — shared zod contract for the structured offer /
// counter-offer resource on HAVE listings. Imported by the route handlers
// (server) AND the client islands (client); keeps form ↔ API shape in
// lockstep so server validation errors can flow onto form fields via
// applyServerErrors in src/lib/forms.ts.
//
// Each `Offer` is an immutable negotiation event: the buyer's initial
// offer, a seller's counter, etc. The thread's full negotiation history is
// reconstructed by walking the `parentOfferId` chain (oldest first). The
// thread's existing `MessageThread.dealStatus` stepper (the OFFER →
// ACCEPTED → PO_ISSUED → … → COMPLETED ladder) is unchanged — ACCEPT on
// an Offer simply advances the thread's stepper to ACCEPTED and unlocks
// the existing 5-dimension Rating form / MarkCompletedButton once the
// seller flips the closeout state.

// --- Enums mirror prisma/schema/offer.prisma; the underlying union is
//     stable even if the Prisma enums are reordered. ---------------------
import { z } from 'zod';

export const OfferStatusEnum = z.enum([
  'PENDING',
  'COUNTERED',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'WITHDRAWN',
]);
export type OfferStatus = z.infer<typeof OfferStatusEnum>;

export const PriceUnitEnum = z.enum(['PER_LB', 'PER_KG']);
export type PriceUnit = z.infer<typeof PriceUnitEnum>;

export const FreightTermEnum = z.enum([
  'EXW',
  'FOB',
  'DELIVERED',
  'FREIGHT_COLLECT',
  'FREIGHT_PREPAID',
]);
export type FreightTerm = z.infer<typeof FreightTermEnum>;

// --- The shared terms object on every Offer item + every OfferCreate
//     POST body. Fields the brief requires: quantityLb, pricePerUnit +
//     priceUnit toggle, freightTerm Select, ship-to ZIP/location,
//     requested delivery date, payment terms, comments, expiration. ---
export const OfferTerms = z.object({
  quantityLb: z.number().positive('Quantity must be greater than zero'),
  pricePerUnit: z.number().nonnegative('Price cannot be negative'),
  priceUnit: PriceUnitEnum,
  freightTerm: FreightTermEnum,
  shipToZipCode: z.string().max(20).optional().nullable(),
  shipToCity: z.string().max(120).optional().nullable(),
  shipToState: z.string().max(60).optional().nullable(),
  shipToCountry: z.string().max(80).optional().nullable(),
  requestedDeliveryDate: z.string().datetime({ offset: true }).optional().nullable(),
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
export type OfferTermsInput = z.infer<typeof OfferTerms>;

// --- Write shapes. The counter endpoint takes the same `terms` — the
//     only difference between `OfferCreate` and `OfferCounter` is the
//     URL it hits (the route handles parent-off chaining). ---
export const OfferCreate = z.object({
  terms: OfferTerms,
});
export type OfferCreateInput = z.infer<typeof OfferCreate>;

export const OfferCounter = z.object({
  terms: OfferTerms,
});
export type OfferCounterInput = z.infer<typeof OfferCounter>;

// No-body action shape — accept / decline / withdraw don't need fields;
// the URL is load-bearing.
export const OfferAction = z.object({}).strict();
export type OfferActionInput = z.infer<typeof OfferAction>;

// --- Read shape (persisted Offer returned by GET / POST). Decimal
//     columns serialise as strings (matching the existing Lot wire). ---
//
// `OfferItem` mixes server-stamped permission flags with the terms
// snapshot so the client can render the appropriate action bar (ACCEPT
// vs DECLINE vs COUNTER vs WITHDRAW) without a second permission
// round-trip. `actionFlags` is null when the viewer is not a party;
// otherwise it carries the four booleans the UI needs.
export const OfferItem = z.object({
  id: z.string(),
  threadId: z.string(),
  lotId: z.string(),
  // Public-facing role tags for the timeline UI — derived server-side.
  buyerDisplayName: z.string(),
  sellerDisplayName: z.string(),
  parentOfferId: z.string().nullable(),
  status: OfferStatusEnum,
  terms: z.object({
    quantityLb: z.string(),
    pricePerUnit: z.string(),
    priceUnit: PriceUnitEnum,
    freightTerm: FreightTermEnum,
    shipToZipCode: z.string().nullable(),
    shipToCity: z.string().nullable(),
    shipToState: z.string().nullable(),
    shipToCountry: z.string().nullable(),
    requestedDeliveryDate: z.string().nullable(),
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
  // Server-stamped action flags for the timeline UI. NULL when the viewer
  // is not a party on the row (visibility gate trips elsewhere, but this
  // is the second line of defense).
  actionFlags: z
    .object({
      // True iff I'm the buyer on this row, AND the row is PENDING.
      canWithdraw: z.boolean(),
      // True iff I'm the SELLER on a PENDING buyer offer, or vice versa.
      canCounter: z.boolean(),
      // True iff I'm the OFFERED party (counterpart of who created the
      // row) on a PENDING row.
      canAccept: z.boolean(),
      canDecline: z.boolean(),
    })
    .nullable(),
});
export type OfferItem = z.infer<typeof OfferItem>;

export const OfferList = z.object({ items: z.array(OfferItem) });
export type OfferListResponse = z.infer<typeof OfferList>;
