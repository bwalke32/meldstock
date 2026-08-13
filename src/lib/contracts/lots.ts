// @polsia:user-owned — shared zod contract for the trading-floor lots resource.
// Imported by the route handler (server) AND the client islands (client); keeps
// form ↔ API shape in lockstep so server validation can flow onto form fields
// (see applyServerErrors in src/lib/forms.ts).

import { z } from 'zod';
import { LotDealStatus } from '@/lib/contracts/messaging';

// --- Enums mirror prisma/schema/lots.prisma; the underlying union is stable
//     even if the Prisma enums are reordered. --------------------------------
export const PolymerEnum = z.enum([
  'ABS',
  'PC',
  'PP',
  'PE_HDPE',
  'PE_LDPE',
  'PE_LLDPE',
  'PA6',
  'PA66',
  'PA612',
  'PBT',
  'PET',
  'POM',
  'PPS',
  'TPU',
  'TPV',
  'TPE',
  'HIPS',
  'GPPS',
  'OTHER',
]);
export type Polymer = z.infer<typeof PolymerEnum>;

export const LotConditionEnum = z.enum([
  'PRIME_VIRGIN',
  'OFF_GRADE_WIDE_SPEC',
  'REPROCESSED',
  'RECYCLED_CONTENT',
  'REGRIND_GRANULATED',
  'SCRAP',
  'PARTS_SPRUES_RUNNERS',
  'PURGE',
  'POST_INDUSTRIAL',
  'POST_CONSUMER',
  'MASTERBATCH_COMPOUND',
  'OTHER',
]);
export type LotCondition = z.infer<typeof LotConditionEnum>;

export const LotTypeEnum = z.enum(['HAVE', 'WANTED']);
export type LotType = z.infer<typeof LotTypeEnum>;

export const LotVisibilityEnum = z.enum([
  'PUBLIC',
  'VERIFIED_COMPANIES_ONLY',
  'MY_NETWORK',
  'SELECTED_COMPANIES',
  'ANONYMOUS',
]);
export type LotVisibility = z.infer<typeof LotVisibilityEnum>;

// --- Lifecycle status — drives browse filtering for non-owners
//     (non-ACTIVE rows are hidden from public browse; the poster still
//     sees their own SOLD / EXPIRED / DEACTIVATED rows so the dashboard
//     can render them as "sold" or "expired" badges).
export const LotLifecycleStatusEnum = z.enum(['ACTIVE', 'SOLD', 'EXPIRED', 'DEACTIVATED']);
export type LotLifecycleStatus = z.infer<typeof LotLifecycleStatusEnum>;

// --- Write shape — what /post-a-lot (and trading-floor) submits.
// Numeric + boolean fields are kept non-coerce so the input type matches the
// inferred output type — keeps RHF's `useForm` type checks satisfied. The
// route handler still accepts JSON whose strings have already been parsed.
const SelectedIdentifier = z
  .string()
  .min(1, 'Add at least one handle or email')
  .max(120, 'Each entry is capped at 120 characters');

export const CreateLot = z
  .object({
    type: LotTypeEnum.default('HAVE'),
    polymer: PolymerEnum,
    condition: LotConditionEnum,
    color: z.string().min(1, 'Color is required').max(80),
    form: z.string().min(1, 'Form is required').max(80),
    manufacturer: z.string().max(120).optional().nullable(),
    grade: z.string().max(120).optional().nullable(),
    // Industry measures in lb; 0 is permissible so a lot row can exist while the
    // broker chases the final weight from the railcar.
    quantityLb: z.number().min(0, 'Quantity cannot be negative').default(0),
    // Lifecycle — what is STILL offered. Defaults from `quantityLb` at the
    // route boundary (see /api/lots GET+POST handlers) so existing callers
    // don't have to know about the column. Marked optional+nullable so a
    // partial UPDATE that doesn't touch the column still validates.
    quantityRemaining: z
      .number()
      .min(0, 'Quantity remaining cannot be negative')
      .optional()
      .nullable(),
    packaging: z.string().min(1, 'Packaging is required').max(80),
    location: z.string().max(160).optional().nullable(),
    country: z.string().min(1, 'Country is required').max(80),
    // HAVE lots often leave the price null/0 while they wait for the broker to
    // set a reserve. WANTED lots commonly post a target price.
    askingPricePerLb: z
      .number()
      .nonnegative('Asking price must be 0 or greater')
      .optional()
      .nullable(),
    hasCoa: z.boolean().default(false),
    notes: z.string().max(1500).optional().nullable(),
    postedByName: z.string().min(1, 'Your name is required').max(80),
    // Plain-scalar FK to User.id (set by the post-a-lot form when a session
    // exists). Null on anonymous posts so redploys + legacy rows stay valid.
    postedByUserId: z.string().nullable().optional(),
    // Per-listing visibility — defaults to PUBLIC so legacy clients keep
    // posting as before; newer clients (the visibility selector) send one of
    // the five `LotVisibilityEnum` values.
    visibility: LotVisibilityEnum.default('PUBLIC'),
    // Selected-company whitelist — matched by viewer profile handle OR
    // viewer account email. Lowercased + deduped at the API layer; only
    // required (non-empty) when visibility === 'SELECTED_COMPANIES'.
    selectedCompanyIdentifiers: z
      .array(SelectedIdentifier)
      .max(50, 'No more than 50 entries')
      .optional()
      .nullable(),
  })
  .superRefine((value, ctx) => {
    if (
      value.visibility === 'SELECTED_COMPANIES' &&
      (!value.selectedCompanyIdentifiers || value.selectedCompanyIdentifiers.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['selectedCompanyIdentifiers'],
        message: 'Add at least one handle or email when using "Selected companies".',
      });
    }
  });

