// @polsia:user-owned — per-row bulk-upload validator. Pure (no DB, no
// `process.env`, no `next/headers`); reused by the preview and commit
// route handlers so the candidate-set logic is single-sourced.
//
// Accepts a runtime `HeaderMapping` (set by the seller in the wizard), a
// mapping context that remembers the ORIGINAL spreadsheet header for any
// kg/lb-ambiguous column, AND a raw row from the spreadsheet parser.
// Maps the row through the chosen mapping into a key/value object keyed
// by canonical names, then runs the same per-row contract validation as
// the legacy CSV validator in src/lib/csv/lots.ts so successful rows
// round-trip through `CreateLot`.

import { resolveResinRow } from '@/lib/business/resin-normalize';
import type { CreateLot } from '@/lib/contracts/lots';
import {
  CreateLot as CreateLotSchema,
  type LotCondition,
  LotConditionEnum,
  type LotVisibility,
  LotVisibilityEnum,
  type Polymer,
  PolymerEnum,
} from '@/lib/contracts/lots';
import { CANONICAL_FIELDS_REQUIRED, type CanonicalField, type HeaderMapping } from './columns';

export interface MappedRow {
  values: Partial<Record<CanonicalField, string>>;
}

export type RowValidationSuccess = {
  ok: true;
  data: CreateLot & { postedByName: string };
  // Resin-normalised values the server will persist (canonical
  // polymer + leftover-modifier grade + resolved color). Surfaces on
  // the wire so the wizard's preview table can render the resolved
  // badge BEFORE the seller commits.
  normalized: { polymer: string; grade: string | null; color: string | null };
};
export type RowValidationFailure = {
  ok: false;
  errors: Array<{ field: CanonicalField; message: string }>;
  values: Partial<Record<CanonicalField, string>>;
  // Same normalized shape on failure so the wizard can still surface
  // the canonicalisation when the failure is in an unrelated field.
  normalized: { polymer: string; grade: string | null; color: string | null };
};
export type RowValidationResult = RowValidationSuccess | RowValidationFailure;

export interface ValidateContext {
  // Seller's trusted display name, derived from the authenticated account.
  posterName: string;
  /**
   * Original (raw) spreadsheet header for the column the seller mapped
   * to `quantity`. The unit bias comes from the *header*, not the value:
   * a column literally named `qty_kg` always means kilograms; a column
   * named `quantity` is unit-ambiguous and the (optional) `unit` column
   * decides. The same idea applies to `askingPricePerLb`.
   */
  quantityHeader: string | null;
  priceHeader: string | null;
}

/**
 * Apply a HeaderMapping + the raw source row → a per-canonical mapped row.
 * Whatever the seller wrote in the spreadsheet column for `type` lands at
 * `values.type` here; the validator then asserts canonical values.
 */
export function applyMapping(sourceRow: Record<string, string>, mapping: HeaderMapping): MappedRow {
  const values: Partial<Record<CanonicalField, string>> = {};
  for (const [sourceHeader, target] of Object.entries(mapping)) {
    if (!target) continue;
    const raw = sourceRow[sourceHeader];
    if (raw === undefined || raw === null) continue;
    const trimmed = String(raw).trim();
    // Last-write-wins for two source columns that all target the same
    // canonical field. The wizard already flags the ambiguous case in
    // recognizeHeaders(), so this is at most a confirmation beat.
    if (trimmed.length > 0) values[target as CanonicalField] = trimmed;
  }
  return { values };
}

/**
 * Apply seller's per-row edits (in the inline drawer on a preview row).
 * Overlays edits on top of a mapped row without filling in canonicals the
 * seller did not touch (the sheet value wins for those).
 */
export function applyEdits(
  base: MappedRow,
  edits: Partial<Record<CanonicalField, string>>,
): MappedRow {
  const out: Partial<Record<CanonicalField, string>> = { ...base.values };
  for (const [k, val] of Object.entries(edits) as Array<[CanonicalField, string | undefined]>) {
    if (val === undefined) continue;
    const trimmed = val.trim();
    if (trimmed.length > 0) out[k] = trimmed;
    else delete out[k];
  }
  return { values: out };
}

/**
 * Validate a mapped row through the same per-row contract used by the
 * legacy /api/lots/bulk route. Returns `{ ok, data }` on success and
 * `{ ok: false, errors[] }` on failure — the wizard renders the errors
 * on a per-row basis (no whole-file rejection).
 */
