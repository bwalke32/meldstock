// @polsia:user-owned — single normalisation function for resin / material
// terminology. Imported by every entry seam (search, single-lot form,
// CSV bulk import, inventory-bulk-upload wizard) AND by the server's
// `GET /api/lots` lookup so the same input string resolves to the same
// matchable material record regardless of who enters it.
//
// Pure: no DB, no `process.env`, no `next/headers`. The function
// returns the canonical grade string + extracted polymer / color /
// glass / flame tokens so callers can populate `lot.polymer` /
// `lot.grade` / `lot.color` with the same canonical values a buyer
// would get when they re-type the same material in the search bar.
//
// `mode === 'search'` runs only the matching powers (parse the input
// so the handler can build a Prisma `where`). `mode === 'write'` runs
// the matching powers PLUS the polymer / color promotion so an
// `OTHER` polymer dropdown picks up its canonical from a typed
// grade (`"polycarbonate"` typed in the grade box → polymer = `PC`,
// grade = `""`, color = null); a typed color shorthand like `BK`
// populates `lot.color` independently so buyers who search by
// `Black` pick it up.
//
// Backward-compat invariant: if the parser cannot recognise ANY
// token, the canonical grade falls back to the uppercased raw input
// so the lot remains searchable by the literal seller-entered string
// (the brief: lot.grade retains the original prefix when the parser
// can't fully resolve).

import {
  COLOR_MAP,
  type ParsedResin,
  POLYMER_VARIANT_MODIFIERS,
  type PolymerVariantModifier,
  parseResinQuery,
  RESIN_CANONICAL_FOR_ALIAS,
} from '@/lib/business/resin-abbreviations';
import { type Polymer, PolymerEnum } from '@/lib/contracts/lots';

export type NormalizeMode = 'search' | 'write';

export interface NormalizedResin {
  polymers: Polymer[];
  gradeCanonical: string | null;
  // Tokens the canonical-grade string is built from. Surfaces the
  // suffix-stripped modifier leftovers from the input.
  gradeRawTokens: string[];
  // Glass % — same band the search side uses so a "GF33" write
  // matches a "GF33" search.
  glass: { min: number | null; max: number | null };
  flame: string | null;
  color: string | null;
  variants: PolymerVariantModifier[];
  chips: import('@/lib/business/resin-abbreviations').ResinChip[];
  // write-only — set when the parsed input has a polymer alias and
  // the caller can use it to promote an OTHER dropdown selection.
  polymerOverride: Polymer | null;
}

export interface NormalizeOptions {
  mode: NormalizeMode;
  // Caller's resolved polymer (from the dropdown or the CSV/wizard
  // column). When `mode === 'write'` and this resolves to `OTHER`
  // but the input string parses to a polymer, the returned
  // `polymerOverride` lets the caller promote the row to the
  // detected canonical.
  polymerCandidate?: Polymer | null;
}

const EMPTY: NormalizedResin = {
  polymers: [],
  gradeCanonical: null,
  gradeRawTokens: [],
  glass: { min: null, max: null },
  flame: null,
  color: null,
  variants: [],
  chips: [],
  polymerOverride: null,
};

/**
 * Split `rawInput` into normalised canon + extracted modifiers. Always
 * returns a non-null object — callers can read the chips and decide
 * whether to drop the canonical-grade fallback when nothing was
 * recognised.
 */