// --- Read shape — persisted record returned by GET/POST. Decimal serialises
//     as a string on the wire (Prisma Decimal) so we keep it as a string.
export const LotItem = z.object({
  id: z.string(),
  type: LotTypeEnum,
  polymer: PolymerEnum,
  condition: LotConditionEnum,
  color: z.string(),
  form: z.string(),
  manufacturer: z.string().nullable(),
  grade: z.string().nullable(),
  quantityLb: z.string(),
  packaging: z.string(),
  location: z.string().nullable(),
  country: z.string(),
  askingPricePerLb: z.string().nullable(),
  hasCoa: z.boolean(),
  notes: z.string().nullable(),
  postedByName: z.string(),
  postedByUserId: z.string().nullable(),
  postedByHandle: z.string().nullable(),
  // Stamped by every lot endpoint from the poster's `Profile.role` —
  // true iff the role is `BROKER_TRADER`. Required on the wire so client
  // islands can branch on the broker-attached surface without a guessing
  // fallback; the lot handlers are updated in lockstep with this field.
  postedByIsBroker: z.boolean(),
  visibility: LotVisibilityEnum,
  // Only emitted when the viewer is the poster OR is in the selected list
  // (i.e. permitted to see it); null otherwise so non-permitted viewers
  // can't probe who ELSE was allowed.
  selectedCompanyIdentifiers: z.array(z.string()).nullable(),
  createdAt: z.string(),
  // Lifecycle fields — surfaced explicitly so the dashboard table + the
  // lot card can render the "sold / expired / deactivated" badge without
  // a second round-trip. `postedAt` mirrors `createdAt` by construction;
  // they differ ONLY for backfilled legacy rows where Prisma applies the
  // default once.
  postedAt: z.string(),
  lastUpdatedAt: z.string(),
  quantityRemaining: z.string(),
  status: LotLifecycleStatusEnum,
  lastNudgedAt: z.string().nullable(),
  lastConfirmedAt: z.string().nullable(),
});

export const LotList = z.object({ items: z.array(LotItem) });

// --- Per-lot private message thread.
export const LotMessage = z.object({
  id: z.string(),
  lotId: z.string(),
  senderName: z.string(),
  body: z.string(),
  createdAt: z.string(),
});

export const LotMessageList = z.object({ items: z.array(LotMessage) });

export const CreateLotMessage = z.object({
  lotId: z.string().min(1, 'lotId is required'),
  senderName: z.string().min(1, 'Your name is required').max(80),
  body: z.string().min(1, 'Message cannot be empty').max(2000),
});

// --- Documents attached to a lot (COA, TDS, SDS, certifications, test
//     reports). Read on /lots/[id]; uploaded via POST /api/lots/[id]/documents
//     by the lot poster. The collection is the new source of truth for the
//     brief's "hasCoa means documents are attached" semantic.
export const DocumentTypeEnum = z.enum([
  'COA',
  'TDS',
  'SDS',
  'CERTIFICATION',
  'TEST_REPORT',
  'OTHER',
]);
export type DocumentType = z.infer<typeof DocumentTypeEnum>;

// Document URL on the wire is an OPAQUE relative API path (never the raw R2
// CDN URL — those are guessable from the cuid + company slug). The download
// proxy at `/api/lots/<lotId>/documents/<docId>/download` re-checks the
// viewer's lot visibility BEFORE streaming bytes, so a guessed path 401s
// for an unauthorised viewer even if the cuid is known.
export const DocumentItem = z.object({
  id: z.string(),
  lotId: z.string(),
  type: DocumentTypeEnum,
  filename: z.string(),
  url: z.string(),
  mimeType: z.string(),
  bytes: z.number().int().nonnegative().optional(),
  createdAt: z.string(),
});

export const DocumentList = z.object({ items: z.array(DocumentItem) });

// --- Composite detail response — single round-trip for /lots/[id].
//
// `dealStatusBlock` is the caller's own active thread with this lot's
// seller (anonymous viewer / anonymous lot / viewer with no
// participating thread resolve to `null`). Surfaced here so the detail
// page can render the stepper on first paint; the standalone
// /api/lots/[id]/deal-status endpoint mirrors the same shape so the
// island can reconcile both with one schema (`LotDealStatus` lives in
// @/lib/contracts/messaging because the route lives there too).
export const LotDetailResponse = z.object({
  lot: LotItem,
  messages: z.array(LotMessage),
  // Documents ride on the same response (no GET on /api/lots/[id]/documents)
  // so the detail page boots in one round-trip. Empty list when the lot has
  // no attached PDFs.
  documents: DocumentList,
  // Optional so legacy callers (and the unchanged existing GET handler —
  // the live hydration reads /api/lots/[id]/deal-status instead, so this
  // field stays null on the wire until the handler is taught to stamp it)
  // don't have to know about it. Nullable so a no-thread viewer simply
  // omits the strip.
  dealStatusBlock: LotDealStatus.nullable().optional(),
});

export type LotDetailResponse = z.infer<typeof LotDetailResponse>;
export type CreateLot = z.infer<typeof CreateLot>;
export type LotItem = z.infer<typeof LotItem>;
export type LotList = z.infer<typeof LotList>;
export type LotMessage = z.infer<typeof LotMessage>;
export type LotMessageList = z.infer<typeof LotMessageList>;
export type CreateLotMessage = z.infer<typeof CreateLotMessage>;
export type DocumentItem = z.infer<typeof DocumentItem>;