export function validateMappedRow(row: MappedRow, ctx: ValidateContext): RowValidationResult {
  const v = row.values;
  const errors: Array<{ field: CanonicalField; message: string }> = [];

  for (const req of CANONICAL_FIELDS_REQUIRED) {
    if (!v[req] || v[req]?.trim().length === 0) {
      errors.push({ field: req, message: 'is required' });
    }
  }

  const typeRaw = (v.type ?? '').toUpperCase();
  let lotType: 'HAVE' | 'WANTED' | null = null;
  if (typeRaw === 'HAVE' || typeRaw === 'WANTED') {
    lotType = typeRaw;
  } else if (v.type && v.type.trim().length > 0) {
    errors.push({ field: 'type', message: 'must be "HAVE" or "WANTED"' });
  }

  const polymerRaw = (v.polymer ?? '').trim();
  const gradeRaw = (v.grade ?? '').trim();
  const colorRaw = (v.color ?? '').trim();

  // Resin terminology normalisation runs BEFORE the strict enum
  // match on `polymer` so a spreadsheet column containing
  // `Polycarbonate` or `Nylon 66` or `Polypro` (common trader
  // shorthand) resolves to its canonical — the wizard otherwise
  // surfaces a "must be one of: …" row error for synonyms the
  // canonical parser handles.
  const resolved = resolveResinRow(polymerRaw, gradeRaw, colorRaw);

  let polymer: Polymer | null = null;
  if (resolved.polymer && (PolymerEnum.options as readonly string[]).includes(resolved.polymer)) {
    polymer = resolved.polymer as Polymer;
  } else if (polymerRaw.length > 0) {
    // Show a friendly hint listing the canonicals the parser
    // recognises so the seller can fix a typo by hand.
    errors.push({
      field: 'polymer',
      message: `unrecognised polymer "${polymerRaw}" — try one of: ${PolymerEnum.options.join(', ')}`,
    });
  }

  const conditionRaw = (v.condition ?? '').toUpperCase();
  let condition: LotCondition | null = null;
  if (conditionRaw.length > 0) {
    if ((LotConditionEnum.options as readonly string[]).includes(conditionRaw)) {
      condition = conditionRaw as LotCondition;
    } else {
      errors.push({
        field: 'condition',
        message: `must be one of: ${LotConditionEnum.options.join(', ')}`,
      });
    }
  }

  const inferredQuantityUnit = inferQuantityUnitFromHeader(ctx.quantityHeader);
  const { quantityLb, quantityError } = resolveQuantity(v, inferredQuantityUnit);
  if (quantityError) errors.push(quantityError);

  const inferredPriceUnit = inferPriceUnitFromHeader(ctx.priceHeader);
  const { pricePerLb, error: priceError } = resolvePrice(v.askingPricePerLb, inferredPriceUnit);
  if (priceError) errors.push(priceError);

  // Canonicalised grade (modifier leftovers after lifting polymer /
  // glass / color / flame / variant out). Cap length against the
  // post-resolve string — the brief pinned 120 chars.
  const grade = resolved.grade ?? '';
  if (grade.length > 120) {
    errors.push({ field: 'grade', message: 'must be 120 characters or fewer' });
  }
  const manufacturer = (v.manufacturer ?? '').trim();
  if (manufacturer.length > 120) {
    errors.push({ field: 'manufacturer', message: 'must be 120 characters or fewer' });
  }
  const color = resolved.color;
  if (color.length > 80) {
    errors.push({ field: 'color', message: 'must be 80 characters or fewer' });
  }
  const form = (v.form ?? '').trim();
  if (form.length > 80) {
    errors.push({ field: 'form', message: 'must be 80 characters or fewer' });
  }
  const packaging = (v.packaging ?? '').trim();
  if (packaging.length > 80) {
    errors.push({ field: 'packaging', message: 'must be 80 characters or fewer' });
  }
  const country = (v.country ?? '').trim();
  if (country.length > 80) {
    errors.push({ field: 'country', message: 'must be 80 characters or fewer' });
  }
  const location = (v.location ?? '').trim();
  if (location.length > 160) {
    errors.push({ field: 'location', message: 'must be 160 characters or fewer' });
  }
  const notes = (v.notes ?? '').trim();
  if (notes.length > 1500) {
    errors.push({ field: 'notes', message: 'must be 1500 characters or fewer' });
  }

  let visibility: LotVisibility | null = null;
  const visRaw = (v.visibility ?? '').trim();
  if (visRaw.length === 0) {
    visibility = 'VERIFIED_COMPANIES_ONLY';
  } else {
    const k = visRaw.toLowerCase().replace(/[\s_-]+/g, '_');
    switch (k) {
      case 'public':
        visibility = 'PUBLIC';
        break;
      case 'verified_companies':
      case 'verified':
        visibility = 'VERIFIED_COMPANIES_ONLY';
        break;
      case 'my_network':
      case 'network':
        visibility = 'MY_NETWORK';
        break;
      case 'anonymous':
        visibility = 'ANONYMOUS';
        break;
      case 'selected_companies':
      case 'selected':
        errors.push({
          field: 'visibility',
          message:
            '"Selected companies" requires a recipient list — create that listing via the single-listing form.',
        });
        break;
      default:
        errors.push({
          field: 'visibility',
          message: `must be one of: ${LotVisibilityEnum.options.join(', ').toLowerCase()}`,
        });
    }
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      values: v,
      normalized: {
        polymer: resolved.polymer,
        grade: resolved.grade,
        color: resolved.color,
      },
    };
  }

  const postedByName = ctx.posterName.trim() || 'Seller';
  const assembled = {
    type: lotType ?? 'HAVE',
    polymer: polymer as Polymer,
    condition: condition as LotCondition,
    color,
    form,
    manufacturer: manufacturer || null,
    grade: grade || null,
    quantityLb,
    packaging,
    location: location || null,
    country,
    askingPricePerLb: pricePerLb,
    hasCoa: false,
    notes: notes || null,
    visibility: visibility as LotVisibility,
  };
  const parsed = CreateLotSchema.safeParse(assembled);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const field = (firstIssue?.path?.[0] as CanonicalField | undefined) ?? 'grade';
    const message = firstIssue?.message ?? 'row did not match the lot schema';
    return {
      ok: false,
      errors: [{ field, message }],
      values: v,
      normalized: {
        polymer: resolved.polymer,
        grade: resolved.grade,
        color: resolved.color,
      },
    };
  }
  return {
    ok: true,
    data: { ...parsed.data, postedByName },
    normalized: {
      polymer: resolved.polymer,
      grade: resolved.grade,
      color: resolved.color,
    },
  };
}

