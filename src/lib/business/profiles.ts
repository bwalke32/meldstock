// @polsia:user-owned — shared DB-row → wire-shape conversion for Profile +
// Lot. Lives in business/ (not server-only) so client islands can import the
// label maps too. The toWire functions themselves are pure (no DB import),
// keeping the boundary obvious. Type is intentionally loose: Prisma row types
// can't be imported here (server-only), and any drift from the contract is
// caught by the calling route's zod.parse().
import type { LotVisibility, PolymerEnum } from '@/lib/contracts/lots';
import type { BusinessRole, VerificationStatus } from '@/lib/contracts/profiles';

export type ProfileRow = {
  id: string;
  userId: string;
  accountType: string;
  displayName: string;
  companyName: string | null;
  positionTitle: string | null;
  role: string;
  location: string | null;
  country: string | null;
  companyDescription: string | null;
  materialsBought: unknown;
  materialsSold: unknown;
  yearsInBusiness: number | null;
  websiteUrl: string | null;
  phone: string | null;
  publicEmail: string | null;
  socialTwitter: string | null;
  socialLinkedin: string | null;
  socialInstagram: string | null;
  isAdmin: boolean;
  verificationStatus: string;
  verifiedAt: Date | null;
  handle: string;
  createdAt: Date;
  updatedAt: Date;
};

export function asStringArray(v: unknown): string[] | null {
  if (!v) return null;
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === 'string') {
    try {
      const parsed: unknown = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x));
    } catch {
      return null;
    }
  }
  return null;
}

