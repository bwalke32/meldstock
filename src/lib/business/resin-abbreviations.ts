// @polsia:user-owned — parses industry shorthand strings such as
// `PA66 GF33 BK`, `ABS FR V0`, `PC GF20 NAT`, `PPH 12 MFI` into the same
// `LotFilter` shape the sidebar already drives. Reuses PolymerEnum values
// from `src/lib/contracts/lots.ts` as canonicals so the parsed values line up
// 1-for-1 with `?polymer=…` in /api/lots.
//
// The equivalents table (PA6 ↔ "Nylon 6", PC ↔ "Polycarbonate", etc.) lives
// here so the components don't carry hardcoded lookup data. Tokens are
// matched case-insensitively after a whitespace/dash/comma strip.
//
// Parsed scalars override the filter values (policy: parsed wins on conflict),
// arrays are unioned, mfr/glass/open numeric ranges use a ±2 tolerance band
// so a buyer typing `GF33` doesn't accidentally exclude `glass 32%`.
//
// Returns `null` when nothing was recognized so the existing free-text `q`
// path keeps working unchanged.
import { type Polymer, PolymerEnum } from '@/lib/contracts/lots';
import { LotFilter, type LotFilter as LotFilterT } from '@/lib/contracts/lots-filters';

export interface ResinEquivalent {
  /** Must match a `Polymer` value exactly (lots.prisma enum). */
  canonical: Polymer;
  aliases: string[];
}

// one row per canonical PolymerEnum value. Aliases include the most common
// industry shorthand ("PA 66", "Nylon 6,6", "Polycarbonate") plus
// manufacturer-style compact names ("PPH" → PP homopolymer).
export const RESIN_EQUIVALENTS: ResinEquivalent[] = [
  { canonical: 'ABS', aliases: ['ABS', 'Acrylonitrile Butadiene Styrene'] },
  {
    canonical: 'PC',
    aliases: ['PC', 'Polycarbonate', 'POLYCARB', 'POLYCARBONATE'],
  },
  { canonical: 'PP', aliases: ['PP', 'Polypropylene', 'PPH', 'POLYPRO', 'POLYPROP'] },
  { canonical: 'PE_HDPE', aliases: ['HDPE', 'PE_HDPE', 'PE HDPE', 'High Density Polyethylene'] },
  { canonical: 'PE_LDPE', aliases: ['LDPE', 'PE_LDPE', 'PE LDPE', 'Low Density Polyethylene'] },
  {
    canonical: 'PE_LLDPE',
    aliases: ['LLDPE', 'PE_LLDPE', 'PE LLDPE', 'Linear Low Density Polyethylene'],
  },
  { canonical: 'PA6', aliases: ['PA6', 'PA 6', 'Polyamide 6', 'Nylon 6', 'Nylon6'] },
  {
    canonical: 'PA66',
    aliases: [
      'PA66',
      'PA 66',
      'PA-66',
      'Polyamide 66',
      'Polyamide 6,6',
      'Nylon 66',
      'Nylon 6,6',
      'Nylon66',
    ],
  },
  { canonical: 'PA612', aliases: ['PA612', 'PA 612', 'Polyamide 612', 'Nylon 612', 'Nylon612'] },
  { canonical: 'PBT', aliases: ['PBT', 'Polybutylene Terephthalate'] },
  { canonical: 'PET', aliases: ['PET', 'Polyethylene Terephthalate'] },
  { canonical: 'POM', aliases: ['POM', 'Polyoxymethylene', 'Polyacetal', 'Acetal'] },
  { canonical: 'PPS', aliases: ['PPS', 'Polyphenylene Sulfide'] },
  { canonical: 'TPU', aliases: ['TPU', 'Thermoplastic Polyurethane'] },
  { canonical: 'TPV', aliases: ['TPV', 'Thermoplastic Vulcanizate'] },
  { canonical: 'TPE', aliases: ['TPE', 'Thermoplastic Elastomer'] },
  { canonical: 'HIPS', aliases: ['HIPS', 'High Impact Polystyrene', 'PS HI'] },
  { canonical: 'GPPS', aliases: ['GPPS', 'General Purpose Polystyrene', 'PS GP'] },
  { canonical: 'OTHER', aliases: ['OTHER'] },
];

// Polymer variant modifiers — they're not separate enums on the Prisma
// `Polymer` field, but a buyer types them next to a polymer (`PP COPO`,
// `PP HOMO`) so they should surface on the parsed chip strip. The
// canonical grade builder (resin-normalize) preserves them as informational
// tokens in the persisted grade string so the buyer remembers the variant.
export const POLYMER_VARIANT_MODIFIERS = ['COPO', 'HOMO'] as const;
export type PolymerVariantModifier = (typeof POLYMER_VARIANT_MODIFIERS)[number];

const VALID_CANONICALS = new Set<string>(PolymerEnum.options);

