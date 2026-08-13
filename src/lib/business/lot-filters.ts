// @polsia:user-owned — pure client-side matches for the /lots browse island.
// The /api/lots route applies a subset of the filter (type, polymers, etc.)
// on the server. Texts and numeric ranges that are NOT first-class columns on
// `Lot` (melt flow, glass-mineral %, recycled content %, flame rating,
// certifications) live in `lot.notes` today, so the island matches them
// client-side against the in-memory fetched set rather than fabricating
// columns on the existing schema. Symmetric with parseLotFilter's server keys.

import type { LotItem } from '@/lib/contracts/lots';
import type { LotFilter } from '@/lib/contracts/lots-filters';

function matchesSubstring(haystack: string | null | undefined, needle: string): boolean {
  if (!needle) return true;
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

// Pull all digits from a free-text note so MFR / glass % ranges can match
// "MFR 12 g/10min", "glass fibre 30%", "recycled content ~25%" without a
// schema migration. Returns first numeric found (or NaN).
function firstNumber(text: string | null | undefined): number {
  if (!text) return Number.NaN;
  const match = /[-+]?\d+(?:\.\d+)?/g.exec(text);
  return match ? Number(match[0]) : Number.NaN;
}

function inRange(
  value: number | null | undefined,
  min: number | null,
  max: number | null,
): boolean {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : null;
  if (numeric === null) {
    // No number on this lot — only pass the range if both bounds are unset.
    return min === null && max === null;
  }
  if (min !== null && numeric < min) return false;
  if (max !== null && numeric > max) return false;
  return true;
}

// Coerce a Decimal-ish value (Prisma's Decimal works as `.toNumber()`;
// legacy rows may also arrive as string) — to a finite number, or null
// when the column is empty / non-numeric.
function coerceNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === 'string') {
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? n : null;
  }
  // Prisma.Decimal — fall back to the toString path, since Decimal isn't
  // an instanceof-able shim in this code path.
  const asNumber = (raw as { toNumber?: () => number; toString?: () => string }).toNumber?.();
  if (typeof asNumber === 'number' && Number.isFinite(asNumber)) {
    return asNumber;
  }
  const asString = (raw as { toString?: () => string }).toString?.();
  if (typeof asString === 'string') {
    const n = Number.parseFloat(asString);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Mirrors parseLotFilter's server subset, so the in-memory intersection in
// the browse island never accidentally drops rows the route would have
// returned. Server keys NOT applied here (limit) are absent from the schema.
export function matchesLotFilter(lot: LotItem, filter: LotFilter): boolean {
  // type
  if (filter.type !== 'ALL' && lot.type !== filter.type) return false;
  // polymers (multi)
  if (filter.polymers.length > 0 && !filter.polymers.includes(lot.polymer)) return false;
  // conditions (multi)
  if (filter.conditions.length > 0 && !filter.conditions.includes(lot.condition)) return false;
  // form (substring, exact-case-insensitive)
  if (filter.form && !matchesSubstring(lot.form, filter.form)) return false;
  // grade (substring, only when the lot has one)
  if (filter.grade && !matchesSubstring(lot.grade, filter.grade)) return false;
  // color (substring)
  if (filter.color && !matchesSubstring(lot.color, filter.color)) return false;
  // q — free-text across notes/manufacturer/grade/color
  if (filter.q) {
    const hit =
      matchesSubstring(lot.notes, filter.q) ||
      matchesSubstring(lot.manufacturer, filter.q) ||
      matchesSubstring(lot.grade, filter.q) ||
      matchesSubstring(lot.color, filter.q);
    if (!hit) return false;
  }
  // hasCoa
  if (filter.hasCoa !== null && lot.hasCoa !== filter.hasCoa) return false;

  // Client-only keys (no first-class column on Lot). Substring on notes for
  // flame + certifications; first-number-in-notes for the % ranges.
  if (filter.flame && !matchesSubstring(lot.notes, filter.flame)) return false;

  if (filter.certs.length > 0) {
    const haystack = lot.notes?.toLowerCase() ?? '';
    const matchedAll = filter.certs.every((cert) => haystack.includes(cert.toLowerCase()));
    if (!matchedAll) return false;
  }

  // Numeric ranges — pull the first number that "looks like" each metric.
  // MFR sits next to "mfr" / "melt" / "g/10min"; glass sits next to "glass";
  // recycled sits next to "recycled". If the lot's notes have none of the
  // markers but the filter asks for a bound, the range filter excludes it.
  const notes = lot.notes ?? '';
  const notesLower = notes.toLowerCase();

  if (filter.mfrMin !== null || filter.mfrMax !== null) {
    if (!(notesLower.includes('mfr') || notesLower.includes('melt flow'))) return false;
    if (!inRange(firstNumber(notes), filter.mfrMin, filter.mfrMax)) return false;
  }
  if (filter.glassMin !== null || filter.glassMax !== null) {
    if (!notesLower.includes('glass')) return false;
    if (!inRange(firstNumber(notes), filter.glassMin, filter.glassMax)) return false;
  }
  if (filter.recycledMin !== null || filter.recycledMax !== null) {
    if (!notesLower.includes('recycled')) return false;
    if (!inRange(firstNumber(notes), filter.recycledMin, filter.recycledMax)) return false;
  }

  return true;
}

// Row shape consumed by the SERVER-side matcher. Mirrors the Prisma `Lot`
// row (and the public `LotItem` after coercion) so the same filter evaluates
// identically in the route handler's fan-out as it does in the browser's
// in-memory intersection. Imports stay light — no server-only deps here so
// the helper can run inside /api route handlers AND be reused from tests.
export interface LotLikeForFilter {
  type: string;
  polymer: string;
  condition: string;
  form: string | null;
  manufacturer: string | null;
  grade: string | null;
  color: string;
  notes: string | null;
  hasCoa: boolean;
  // Optional fields for the saved-search matcher. Both nullable on the Lot
  // schema, so the matcher coerces to number/null and skips when missing.
  quantityLb?: unknown;
  location?: string | null;
}

// Server-mirrored matcher. Used by /api/saved-searches#GET for the live
// `matchCount` column and by /api/lots#POST for the email-on-match fan-out.
// Logic is intentionally identical to `matchesLotFilter` so the in-browser
// intersection and the server's count never drift — if the client matcher
// changes, this must change too.
export function lotMatchesSavedSearch(lot: LotLikeForFilter, filter: LotFilter): boolean {
  // type
  if (filter.type !== 'ALL' && lot.type !== filter.type) return false;
  // polymers (multi)
  if (filter.polymers.length > 0 && !filter.polymers.includes(lot.polymer as never)) {
    return false;
  }
  // conditions (multi)
  if (filter.conditions.length > 0 && !filter.conditions.includes(lot.condition as never)) {
    return false;
  }
  // form (substring, case-insensitive)
  if (filter.form && !matchesSubstring(lot.form, filter.form)) return false;
  // grade (substring, only when the lot has one)
  if (filter.grade && !matchesSubstring(lot.grade, filter.grade)) return false;
  // color (substring)
  if (filter.color && !matchesSubstring(lot.color, filter.color)) return false;
  // q — free-text across notes/manufacturer/grade/color
  if (filter.q) {
    const hit =
      matchesSubstring(lot.notes, filter.q) ||
      matchesSubstring(lot.manufacturer, filter.q) ||
      matchesSubstring(lot.grade, filter.q) ||
      matchesSubstring(lot.color, filter.q);
    if (!hit) return false;
  }
  // hasCoa
  if (filter.hasCoa !== null && lot.hasCoa !== filter.hasCoa) return false;

  // Numeric ranges (quantityLb is a first-class Decimal column).
  if (filter.quantityMin !== null || filter.quantityMax !== null) {
    const numeric = coerceNumber(lot.quantityLb);
    if (numeric === null) {
      // No quantity on this lot — only pass the range when both bounds are
      // unset, otherwise the filter was clearly intended to constrain.
      if (filter.quantityMin !== null || filter.quantityMax !== null) return false;
    } else {
      if (filter.quantityMin !== null && numeric < filter.quantityMin) return false;
      if (filter.quantityMax !== null && numeric > filter.quantityMax) return false;
    }
  }
  // Location — case-insensitive substring.
  if (filter.location && !matchesSubstring(lot.location, filter.location)) return false;

  // Client-only keys (no first-class column on Lot); semantics identical to
  // matchesLotFilter so substring matching against notes stays in sync.
  if (filter.flame && !matchesSubstring(lot.notes, filter.flame)) return false;
  if (filter.certs.length > 0) {
    const haystack = lot.notes?.toLowerCase() ?? '';
    const matchedAll = filter.certs.every((cert) => haystack.includes(cert.toLowerCase()));
    if (!matchedAll) return false;
  }

  // Numeric ranges — same first-number-in-notes parse as the client.
  const notes = lot.notes ?? '';
  const notesLower = notes.toLowerCase();
  if (filter.mfrMin !== null || filter.mfrMax !== null) {
    if (!(notesLower.includes('mfr') || notesLower.includes('melt flow'))) return false;
    if (!inRange(firstNumber(notes), filter.mfrMin, filter.mfrMax)) return false;
  }
  if (filter.glassMin !== null || filter.glassMax !== null) {
    if (!notesLower.includes('glass')) return false;
    if (!inRange(firstNumber(notes), filter.glassMin, filter.glassMax)) return false;
  }
  if (filter.recycledMin !== null || filter.recycledMax !== null) {
    if (!notesLower.includes('recycled')) return false;
    if (!inRange(firstNumber(notes), filter.recycledMin, filter.recycledMax)) return false;
  }
  return true;
}

// Stats for the H1 eyebrow — counts active filter dimensions so the user sees
// which axes are narrowing the set.
export function activeFilterCount(filter: LotFilter): number {
  let count = 0;
  if (filter.type !== 'ALL') count++;
  if (filter.polymers.length > 0) count++;
  if (filter.conditions.length > 0) count++;
  if (filter.form) count++;
  if (filter.grade) count++;
  if (filter.color) count++;
  if (filter.q) count++;
  if (filter.hasCoa !== null) count++;
  if (filter.mfrMin !== null || filter.mfrMax !== null) count++;
  if (filter.glassMin !== null || filter.glassMax !== null) count++;
  if (filter.recycledMin !== null || filter.recycledMax !== null) count++;
  if (filter.flame) count++;
  if (filter.certs.length > 0) count++;
  if (filter.quantityMin !== null || filter.quantityMax !== null) count++;
  if (filter.location) count++;
  return count;
}