const KG_TO_LB = 2.20462;

/**
 * Decide which unit a quantity column was authored in.
 * - `qty_kg` / `quantity_kg` → kg
 * - `qty_lb` / `lbs` / `quantity_lb` → lb
 * - `quantity` / `weight` → ambiguous; caller decides (default lb)
 */
export function inferQuantityUnitFromHeader(
  rawHeader: string | null | undefined,
): 'kg' | 'lb' | null {
  if (!rawHeader) return null;
  const k = String(rawHeader)
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  if (k.includes('kg')) return 'kg';
  if (k.includes('lb') || k.includes('lbs')) return 'lb';
  return null;
}

/** Same idea for asking price — kg vs lb. */
export function inferPriceUnitFromHeader(rawHeader: string | null | undefined): 'kg' | 'lb' | null {
  if (!rawHeader) return null;
  const k = String(rawHeader)
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  if (k.includes('perkg')) return 'kg';
  if (k.includes('perlb')) return 'lb';
  return null;
}

/**
 * Resolve a sheet quantity + unit context into pounds. Priority:
 *   1. Explicit `unit` column wins (kg / lb / lbs / pounds).
 *   2. Header-inferred unit (kg from qty_kg, lb from qty_lb).
 *   3. Default: treat the value as already lb.
 */
export function resolveQuantity(
  values: Partial<Record<CanonicalField, string>>,
  inferredUnit: 'kg' | 'lb' | null,
): { quantityLb: number; quantityError: { field: CanonicalField; message: string } | null } {
  const raw = (values.quantity ?? '').trim();
  if (raw.length === 0) {
    return { quantityLb: 0, quantityError: null };
  }
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) {
    return {
      quantityLb: 0,
      quantityError: { field: 'quantity', message: 'must be a non-negative number' },
    };
  }
  const unitRaw = (values.unit ?? '').trim().toLowerCase();
  let unit: 'kg' | 'lb' | null = inferredUnit;
  if (unitRaw === 'kg') {
    unit = 'kg';
  } else if (unitRaw === 'lb' || unitRaw === 'lbs' || unitRaw === 'pounds') {
    unit = 'lb';
  } else if (unitRaw.length > 0) {
    return {
      quantityLb: 0,
      quantityError: { field: 'unit', message: 'must be "kg" or "lb"' },
    };
  }
  if (unit === 'kg') {
    return { quantityLb: Number((n * KG_TO_LB).toFixed(2)), quantityError: null };
  }
  return { quantityLb: Number(n.toFixed(2)), quantityError: null };
}

/** Convert a sheet price + inferred-unit context into $/lb. */
export function resolvePrice(
  raw: string | undefined,
  inferredUnit: 'kg' | 'lb' | null,
): { pricePerLb: number | null; error: { field: CanonicalField; message: string } | null } {
  if (!raw || raw.trim().length === 0) {
    return { pricePerLb: null, error: null };
  }
  const n = Number.parseFloat(raw.trim());
  if (!Number.isFinite(n) || n < 0) {
    return {
      pricePerLb: null,
      error: { field: 'askingPricePerLb', message: 'must be a non-negative number or empty' },
    };
  }
  if (inferredUnit === 'kg') {
    return { pricePerLb: Number((n * KG_TO_LB).toFixed(2)), error: null };
  }
  return { pricePerLb: Number(n.toFixed(2)), error: null };
}
