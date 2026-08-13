// @polsia:user-owned — shared filter contract for /api/lots browse. Imported by
// the route handler (server) AND the browse island (client); the URL ↔ state
// shape is defined ONCE here so sidebar toggles and server `where` can't drift.
//
// Server-applied keys (Prisma `where`): type, polymer[], condition, form,
// grade, color, q (free-text across notes/manufacturer/grade/color), coa.
// Pure client-side (filtered against the in-memory fetched set): mfrMin/Max,
// glassMin/Max, recycledMin/Max, flame, cert. They round-trip through the
// contract so the URL stays shareable; the handler echoes them but doesn't
// query on them.
import { z } from 'zod';
import { LotConditionEnum, LotTypeEnum, PolymerEnum } from '@/lib/contracts/lots';

// --- Stable search-param key names. Single source of truth for both sides.
export const FILTER_KEYS = {
  type: 'type',
  polymer: 'polymer',
  condition: 'condition',
  form: 'form',
  grade: 'grade',
  color: 'color',
  q: 'q',
  coa: 'coa',
  mfrMin: 'mfrMin',
  mfrMax: 'mfrMax',
  glassMin: 'glassMin',
  glassMax: 'glassMax',
  recycledMin: 'recycledMin',
  recycledMax: 'recycledMax',
  flame: 'flame',
  cert: 'cert',
  quantityMin: 'quantityMin',
  quantityMax: 'quantityMax',
  location: 'location',
  limit: 'limit',
} as const;

// --- Filter shape — what the island puts in state and what the route handler
//     applies to Prisma `where`. Set fields use arrays (not Set) so the value
//     is JSON-serialisable across the wire and URL.
export const LotFilter = z.object({
  type: z.enum(['ALL', 'HAVE', 'WANTED']).default('ALL'),
  polymers: z.array(PolymerEnum).default([]),
  conditions: z.array(LotConditionEnum).default([]),
  form: z.string().default(''),
  grade: z.string().default(''),
  color: z.string().default(''),
  q: z.string().default(''),
  hasCoa: z.boolean().nullable().default(null),
  mfrMin: z.number().nullable().default(null),
  mfrMax: z.number().nullable().default(null),
  glassMin: z.number().nullable().default(null),
  glassMax: z.number().nullable().default(null),
  recycledMin: z.number().nullable().default(null),
  recycledMax: z.number().nullable().default(null),
  flame: z.string().default(''),
  certs: z.array(z.string()).default([]),
  // Quantity (lb) — closed interval, both bounds optional. Applied as a
  // Prisma `gte`/`lte` on `Lot.quantityLb` so the same filter reproduces
  // identical results on /api/lots and the saved-search matchCount.
  quantityMin: z.number().nullable().default(null),
  quantityMax: z.number().nullable().default(null),
  // Free-text on Lot.location — case-insensitive substring. Mirrors the
  // grade/color form/grade convention.
  location: z.string().default(''),
  limit: z.number().int().positive().default(100),
});

export type LotFilter = z.infer<typeof LotFilter>;

export const DEFAULT_FILTER: LotFilter = LotFilter.parse({});

