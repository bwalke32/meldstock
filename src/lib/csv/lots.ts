// @polsia:user-owned — client-safe, pure CSV parser + per-row validator for
// bulk-uploading HAVE/WANTED lots. No DB, no `process.env`, no `next/headers`
// — both the API route handler AND the upload island import these helpers so
// headers + per-row semantics stay in lockstep with what the seller pastes.
//
// Documented column convention:
//   Required: lot_type, polymer, condition, grade, qty_kg, price_usd_per_kg,
//             country, color, form, packaging
//   Optional: visibility, manufacturer, location, notes
// The validator fills postedByName from session.user.name when the column is
// absent so the brief's required-columns list can stay short.

import { resolveResinRow } from '@/lib/business/resin-normalize';
import { CreateLot, LotConditionEnum, type LotVisibility, PolymerEnum } from '@/lib/contracts/lots';

export const LOT_CSV_REQUIRED_COLUMNS = [
  'lot_type',
  'polymer',
  'condition',
  'grade',
  'qty_kg',
  'price_usd_per_kg',
  'country',
  'color',
  'form',
  'packaging',
] as const;

export const LOT_CSV_OPTIONAL_COLUMNS = [
  'visibility',
  'manufacturer',
  'location',
  'notes',
] as const;

export const LOT_CSV_ALL_COLUMNS = [...LOT_CSV_REQUIRED_COLUMNS, ...LOT_CSV_OPTIONAL_COLUMNS];

// Industry measures in lb; the row ships kg and we convert once here so the
// whole stack reads the same unit. Pin the constant so future tests have a
// single source of truth.
export const KG_TO_LB = 2.20462;

export type LotCsvRow = Record<string, string>;

export interface ParsedLotsCsv {
  headers: string[];
  rows: LotCsvRow[];
}

const POLYMER_VALUES = new Set<string>(PolymerEnum.options);
const CONDITION_VALUES = new Set<string>(LotConditionEnum.options);