export function normalizeResinInput(
  rawInput: string | null | undefined,
  opts: NormalizeOptions,
): NormalizedResin {
  const raw = (rawInput ?? '').trim();
  if (!raw) return { ...EMPTY };

  const parsed = parseResinQuery(raw);
  const upper = raw.toUpperCase();

  // Multi-token alias recovery — "Nylon 66" tokenizes to
  // ["NYLON", "66"]; neither matches alone even though the alias map
  // has the joined form ("NYLON66"). After parseResinQuery returns,
  // if no polymer was found, try a single-shot lookup against the
  // full normalized input. This keeps parseResinQuery's per-token
  // beat intact for the search chip strip while letting the
  // canonical-resolver bridge multi-word near-matches.
  let polymers: Polymer[];
  let multiTokenPolymerMatch = false;
  if (parsed?.polymers?.length) {
    polymers = parsed.polymers;
  } else {
    const fullKey = normalizeAliasKey(upper);
    const fullMatch = RESIN_CANONICAL_FOR_ALIAS[fullKey];
    if (fullMatch && PolymerEnum.options.includes(fullMatch) && fullMatch !== 'OTHER') {
      polymers = [fullMatch];
      multiTokenPolymerMatch = true;
    } else {
      polymers = [];
    }
  }

  // Fallback path — no structured tokens recognised. Persist the
  // literal uppercased input so a buyer searching for the seller's
  // exact phrase still finds the lot.
  if (!parsed && polymers.length === 0) {
    const canonical = collapseWhitespace(upper);
    return {
      ...EMPTY,
      gradeCanonical: canonical || null,
      gradeRawTokens: canonical ? canonical.split(/\s+/) : [],
    };
  }

  const firstPolymer = polymers[0];
  const safeParsed: ParsedResin = parsed ?? {
    polymers,
    glassMin: null,
    glassMax: null,
    flame: null,
    color: null,
    mfrMin: null,
    mfrMax: null,
    variants: [],
    chips: firstPolymer ? [{ label: firstPolymer, tone: 'polymer' as const }] : [],
  };

  const tokens = splitTokens(raw);
  // Tokens lifted into structured buckets — they leave the canonical
  // grade so the persisted grade is the modifier remainder, mirroring
  // the search-side filter behaviour (glass/color/flame live on
  // first-class columns or are matched by their own range, never as
  // part of the literal `lot.grade` substring).
  const extracted = new Set<string>();

  for (const tok of tokens) {
    const upper_tok = tok.toUpperCase();
    if (RESIN_CANONICAL_FOR_ALIAS[normalizeAliasKey(upper_tok)]) {
      extracted.add(tok);
      continue;
    }
    if (COLOR_MAP[upper_tok]) {
      extracted.add(tok);
      continue;
    }
    if (isFlameOrFrToken(upper_tok)) {
      extracted.add(tok);
      continue;
    }
    if (/^G(?:F)?\d/.test(upper_tok) || /^MF(?:I)?\d/.test(upper_tok)) {
      extracted.add(tok);
      continue;
    }
    if ((POLYMER_VARIANT_MODIFIERS as readonly string[]).includes(upper_tok)) {
      extracted.add(tok);
      continue;
    }
    // MFI / MF standalone (already consumed by classifyGlassOrMfr if
    // adjacent to a numeric token, but a stray `MFI` after no number
    // is also safe to lift).
    if (upper_tok === 'MFI' || upper_tok === 'MF') {
      extracted.add(tok);
    }
  }

  const leftover = tokens.filter((t) => !extracted.has(t));
  let gradeCanonical: string | null =
    leftover.length > 0 ? collapseWhitespace(leftover.join(' ')) : null;
  // When the multi-token recovery consumed the WHOLE input (e.g.
  // `Nylon 66`), every per-token leftover IS part of the matched
  // polymer phrase — the polymer alias simply takes multi-token
  // form. Set `gradeCanonical` to null so the search-side branch
  // does not over-narrow on `lot.grade contains 'NYLON 66'`.
  if (multiTokenPolymerMatch && !safeParsed.color && !safeParsed.glassMin) {
    gradeCanonical = null;
  }

  const polymerOverride =
    opts.mode === 'write' && opts.polymerCandidate === 'OTHER' && polymers.length === 1
      ? (polymers[0] ?? null)
      : null;

  return {
    polymers,
    gradeCanonical,
    gradeRawTokens: leftover,
    glass: { min: safeParsed.glassMin, max: safeParsed.glassMax },
    flame: safeParsed.flame,
    color: safeParsed.color,
    variants: safeParsed.variants,
    chips: safeParsed.chips,
    polymerOverride,
  };
}

/**
 * Convenience helper used by the upload wizard's preview + commit
 * routes. Given the seller's resolved-or-entered polymer dropdown AND
 * the free-text grade the row carries (or the row's polymer column if
 * the seller didn't separate the two), return the polymer + grade the
 * server should persist for this row.
 *
 *   1. If the polymer dropdown resolves to a non-`OTHER` value, that
 *      wins and the grade is canonicalised (polymer lifted out).
 *   2. If the polymer dropdown is `OTHER` but the grade string
 *      contains a single, unambiguous polymer alias, promote the
 *      row to that polymer.
 *   3. Else preserve the seller's polymer choice and canonicalise
 *      the grade for storage.
 */
export interface ResolvedResinRow {
  polymer: Polymer;
  grade: string | null;
  color: string;
}

export function resolveResinRow(
  polymerDropdown: string | null | undefined,
  gradeRaw: string | null | undefined,
  colorRaw?: string | null | undefined,
): ResolvedResinRow {
  const candidate = parsePolymer(polymerDropdown);
  const normalized = normalizeResinInput(gradeRaw, {
    mode: 'write',
    polymerCandidate: candidate,
  });
  // Polymer dropdown wins when it's a non-`OTHER` canonical. The
  // override only kicks in when the dropdown is `OTHER` AND the
  // grade string carries a single unambiguous polymer alias.
  let polymer: Polymer;
  if (candidate && candidate !== 'OTHER' && normalized.polymerOverride === null) {
    polymer = candidate;
  } else if (normalized.polymerOverride) {
    polymer = normalized.polymerOverride;
  } else if (candidate) {
    polymer = candidate;
  } else {
    polymer = 'OTHER';
  }

  // Color: prefer the explicit color column (CSV / wizard column).
  // Fall back to a color resolved from the grade string itself.
  const colorFromColumn = (colorRaw ?? '').trim();
  let color = '';
  if (colorFromColumn) {
    color = colorFromColumn;
    // If the column value is a known shorthand (e.g. BK, NAT), promote
    // it to its long label so a buyer searching by `Black` picks it
    // up — the same canonicalisation runs on the search side.
    const colUpper = color.toUpperCase();
    const colMap = COLOR_MAP[colUpper];
    if (colMap) color = colMap.label;
  } else if (normalized.color) {
    color = normalized.color;
  }

  return {
    polymer,
    grade: normalized.gradeCanonical ?? null,
    color,
  };
}

function splitTokens(raw: string): string[] {
  return raw
    .trim()
    .split(/[\s,/_-]+/)
    .filter(Boolean);
}

function normalizeAliasKey(s: string): string {
  return s.replace(/[\s,/_-]+/g, '');
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function parsePolymer(raw: string | null | undefined): Polymer | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const canonical = RESIN_CANONICAL_FOR_ALIAS[normalizeAliasKey(trimmed.toUpperCase())];
  return canonical ?? null;
}

function isFlameOrFrToken(tok: string): boolean {
  if (tok === 'FR') return true;
  if (/^V[-]?[012]$/.test(tok)) return true;
  if (tok === 'HB') return true;
  return false;
}

/**
 * Re-export the parsed-resin type so callers can compose a single
 * import (`@/lib/business/resin-normalize`) for both search + write
 * seam shapes.
 */
export type { ParsedResin };
