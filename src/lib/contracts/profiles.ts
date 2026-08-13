// @polsia:user-owned — shared zod contract for the profiles + verification
// resource. Imported by the route handlers (server) AND the client islands
// (client); keeps form ↔ API shape in lockstep so server-validation errors
// flow onto form fields via applyServerErrors (src/lib/forms.ts).
import { z } from 'zod';

// --- Enums mirror prisma/schema/profiles.prisma under the same names so the
//     client + server schemas can be cross-referenced by string literal. ---
export const BusinessRoleEnum = z.enum([
  'BROKER_TRADER',
  'INJECTION_MOLDER',
  'EXTRUDER',
  'BLOW_MOLDER',
  'THERMOFORMER',
  'RECYCLER_REPROCESSOR',
  'COMPOUNDER',
  'DISTRIBUTOR',
  'RESIN_PRODUCER',
  'SCRAP_GENERATOR',
  'MANUFACTURER',
  'BUYER',
]);
export type BusinessRole = z.infer<typeof BusinessRoleEnum>;

export const VerificationStatusEnum = z.enum(['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED']);
export type VerificationStatus = z.infer<typeof VerificationStatusEnum>;

export const AccountTypeEnum = z.enum(['INDIVIDUAL', 'COMPANY']);
export type AccountType = z.infer<typeof AccountTypeEnum>;

// --- Field-level limits — kept in one place so route + form agree ----------
const Url = z
  .string()
  .max(300)
  .refine(
    (v) => v === '' || /^https?:\/\/.+/i.test(v.trim()),
    'Enter a URL that starts with http(s)://',
  )
  .optional()
  .nullable();

// --- Write shape — what signup / profile-edit submit. ---------------------
export const CreateProfile = z.object({
  accountType: AccountTypeEnum,
  displayName: z.string().min(2, 'Display name must be at least 2 characters').max(120),
  companyName: z.string().max(200).optional().nullable(),
  positionTitle: z.string().max(120).optional().nullable(),
  role: BusinessRoleEnum,
  location: z.string().max(160).optional().nullable(),
  country: z.string().max(80).optional().nullable(),
  companyDescription: z.string().max(2000).optional().nullable(),
  materialsBought: z.array(z.string().min(1).max(80)).max(64).optional().nullable(),
  materialsSold: z.array(z.string().min(1).max(80)).max(64).optional().nullable(),
  yearsInBusiness: z
    .number()
    .int()
    .nonnegative('Years in business cannot be negative')
    .max(120)
    .optional()
    .nullable(),
  websiteUrl: Url,
  phone: z.string().max(40).optional().nullable(),
  publicEmail: z.string().email('Enter a valid email').max(200).optional().nullable(),
  socialTwitter: z.string().max(80).optional().nullable(),
  socialLinkedin: z.string().max(300).optional().nullable(),
  socialInstagram: z.string().max(80).optional().nullable(),
});
export type CreateProfileInput = z.infer<typeof CreateProfile>;

export const UpdateProfile = CreateProfile.partial().extend({
  // Display name updates are allowed but never empty — handler enforces
  // re-validation via safeParse.
  displayName: z.string().min(2).max(120).optional(),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfile>;

// --- Read shape — persisted record returned by GET /api/profile endpoints.
//     Public-facing (no server-only fields) since the public route returns the
//     same wire shape minus nothing in v1. Sensitive fields (publicEmail,
//     phone) stay opt-in by the owner — when null they're treated as private.
export const ProfileItem = z.object({
  id: z.string(),
  userId: z.string(),
  accountType: AccountTypeEnum,
  displayName: z.string(),
  companyName: z.string().nullable(),
  positionTitle: z.string().nullable(),
  role: BusinessRoleEnum,
  location: z.string().nullable(),
  country: z.string().nullable(),
  companyDescription: z.string().nullable(),
  materialsBought: z.array(z.string()).nullable(),
  materialsSold: z.array(z.string()).nullable(),
  yearsInBusiness: z.number().nullable(),
  websiteUrl: z.string().nullable(),
  phone: z.string().nullable(),
  publicEmail: z.string().nullable(),
  socialTwitter: z.string().nullable(),
  socialLinkedin: z.string().nullable(),
  socialInstagram: z.string().nullable(),
  isAdmin: z.boolean(),
  verificationStatus: VerificationStatusEnum,
  verifiedAt: z.string().nullable(),
  // Computed for UI convenience — never null once a row exists.
  verifiedBadge: z.enum(['none', 'pending', 'verified', 'rejected']),
  handle: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProfileItem = z.infer<typeof ProfileItem>;

// Same as ProfileItem for v1 (no field-level public/private toggle yet).
export const ProfilePublic = ProfileItem;
export type ProfilePublic = ProfileItem;

// --- Verification request -------------------------------------------------
export const CreateVerificationRequest = z.object({
  // Short free-form note (D&B number, license file ref, etc.) — full
  // document upload is out of scope for v1.
  requestedDocumentsText: z
    .string()
    .min(10, 'Add a short note (10+ chars) — D&B #, license, etc.')
    .max(1000),
});
export type CreateVerificationRequestInput = z.infer<typeof CreateVerificationRequest>;

export const VerificationRequestItem = z.object({
  id: z.string(),
  profileId: z.string(),
  status: VerificationStatusEnum,
  requestedAt: z.string(),
  decidedAt: z.string().nullable(),
  requestedDocumentsText: z.string().nullable(),
  reviewerNote: z.string().nullable(),
  reviewedByUserId: z.string().nullable(),
});
export type VerificationRequestItem = z.infer<typeof VerificationRequestItem>;

export const VerificationRequestList = z.object({
  items: z.array(VerificationRequestItem),
});

export const AdminVerificationDecision = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reviewerNote: z.string().max(1000).optional().nullable(),
});
export type AdminVerificationDecisionInput = z.infer<typeof AdminVerificationDecision>;

// --- Profile → lots lookup ---------------------------------------------------
export const LotsByHandleResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      type: z.enum(['HAVE', 'WANTED']),
      polymer: z.string(),
      condition: z.string(),
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
      createdAt: z.string(),
    }),
  ),
});