// RFC-4180-ish parser: handles quoted fields with embedded commas and
// `""`-escaped quotes. CRLF and LF terminators both accepted. Trailing blank
// rows (a single newline at EOF is common from Excel exports) are dropped so
// they don't show up as a spurious "empty row" error. UTF-8 BOM (U+FEFF)
// stripped from the leading edge so an Excel-saved CSV parses without a
// stray invisible prefix in the first header.
export function parseLotsCsv(text: string): ParsedLotsCsv {
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const normalised = stripped.replace(/\r\n?/g, '\n');
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < normalised.length; i++) {
    const ch = normalised[i];
    if (inQuotes) {
      if (ch === '"') {
        if (normalised[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      record.push(field);
      field = '';
      continue;
    }
    if (ch === '\n') {
      record.push(field);
      field = '';
      records.push(record);
      record = [];
      continue;
    }
    field += ch;
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  if (records.length === 0) {
    return { headers: [], rows: [] };
  }
  const headerRow = records[0];
  if (!headerRow) {
    return { headers: [], rows: [] };
  }
  const headers = headerRow.map((h) => h.trim());
  const rows: LotCsvRow[] = [];
  // Start at 1 to skip the header row.
  records.slice(1).forEach((line) => {
    if (line.length === 1 && line[0] === '') return; // skip blank lines
    const obj: LotCsvRow = {};
    headers.forEach((header, c) => {
      const raw = line[c] ?? '';
      obj[header] = raw.trim();
    });
    rows.push(obj);
  });
  return { headers, rows };
}

export type HeaderValidationFailure = {
  ok: false;
  missing: string[];
  forbidden: string[];
};

// Returns ok=false if the header row is missing a required column or attempts
// to supply ownership/identity. Other unknown columns are allowed and
// silently ignored — the loader fills in what it needs and skips the rest.
export function validateCsvHeaders(
  headers: string[],
): { ok: true; missing: never[] } | HeaderValidationFailure {
  const normalised = headers.map((h) => h.toLowerCase());
  const forbidden = normalised.filter((header) =>
    ['posted_by_name', 'posted_by_user_id', 'postedbyname', 'postedbyuserid'].includes(header),
  );
  const missing: string[] = [];
  for (const req of LOT_CSV_REQUIRED_COLUMNS) {
    if (!normalised.includes(req)) missing.push(req);
  }
  if (missing.length > 0 || forbidden.length > 0) return { ok: false, missing, forbidden };
  return { ok: true, missing: [] };
}

export interface SessionContext {
  name: string;
}

export type RowValidationResult =
  | { ok: true; data: ReturnType<typeof CreateLot.parse> & { postedByName: string } }
  | { ok: false; error: string };

// Validates one CSV row against the shared `CreateLot` zod contract.
// Converts units (kg → lb), normalises categorical columns, trims text, and
// returns the parser-ready object on success. On failure returns an
// `{ column: message }`-shaped error so the seller can locate the problem in
// the source CSV. Posting identity always comes from the authenticated
// session context and is never accepted from a CSV column.
export function validateAndMapLotRow(raw: LotCsvRow, session: SessionContext): RowValidationResult {
  const get = (key: string): string => {
    const v = raw[key];
    return v === undefined ? '' : v.trim();
  };

  const lotTypeRaw = get('lot_type');
  const lotType = lotTypeRaw.toUpperCase();
  if (lotType !== 'HAVE' && lotType !== 'WANTED') {
    return err('lot_type', 'must be "have" or "wanted"');
  }

  const polymerRaw = get('polymer').toUpperCase();
  if (!POLYMER_VALUES.has(polymerRaw)) {
    return err('polymer', `must be one of: ${[...POLYMER_VALUES].join(', ')}`);
  }

  const condition = get('condition').toUpperCase();
  if (!CONDITION_VALUES.has(condition)) {
    return err('condition', `must be one of: ${[...CONDITION_VALUES].join(', ')}`);
  }

  // Resin terminology normaliser — single call site for CSV bulk import.
  // Accepts common synonyms (Nylon 66 = PA66, Polycarbonate = PC,
  // Polypro = PP, Acetal = POM…) and shorthand grade strings
  // (PA66 GF33 BK, ABS NAT, PC FR, PP COPO…) so the same row typed
  // three different ways resolves to the same matchable material.
  // Override only fires when the polymer column is literally `OTHER`
  // AND the grade string carries a direct polymer alias; otherwise
  // the dropdown choice wins and the canonicalised grade string
  // (modifier leftovers) is persisted to `lot.grade`.
  const colorRaw = get('color');
  const gradeRawForNormalizer = get('grade');
  if (gradeRawForNormalizer.length === 0) {
    return err('grade', 'is required');
  }
  if (gradeRawForNormalizer.length > 120) {
    return err('grade', 'must be 120 characters or fewer');
  }
  // Length cap on the canonicalised output too — the brief pinned
  // 120 chars, and resolveResinRow may strip tokens (e.g. lifting
  // `BK` / `GF33` out of `PA66 GF33 BK` to nothing), so we check
  // against the post-resolve string before persisting.
  const resolved = resolveResinRow(polymerRaw, gradeRawForNormalizer, colorRaw);
  if (resolved.grade && resolved.grade.length > 120) {
    return err('grade', 'must be 120 characters or fewer');
  }
  const polymer = resolved.polymer;
  const grade = resolved.grade ?? '';

  const qtyKg = parseDecimal(get('qty_kg'));
  if (qtyKg === null || qtyKg < 0) return err('qty_kg', 'must be a non-negative number');
  // Industry measures in lb; convert kg → lb once at parse time so every
  // downstream reader (DB / wire / client) speaks the same unit.
  const quantityLb = Number((qtyKg * KG_TO_LB).toFixed(2));

  const priceRaw = get('price_usd_per_kg');
  // SPEC: empty → null (a HAVE lot can post without a price). Otherwise the
  // value must parse as a non-negative number; convert to $/lb here.
  let askingPricePerLb: number | null = null;
  if (priceRaw !== '') {
    const n = parseDecimal(priceRaw);
    if (n === null || n < 0)
      return err('price_usd_per_kg', 'must be a non-negative number or empty');
    askingPricePerLb = Number((n * KG_TO_LB).toFixed(2));
  }

  const country = get('country');
  if (country.length === 0) return err('country', 'is required');
  if (country.length > 80) return err('country', 'must be 80 characters or fewer');

  // Color resolved from the column value + the grade string. The
  // brief: typed color shorthands (`BK`, `NAT`) get promoted to their
  // long label (`Black`, `Natural`) so a buyer searching by the long
  // form picks up the same row.
  const color = resolved.color;
  if (color.length === 0) return err('color', 'is required');
  if (color.length > 80) return err('color', 'must be 80 characters or fewer');

  const form = get('form');
  if (form.length === 0) return err('form', 'is required');
  if (form.length > 80) return err('form', 'must be 80 characters or fewer');

  const packaging = get('packaging');
  if (packaging.length === 0) return err('packaging', 'is required');
  if (packaging.length > 80) return err('packaging', 'must be 80 characters or fewer');

  const visibility = resolveVisibility(get('visibility'));
  // SELECTED_COMPANIES can't be expressed per bulk row — that tier requires
  // a recipient list. Surface as a row error so the seller splits it out.
  if (visibility === 'SELECTED_COMPANIES') {
    return err(
      'visibility',
      '"selected companies" requires a recipient list — create that listing via the single-listing form',
    );
  }
  if (visibility === null) {
    return err('visibility', 'must be one of: public, verified_companies, my_network, anonymous');
  }

  const manufacturer = get('manufacturer');
  if (manufacturer.length > 120) return err('manufacturer', 'must be 120 characters or fewer');

  const location = get('location');
  if (location.length > 160) return err('location', 'must be 160 characters or fewer');

  const notes = get('notes');
  if (notes.length > 1500) return err('notes', 'must be 1500 characters or fewer');

  const postedByName = session.name.trim() || 'Meldstock member';

  const parsed = CreateLot.safeParse({
    type: lotType,
    polymer,
    condition,
    color,
    form,
    manufacturer: manufacturer || null,
    grade,
    quantityLb,
    packaging,
    location: location || null,
    country,
    askingPricePerLb,
    hasCoa: false,
    notes: notes || null,
    visibility,
  });
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const column = firstIssue?.path?.join('.') ?? 'row';
    return err(column, firstIssue?.message ?? 'row did not match the lot schema');
  }
  return { ok: true, data: { ...parsed.data, postedByName } };
}

function err(column: string, message: string): { ok: false; error: string } {
  return { ok: false, error: `${column}: ${message}` };
}

function parseDecimal(raw: string): number | null {
  if (!raw) return null;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

// "verified companies" / "my network" → enum-equivalent forms. Accepts both
// the underscored CSV-friendly header style and the spaced readable form.
// `selected_companies` returns the SELECTED_COMPANIES sentinel so the
// caller can branch on it (the brief: that tier is rejected per bulk row).
function resolveVisibility(raw: string): LotVisibility | 'SELECTED_COMPANIES' | null {
  if (!raw) return 'VERIFIED_COMPANIES_ONLY';
  const v = raw.toLowerCase().replace(/\s+/g, '_');
  switch (v) {
    case 'public':
      return 'PUBLIC';
    case 'verified_companies':
    case 'verified':
      return 'VERIFIED_COMPANIES_ONLY';
    case 'my_network':
    case 'network':
      return 'MY_NETWORK';
    case 'selected_companies':
    case 'selected':
      return 'SELECTED_COMPANIES';
    case 'anonymous':
      return 'ANONYMOUS';
    default:
      return null;
  }
}