// O(1) alias → canonical lookup, built once at module load. Keys are the
// uppercase, separator-stripped version of every alias.
export const RESIN_CANONICAL_FOR_ALIAS: Record<string, Polymer> = (() => {
  const out: Record<string, Polymer> = {};
  for (const row of RESIN_EQUIVALENTS) {
    if (!VALID_CANONICALS.has(row.canonical)) continue;
    for (const alias of row.aliases) {
      const key = normalizeToken(alias);
      if (!(key in out)) {
        out[key] = row.canonical;
      }
    }
  }
  return out;
})();

// Industry color shorthand → long label. The brief asked for `BK → Black`,
// `NAT/NATURAL → Natural`, etc. Long labels are what `LotFilter.color` is
// later matched against in /api/lots (Prisma `contains`, case-insensitive),
// so writing `BK` would fail to match `Black` rows.
export const COLOR_MAP: Record<string, { label: string }> = {
  BK: { label: 'Black' },
  BLK: { label: 'Black' },
  BLACK: { label: 'Black' },
  NAT: { label: 'Natural' },
  NATURAL: { label: 'Natural' },
  NTRL: { label: 'Natural' },
  WH: { label: 'White' },
  WHT: { label: 'White' },
  WHITE: { label: 'White' },
  GY: { label: 'Gray' },
  GRY: { label: 'Gray' },
  GREY: { label: 'Gray' },
  GRAY: { label: 'Gray' },
  BL: { label: 'Blue' },
  BLUE: { label: 'Blue' },
  RD: { label: 'Red' },
  RED: { label: 'Red' },
  GN: { label: 'Green' },
  GRN: { label: 'Green' },
  GREEN: { label: 'Green' },
  YL: { label: 'Yellow' },
  YLW: { label: 'Yellow' },
  YELLOW: { label: 'Yellow' },
  OR: { label: 'Orange' },
  ORG: { label: 'Orange' },
  ORANGE: { label: 'Orange' },
  TN: { label: 'Tan' },
  TAN: { label: 'Tan' },
  BR: { label: 'Brown' },
  BRN: { label: 'Brown' },
  BROWN: { label: 'Brown' },
  PR: { label: 'Purple' },
  PUR: { label: 'Purple' },
  PURPLE: { label: 'Purple' },
  PK: { label: 'Pink' },
  PNK: { label: 'Pink' },
  PINK: { label: 'Pink' },
};

export type ResinChipTone = 'polymer' | 'glass' | 'flame' | 'color' | 'mfr';

export interface ResinChip {
  label: string;
  tone: ResinChipTone;
}

export interface ParsedResin {
  polymers: Polymer[];
  glassMin: number | null;
  glassMax: number | null;
  flame: string | null;
  color: string | null;
  mfrMin: number | null;
  mfrMax: number | null;
  // Polymer variants (e.g. `COPO` / `HOMO` next to `PP`) aren't first-class
  // enums but a buyer types them next to a polymer, so we surface them on
  // the chip strip and persist them in the canonical grade string.
  variants: PolymerVariantModifier[];
  chips: ResinChip[];
}

// Recognise V-0/V-1/V-2/HB even when written `V0`, `V-0`, `V0/FR`, or
// preceded by `FR`. `FR` alone is informational, not a flame code — so the
// public parser only sets `flame` when a V/HB token is also present.
export function flameFromTokens(tokens: string[]): string | null {
  for (const tok of tokens) {
    const cleaned = tok.replace(/^FR[-_]?/i, '').trim();
    if (!cleaned) continue;
    const match = /^V[-]?([012])$/i.exec(cleaned);
    if (match) {
      return `V${match[1]}`;
    }
    if (/^HB$/i.test(cleaned)) {
      return 'HB';
    }
  }
  return null;
}

// Split on whitespace, dashes, commas, and slashes so `PC-GF20-NAT`,
// `PC/GF20/NAT` and `PC,GF20,NAT` all tokenise identically.
function tokenize(input: string): string[] {
  return input
    .toUpperCase()
    .split(/[\s,/_-]+/)
    .filter(Boolean);
}

function normalizeToken(s: string): string {
  return s.toUpperCase().replace(/[\s,/_-]+/g, '');
}

// Annotations look like `GF33`, `G33`, `MF12` — alpha prefix + digits.
// We treat `GF` and `G` (no F) as glass/mineral fillers (both are
// interchangeable shorthand on broker spec sheets).
type AnnotatedToken = {
  kind: 'glass' | 'mfr';
  pctBand: { min: number; max: number };
} | null;

function classifyGlassOrMfr(token: string): AnnotatedToken {
  const m = /^G(?:F)?(\d+(?:\.\d+)?)$/.exec(token);
  if (m && m[1] !== undefined) {
    const n = Number.parseFloat(m[1]);
    if (!Number.isFinite(n)) return null;
    return {
      kind: 'glass',
      pctBand: { min: Math.max(0, n - 2), max: n + 2 },
    };
  }
  const mf = /^MF(?:I)?(\d+(?:\.\d+)?)$/.exec(token);
  if (mf && mf[1] !== undefined) {
    const n = Number.parseFloat(mf[1]);
    if (!Number.isFinite(n)) return null;
    return {
      kind: 'mfr',
      pctBand: { min: Math.max(0, n - 2), max: n + 2 },
    };
  }
  return null;
}