export function profileRowToWire(p: ProfileRow) {
  const status = p.verificationStatus as VerificationStatus;
  const verifiedBadge: 'none' | 'pending' | 'verified' | 'rejected' =
    status === 'VERIFIED'
      ? 'verified'
      : status === 'PENDING'
        ? 'pending'
        : status === 'REJECTED'
          ? 'rejected'
          : 'none';
  return {
    id: p.id,
    userId: p.userId,
    accountType: p.accountType as 'INDIVIDUAL' | 'COMPANY',
    displayName: p.displayName,
    companyName: p.companyName,
    positionTitle: p.positionTitle,
    role: p.role as BusinessRole,
    location: p.location,
    country: p.country,
    companyDescription: p.companyDescription,
    materialsBought: asStringArray(p.materialsBought),
    materialsSold: asStringArray(p.materialsSold),
    yearsInBusiness: p.yearsInBusiness,
    websiteUrl: p.websiteUrl,
    phone: p.phone,
    publicEmail: p.publicEmail,
    socialTwitter: p.socialTwitter,
    socialLinkedin: p.socialLinkedin,
    socialInstagram: p.socialInstagram,
    isAdmin: p.isAdmin,
    verificationStatus: status,
    verifiedAt: p.verifiedAt?.toISOString() ?? null,
    verifiedBadge,
    handle: p.handle,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export type LotRow = {
  id: string;
  type: string;
  polymer: string;
  condition: string;
  color: string;
  form: string;
  manufacturer: string | null;
  grade: string | null;
  quantityLb: unknown;
  packaging: string;
  location: string | null;
  country: string;
  askingPricePerLb: unknown;
  hasCoa: boolean;
  notes: string | null;
  postedByName: string;
  postedByUserId?: string | null;
  // Optional two-field profile lookup (joined on userId scalar FK). Only the
  // fields the wire shape needs; nullable so anonymous lots omit it.
  profile?: { handle: string | null; role?: string | null } | null;
  visibility: string;
  // Persisted when visibility === 'SELECTED_COMPANIES'; null otherwise.
  // `lotRowToWire` reads it through `asStringArray`, so it accepts ANY raw
  // shape that came out of Prisma's `Json` column (typed as `JsonValue`).
  // It's stamped null on the wire by the visibility helper unless the
  // viewer is the poster OR is in the selected list.
  selectedCompanyIdentifiers?: unknown;
  createdAt: Date;
  // Lifecycle fields — optional in the row type because preview fixtures
  // and the legacy public-row helper don't carry them. Wire always
  // emits an empty-string default so the LotItem.parse on the route is
  // happy.
  postedAt?: Date | null;
  lastUpdatedAt?: Date | null;
  quantityRemaining?: unknown;
  status?: string | null;
  lastNudgedAt?: Date | null;
  lastConfirmedAt?: Date | null;
};

export function lotRowToWire(row: LotRow) {
  return {
    id: row.id,
    type: row.type as 'HAVE' | 'WANTED',
    polymer: row.polymer as (typeof PolymerEnum._def.values)[number],
    condition: row.condition as
      | 'PRIME_VIRGIN'
      | 'OFF_GRADE_WIDE_SPEC'
      | 'REPROCESSED'
      | 'RECYCLED_CONTENT'
      | 'REGRIND_GRANULATED'
      | 'SCRAP'
      | 'PARTS_SPRUES_RUNNERS'
      | 'PURGE'
      | 'POST_INDUSTRIAL'
      | 'POST_CONSUMER'
      | 'MASTERBATCH_COMPOUND'
      | 'OTHER',
    color: row.color,
    form: row.form,
    manufacturer: row.manufacturer,
    grade: row.grade,
    quantityLb: toDecimalString(row.quantityLb),
    packaging: row.packaging,
    location: row.location,
    country: row.country,
    askingPricePerLb:
      row.askingPricePerLb === null || row.askingPricePerLb === undefined
        ? null
        : toDecimalString(row.askingPricePerLb),
    hasCoa: row.hasCoa,
    notes: row.notes,
    postedByName: row.postedByName,
    postedByUserId: row.postedByUserId ?? null,
    postedByHandle: row.profile?.handle ?? null,
    // Stamp from the joined profile — true when the poster is a
    // BROKER_TRADER. Resolves to false on anonymous posts (no profile
    // there) or any non-broker poster so untyped callers stay valid.
    postedByIsBroker: row.profile?.role === 'BROKER_TRADER',
    visibility: row.visibility as LotVisibility,
    selectedCompanyIdentifiers: asStringArray(row.selectedCompanyIdentifiers),
    createdAt: row.createdAt.toISOString(),
    // Lifecycle wire — fall back to createdAt/country/0/ACTIVE/null so the
    // LotItem zod parse is happy when the row was minted before the brief's
    // columns landed (backfill-safe).
    postedAt: (row.postedAt ?? row.createdAt).toISOString(),
    lastUpdatedAt: (row.lastUpdatedAt ?? row.createdAt).toISOString(),
    quantityRemaining: toDecimalString(row.quantityRemaining ?? row.quantityLb),
    status: (row.status ?? 'ACTIVE') as 'ACTIVE' | 'SOLD' | 'EXPIRED' | 'DEACTIVATED',
    lastNudgedAt: row.lastNudgedAt ? row.lastNudgedAt.toISOString() : null,
    lastConfirmedAt: row.lastConfirmedAt ? row.lastConfirmedAt.toISOString() : null,
  };
}

export function publicLotRowToWire(l: {
  id: string;
  type: string;
  polymer: string;
  condition: string;
  color: string;
  form: string;
  manufacturer: string | null;
  grade: string | null;
  quantityLb: unknown;
  packaging: string;
  location: string | null;
  country: string;
  askingPricePerLb: unknown;
  hasCoa: boolean;
  notes: string | null;
  createdAt: Date;
}) {
  return {
    id: l.id,
    type: l.type as 'HAVE' | 'WANTED',
    polymer: l.polymer,
    condition: l.condition,
    color: l.color,
    form: l.form,
    manufacturer: l.manufacturer,
    grade: l.grade,
    quantityLb: toDecimalString(l.quantityLb),
    packaging: l.packaging,
    location: l.location,
    country: l.country,
    askingPricePerLb:
      l.askingPricePerLb === null || l.askingPricePerLb === undefined
        ? null
        : toDecimalString(l.askingPricePerLb),
    hasCoa: l.hasCoa,
    notes: l.notes,
    createdAt: l.createdAt.toISOString(),
  };
}

export function toDecimalString(v: unknown): string {
  if (v === null || v === undefined) return '0';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return v.toString();
  return (v as { toString(): string }).toString();
}

// Business labels for the 12 roles — used by form select + read views.
export const BUSINESS_ROLE_LABELS: Record<BusinessRole, string> = {
  BROKER_TRADER: 'Broker / Trader',
  INJECTION_MOLDER: 'Injection Molder',
  EXTRUDER: 'Extruder',
  BLOW_MOLDER: 'Blow Molder',
  THERMOFORMER: 'Thermoformer',
  RECYCLER_REPROCESSOR: 'Recycler / Reprocessor',
  COMPOUNDER: 'Compounder',
  DISTRIBUTOR: 'Distributor',
  RESIN_PRODUCER: 'Resin Producer',
  SCRAP_GENERATOR: 'Scrap Generator',
  MANUFACTURER: 'Manufacturer',
  BUYER: 'Buyer',
};

export const ACCOUNT_TYPE_LABELS: Record<'INDIVIDUAL' | 'COMPANY', string> = {
  INDIVIDUAL: 'Individual / Sole Trader',
  COMPANY: 'Company',
};
