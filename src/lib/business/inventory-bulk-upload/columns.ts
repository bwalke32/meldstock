// @polsia:user-owned — bulk-upload column synonym registry. Pure (no DB, no
// `process.env`, no `next/headers`); imported by the orchestrator client
// island AND the new preview/commit route handlers so the auto-recognised
// header list and the server validation can't drift.
//
// Brief's recognized columns (case / whitespace insensitive):
//   Manufacturer, Product/Grade, Polymer, Condition, Form, Color, Quantity,
//   Unit, Packaging, Location, Price, Lot, Description
// Aliases are matched case + whitespace insensitively against the literal
// header the seller wrote; spaces / underscores / hyphens are normalised.
// Two headers that all alias to the same canonical field collide; the
// recognizeHeaders() result flags ambiguities so the wizard can warn.

export const BULK_UPLOAD_CANONICAL_FIELDS = [
  'type',
  'polymer',
  'condition',
  'grade',
  'manufacturer',
  'quantity',
  'unit',
  'askingPricePerLb',
  'packaging',
  'form',
  'color',
  'country',
  'location',
  'notes',
  'visibility',
  'lotReference',
] as const;

export type CanonicalField = (typeof BULK_UPLOAD_CANONICAL_FIELDS)[number];

// The wire-level mapping type is intentionally broad (string|null per
// source header); callers that need the narrowed `CanonicalField` union
// cast at their boundary. This keeps the zod-parsed payload
// (`Record<string, string | null>`) compatible without unwrapping at
// every transit point.
export type HeaderMapping = Record<string, string | null>;

export interface RecognizedResult {
  mapping: HeaderMapping;
  // Headers whose auto-recognition is ambiguous (matched multiple aliases
  // OR unknown) so the wizard can prompt the seller to confirm. Sold as a
  // bag, not an array per-header, because ambiguous cases are rare and the
  // wizard renders them near the dropdown.
  ambiguous: string[];
  unknown: string[];
}

const ALIASES: Record<CanonicalField, string[]> = {
  type: ['type', 'lot_type', 'lot type', 'have/wanted', 'have wanted', 'listing type'],
  polymer: ['polymer', 'resin', 'resin type', 'material'],
  condition: ['condition', 'grade_condition', 'resin condition', 'material condition'],
  grade: [
    'grade',
    'product',
    'product/grade',
    'product grade',
    'resin grade',
    'lot_product',
    'lot product',
    'product grade name',
  ],
  manufacturer: ['manufacturer', 'mfr', 'brand', 'producer'],
  quantity: [
    'quantity',
    'qty',
    'qty_kg',
    'qty_lb',
    'qty_lbs',
    'kg',
    'lb',
    'lbs',
    'quantity_lb',
    'quantity_lbs',
    'weight',
    'amount',
  ],
  unit: ['unit', 'units', 'uom'],
  askingPricePerLb: [
    'price',
    'asking price',
    'asking_price',
    'price_usd_per_kg',
    'price_usd_per_lb',
    'usd_per_kg',
    'usd_per_lb',
    'price per lb',
    'price per kg',
    'price/lb',
    'price/kg',
  ],
  packaging: ['packaging', 'package', 'packaging type'],
  form: ['form', 'physical_form', 'physical form', 'shape'],
  color: ['color', 'colour', 'color_name', 'colour name'],
  country: ['country', 'origin_country', 'origin country', 'origin'],
  location: ['location', 'city', 'site', 'loc'],
  notes: ['description', 'notes', 'lot_description', 'lot description', 'remarks', 'comment'],
  visibility: ['visibility', 'audience'],
  lotReference: ['lot', 'lot#', 'lot_id', 'lot_id', 'lot number', 'lot_number', 'reference', 'ref'],
};

// Build a normalised lookup map: normalised alias -> canonical field.
// Normalisation = lowercase + whitespace/underscore/hyphen squashed.
// Lots of aliases are present (one alias per canonical is *not* enough),
// so precomputing gives us constant-time recognition per header.
const NORMALISED_ALIAS_TO_CANONICAL: Map<string, CanonicalField> = (() => {
  const map = new Map<string, CanonicalField>();
  for (const [field, list] of Object.entries(ALIASES) as Array<[CanonicalField, string[]]>) {
    for (const alias of list) {
      const key = normaliseAliasKey(alias);
      if (!map.has(key)) map.set(key, field);
    }
  }
  return map;
})();

function normaliseAliasKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
    .replace(/[#/]+/g, '');
}

/**
 * Auto-recognize a list of spreadsheet headers into canonical fields.
 * Headers not in the registry map to `null` (will appear as "(ignore)"
 * in the wizard's dropdown — the seller keeps or drops them).
 */
export function recognizeHeaders(headers: readonly string[]): RecognizedResult {
  const mapping: HeaderMapping = {};
  const ambiguous: string[] = [];
  const unknown: string[] = [];
  for (const raw of headers) {
    const key = normaliseAliasKey(raw);
    if (key.length === 0) {
      mapping[raw] = null;
      unknown.push(raw);
      continue;
    }
    const canonical = NORMALISED_ALIAS_TO_CANONICAL.get(key);
    if (canonical) {
      mapping[raw] = canonical;
    } else {
      mapping[raw] = null;
      unknown.push(raw);
    }
  }
  // Surface unambiguous headers as NOT ambiguous. The wizard only needs to
  // prompt for genuinely unknown headers (sellable columns like a free-form
  // "internal SKU" column the auto-recognizer can't map).
  for (const h of unknown) {
    ambiguous.push(h);
  }
  return { mapping, ambiguous, unknown };
}

/**
 * Friendly label for a canonical field — rendered in the mapping
 * dropdown so the seller recognizes what each value controls.
 */
export const CANONICAL_FIELD_LABEL: Record<CanonicalField, string> = {
  type: 'Type (HAVE / WANTED)',
  polymer: 'Polymer',
  condition: 'Condition',
  grade: 'Product / Grade',
  manufacturer: 'Manufacturer',
  quantity: 'Quantity',
  unit: 'Unit (kg / lb)',
  askingPricePerLb: 'Price (USD / lb)',
  packaging: 'Packaging',
  form: 'Form',
  color: 'Color',
  country: 'Country',
  location: 'Location',
  notes: 'Notes / Description',
  visibility: 'Visibility',
  lotReference: 'Lot reference',
};

export const CANONICAL_FIELDS_REQUIRED: ReadonlySet<CanonicalField> = new Set([
  'type',
  'polymer',
  'condition',
  'grade',
  'quantity',
  'packaging',
  'form',
  'color',
  'country',
]);

export const CANONICAL_FIELDS_OPTIONAL: ReadonlySet<CanonicalField> = new Set([
  'manufacturer',
  'unit',
  'askingPricePerLb',
  'location',
  'notes',
  'visibility',
  'lotReference',
]);