// Public entry. Returns `null` when no polymer/color/metric token was
// recognised so the search bar degrades to the existing free-text `q`
// behaviour without forcing a parse.
export function parseResinQuery(rawInput: string): ParsedResin | null {
  const input = rawInput.trim();
  if (!input) return null;

  const tokens = tokenize(input);
  if (tokens.length === 0) return null;

  const polymers = new Set<Polymer>();
  let glassMin: number | null = null;
  let glassMax: number | null = null;
  let mfrMin: number | null = null;
  let mfrMax: number | null = null;
  let color: string | null = null;
  const variants: PolymerVariantModifier[] = [];
  const chips: ResinChip[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === undefined) continue;

    if (tok === 'MFI' || tok === 'MF') continue;
    if (tok === 'FR') continue;

    const annotated = classifyGlassOrMfr(tok);
    if (annotated) {
      if (annotated.kind === 'glass') {
        glassMin = annotated.pctBand.min;
        glassMax = annotated.pctBand.max;
      } else {
        mfrMin = annotated.pctBand.min;
        mfrMax = annotated.pctBand.max;
      }
      const center = Math.round((annotated.pctBand.min + annotated.pctBand.max) / 2);
      chips.push({
        label: annotated.kind === 'glass' ? `Glass ${center}%` : `MFR ${center}`,
        tone: annotated.kind,
      });
      continue;
    }

    const polymerCanonical = RESIN_CANONICAL_FOR_ALIAS[normalizeToken(tok)];
    if (polymerCanonical) {
      polymers.add(polymerCanonical);
      chips.push({ label: polymerCanonical, tone: 'polymer' });
      continue;
    }

    if ((POLYMER_VARIANT_MODIFIERS as readonly string[]).includes(tok)) {
      variants.push(tok as PolymerVariantModifier);
      chips.push({ label: tok, tone: 'polymer' });
      continue;
    }

    const colorEntry = COLOR_MAP[tok];
    if (colorEntry && !color) {
      color = colorEntry.label;
      chips.push({ label: color, tone: 'color' });
      continue;
    }

    // Bare integer adjacent to an MFI/MF keyword, in either direction
    // (`MFI 12`, `12 MFI`, `12 MF`). Skip when an MF-prefixed token
    // (classifyGlassOrMfr) has already set mfrMin in the same query, and
    // never consume more than one integer pair.
    if (mfrMin === null && /^\d+(?:\.\d+)?$/.test(tok)) {
      const nextTok = tokens[i + 1];
      const prevTok = tokens[i - 1];
      const nextIsMfi = nextTok === 'MFI' || nextTok === 'MF';
      const prevIsMfi = prevTok === 'MFI' || prevTok === 'MF';
      if (nextIsMfi || prevIsMfi) {
        const n = Number.parseFloat(tok);
        if (Number.isFinite(n)) {
          mfrMin = Math.max(0, n - 2);
          mfrMax = n + 2;
          const center = Math.round((mfrMin + mfrMax) / 2);
          chips.push({ label: `MFR ${center}`, tone: 'mfr' });
        }
      }
    }
  }

  const flameValue = flameFromTokens(tokens);
  if (flameValue) {
    chips.push({ label: `FR ${flameValue}`, tone: 'flame' });
  } else if (tokens.includes('FR')) {
    // User typed FR alone with no V-code — surface a chip so the strip
    // reflects their intent, even though `flame` itself stays unset so the
    // sidebar's free-text flame field isn't accidentally populated.
    chips.push({ label: 'FR', tone: 'flame' });
  }

  const wasMeaningful =
    polymers.size > 0 ||
    glassMin !== null ||
    mfrMin !== null ||
    color !== null ||
    flameValue !== null ||
    variants.length > 0;
  if (!wasMeaningful) return null;

  return {
    polymers: [...polymers],
    glassMin,
    glassMax,
    flame: flameValue,
    color,
    mfrMin,
    mfrMax,
    variants,
    chips,
  };
}

// Merge a parsed query into an existing sidebar-derived `LotFilter`. Policy:
// parsed wins on conflicts because the most recent user intent is the input
// box. Polymers are union'd (de-duplicated); scalars are parsed ?? filter so
// a parsed value wins when present, otherwise the sidebar value is kept.
// Everything else is preserved unchanged.
export function mergeParsedIntoFilter(filter: LotFilterT, parsed: ParsedResin): LotFilterT {
  const polymerSet = new Set<Polymer>(filter.polymers);
  for (const p of parsed.polymers) polymerSet.add(p);
  const polymers = [...polymerSet];
  const glassMin = parsed.glassMin ?? filter.glassMin;
  const glassMax = parsed.glassMax ?? filter.glassMax;
  const flame = parsed.flame ?? filter.flame;
  const color = parsed.color ?? filter.color;
  const mfrMin = parsed.mfrMin ?? filter.mfrMin;
  const mfrMax = parsed.mfrMax ?? filter.mfrMax;

  return LotFilter.parse({
    ...filter,
    polymers,
    glassMin,
    glassMax,
    flame,
    color,
    mfrMin,
    mfrMax,
  });
}