const optionalNumber = (raw: string | null): number | null => {
  if (raw === null || raw.trim() === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
};

const splitList = (raw: string | null): string[] => {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

// Parse a URLSearchParams (or anything `.get()`-able) into a LotFilter. Used
// by both the initial URL read in the island (so a shared URL reproduces the
// filtered view) and the route handler (so server-side filters and the
// emitted `where` can't disagree).
export function parseLotFilter(source: URLSearchParams): LotFilter {
  const raw = {
    type: source.get(FILTER_KEYS.type) ?? '',
    polymers: source.getAll(FILTER_KEYS.polymer),
    conditions: source.getAll(FILTER_KEYS.condition),
    form: source.get(FILTER_KEYS.form) ?? '',
    grade: source.get(FILTER_KEYS.grade) ?? '',
    color: source.get(FILTER_KEYS.color) ?? '',
    q: source.get(FILTER_KEYS.q) ?? '',
    hasCoa: source.get(FILTER_KEYS.coa) ?? '',
    mfrMin: source.get(FILTER_KEYS.mfrMin) ?? '',
    mfrMax: source.get(FILTER_KEYS.mfrMax) ?? '',
    glassMin: source.get(FILTER_KEYS.glassMin) ?? '',
    glassMax: source.get(FILTER_KEYS.glassMax) ?? '',
    recycledMin: source.get(FILTER_KEYS.recycledMin) ?? '',
    recycledMax: source.get(FILTER_KEYS.recycledMax) ?? '',
    flame: source.get(FILTER_KEYS.flame) ?? '',
    certs: source.getAll(FILTER_KEYS.cert),
    quantityMin: source.get(FILTER_KEYS.quantityMin) ?? '',
    quantityMax: source.get(FILTER_KEYS.quantityMax) ?? '',
    location: source.get(FILTER_KEYS.location) ?? '',
    limit: source.get(FILTER_KEYS.limit) ?? '',
  };

  // Validate polymers / conditions against their enums; drop unknowns so a
  // casual URL with an invalid value still works (don't 400).
  const polymerValues = raw.polymers.flatMap(splitList);
  const conditionValues = raw.conditions.flatMap(splitList);
  const polymers = polymerValues.filter(
    (v): v is z.infer<typeof PolymerEnum> => PolymerEnum.safeParse(v).success,
  );
  const conditions = conditionValues.filter(
    (v): v is z.infer<typeof LotConditionEnum> => LotConditionEnum.safeParse(v).success,
  );
  const typeParsed = LotTypeEnum.safeParse(raw.type);

  let hasCoa: boolean | null = null;
  if (raw.hasCoa === 'true') hasCoa = true;
  else if (raw.hasCoa === 'false') hasCoa = false;

  const limitParsed = (() => {
    const n = optionalNumber(raw.limit);
    if (n === null) return 100;
    return Math.min(200, Math.max(1, Math.floor(n)));
  })();

  return LotFilter.parse({
    type: typeParsed.success ? typeParsed.data : 'ALL',
    polymers,
    conditions,
    form: raw.form.trim(),
    grade: raw.grade.trim(),
    color: raw.color.trim(),
    q: raw.q.trim(),
    hasCoa,
    mfrMin: optionalNumber(raw.mfrMin),
    mfrMax: optionalNumber(raw.mfrMax),
    glassMin: optionalNumber(raw.glassMin),
    glassMax: optionalNumber(raw.glassMax),
    recycledMin: optionalNumber(raw.recycledMin),
    recycledMax: optionalNumber(raw.recycledMax),
    flame: raw.flame.trim(),
    certs: raw.certs.flatMap(splitList),
    quantityMin: optionalNumber(raw.quantityMin),
    quantityMax: optionalNumber(raw.quantityMax),
    location: raw.location.trim(),
    limit: limitParsed,
  });
}

// Serialise a LotFilter to URLSearchParams. Empty values are dropped so the
// URL stays short and shareable. List-valued keys use comma-join (so repeated
// `?polymer=PP&polymer=PE_HDPE` and `?polymer=PP,PE_HDPE` both work).
export function lotFilterToParams(filter: LotFilter): URLSearchParams {
  const out = new URLSearchParams();
  if (filter.type !== 'ALL') out.set(FILTER_KEYS.type, filter.type);
  if (filter.polymers.length > 0) out.set(FILTER_KEYS.polymer, filter.polymers.join(','));
  if (filter.conditions.length > 0) out.set(FILTER_KEYS.condition, filter.conditions.join(','));
  if (filter.form) out.set(FILTER_KEYS.form, filter.form);
  if (filter.grade) out.set(FILTER_KEYS.grade, filter.grade);
  if (filter.color) out.set(FILTER_KEYS.color, filter.color);
  if (filter.q) out.set(FILTER_KEYS.q, filter.q);
  if (filter.hasCoa !== null) out.set(FILTER_KEYS.coa, filter.hasCoa ? 'true' : 'false');
  if (filter.mfrMin !== null) out.set(FILTER_KEYS.mfrMin, String(filter.mfrMin));
  if (filter.mfrMax !== null) out.set(FILTER_KEYS.mfrMax, String(filter.mfrMax));
  if (filter.glassMin !== null) out.set(FILTER_KEYS.glassMin, String(filter.glassMin));
  if (filter.glassMax !== null) out.set(FILTER_KEYS.glassMax, String(filter.glassMax));
  if (filter.recycledMin !== null) out.set(FILTER_KEYS.recycledMin, String(filter.recycledMin));
  if (filter.recycledMax !== null) out.set(FILTER_KEYS.recycledMax, String(filter.recycledMax));
  if (filter.flame) out.set(FILTER_KEYS.flame, filter.flame);
  if (filter.certs.length > 0) out.set(FILTER_KEYS.cert, filter.certs.join(','));
  if (filter.quantityMin !== null) out.set(FILTER_KEYS.quantityMin, String(filter.quantityMin));
  if (filter.quantityMax !== null) out.set(FILTER_KEYS.quantityMax, String(filter.quantityMax));
  if (filter.location) out.set(FILTER_KEYS.location, filter.location);
  return out;
}

export function isFilterEmpty(filter: LotFilter): boolean {
  return lotFilterToParams(filter).toString() === '';
}
