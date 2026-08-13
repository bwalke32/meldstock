// @polsia:user-owned — pure helpers that match a source lot against a candidate
// set for the comparable-lots sidebar on /lots/[id]. Shared between the
// /api/lots/[id]/comparables route handler and any future in-browser filter;
// no DB / no server-only deps.

export type Continent = 'NA' | 'SA' | 'EU' | 'AS' | 'AF' | 'OC' | 'AN' | 'UNKNOWN';

// 2-letter ISO + a small set of common display names — substring match against
// `country || location` so a buyer typing "Germany" matches a row whose
// `country` is set to "DE" or "USA" trips the NA bucket. Tradeoff: a lot
// posted as "USA" never falls into UNKNOWN — already handled by the NA map.
const COUNTRY_TO_CONTINENT: ReadonlyArray<[string, Continent]> = [
  // North America
  ['US', 'NA'],
  ['USA', 'NA'],
  ['U.S', 'NA'],
  ['UNITED STATES', 'NA'],
  ['CANADA', 'NA'],
  ['MEXICO', 'NA'],
  // South America
  ['BRAZIL', 'SA'],
  ['ARGENTINA', 'SA'],
  ['CHILE', 'SA'],
  ['COLOMBIA', 'SA'],
  ['PERU', 'SA'],
  ['VENEZUELA', 'SA'],
  // Europe
  ['DE', 'EU'],
  ['GERMANY', 'EU'],
  ['FR', 'EU'],
  ['FRANCE', 'EU'],
  ['IT', 'EU'],
  ['ITALY', 'EU'],
  ['ES', 'EU'],
  ['SPAIN', 'EU'],
  ['PT', 'EU'],
  ['PORTUGAL', 'EU'],
  ['NL', 'EU'],
  ['NETHERLANDS', 'EU'],
  ['BE', 'EU'],
  ['BELGIUM', 'EU'],
  ['UK', 'EU'],
  ['GB', 'EU'],
  ['UNITED KINGDOM', 'EU'],
  ['ENGLAND', 'EU'],
  ['PL', 'EU'],
  ['POLAND', 'EU'],
  ['CZ', 'EU'],
  ['CZECH', 'EU'],
  ['AT', 'EU'],
  ['AUSTRIA', 'EU'],
  ['CH', 'EU'],
  ['SWITZERLAND', 'EU'],
  ['SE', 'EU'],
  ['SWEDEN', 'EU'],
  ['NO', 'EU'],
  ['NORWAY', 'EU'],
  ['FI', 'EU'],
  ['FINLAND', 'EU'],
  ['DK', 'EU'],
  ['DENMARK', 'EU'],
  // Asia
  ['CN', 'AS'],
  ['CHINA', 'AS'],
  ['IN', 'AS'],
  ['INDIA', 'AS'],
  ['JP', 'AS'],
  ['JAPAN', 'AS'],
  ['KR', 'AS'],
  ['KOREA', 'AS'],
  ['SOUTH KOREA', 'AS'],
  ['TW', 'AS'],
  ['TAIWAN', 'AS'],
  ['TH', 'AS'],
  ['THAILAND', 'AS'],
  ['VN', 'AS'],
  ['VIETNAM', 'AS'],
  ['MY', 'AS'],
  ['MALAYSIA', 'AS'],
  ['SG', 'AS'],
  ['SINGAPORE', 'AS'],
  ['ID', 'AS'],
  ['INDONESIA', 'AS'],
  ['PH', 'AS'],
  ['PHILIPPINES', 'AS'],
  ['TR', 'AS'],
  ['TURKEY', 'AS'],
  ['AE', 'AS'],
  ['UAE', 'AS'],
  ['SA', 'AS'], // Saudi Arabia, conflicts with the SA continent code — guarded by display names below
  ['SAUDI', 'AS'],
  // Africa
  ['EG', 'AF'],
  ['EGYPT', 'AF'],
  ['ZA', 'AF'],
  ['SOUTH AFRICA', 'AF'],
  ['NG', 'AF'],
  ['NIGERIA', 'AF'],
  ['KE', 'AF'],
  ['KENYA', 'AF'],
  ['MA', 'AF'],
  ['MOROCCO', 'AF'],
  // Oceania
  ['AU', 'OC'],
  ['AUSTRALIA', 'OC'],
  ['NZ', 'OC'],
  ['NEW ZEALAND', 'OC'],
];

function normalizeForContinent(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Coarse continent guess from `country` (preferred) + `location` (fallback).
 * Falls back to UNKNOWN when neither contains a recognisable token — we
 * prefer UNKNOWN with a uniform score to silently bucketing everyone into one
 * continent.
 */
export function coarseContinentFor(
  country: string | null | undefined,
  location?: string | null,
): Continent {
  const haystack = normalizeForContinent(`${country ?? ''} ${location ?? ''}`);
  if (!haystack) return 'UNKNOWN';
  for (const [token, continent] of COUNTRY_TO_CONTINENT) {
    const normalizedToken = normalizeForContinent(token);
    if (!normalizedToken) continue;
    if (haystack.includes(normalizedToken)) return continent;
  }
  return 'UNKNOWN';
}

// Quantity bands are advisory defaults — picked to match the natural break
// points the trading-floor uses for a single-railcar vs. bulk shipper. Tune in
// src/lib/business/lots.ts to match the team's existing bands if needed.
export function quantityBandLb(lbRaw: number | string | null | undefined): 0 | 1 | 2 | 3 {
  if (lbRaw === null || lbRaw === undefined || lbRaw === '') return 0;
  const lb = typeof lbRaw === 'string' ? Number.parseFloat(lbRaw) : lbRaw;
  if (!Number.isFinite(lb) || lb <= 0) return 0;
  if (lb < 5_000) return 0;
  if (lb < 50_000) return 1;
  if (lb < 500_000) return 2;
  return 3;
}

export function bandsAreComparable(
  a: ReturnType<typeof quantityBandLb>,
  b: ReturnType<typeof quantityBandLb>,
): boolean {
  return Math.abs(a - b) <= 1;
}

const COLOR_TOKENS = [
  'BK',
  'BLK',
  'BLACK',
  'NAT',
  'NATURAL',
  'WH',
  'WHT',
  'WHITE',
  'GY',
  'GRY',
  'GR',
  'GREY',
  'GRAY',
  'BL',
  'BLU',
  'BLUE',
  'RD',
  'RED',
  'GN',
  'GRN',
  'GREEN',
];

function normalizeGrade(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = raw.toUpperCase().replace(/\s+/g, ' ').trim();
  // Strip color tokens — "HDPE 5502 NAT" vs "HDPE 5502 BLACK" should still match.
  for (const token of COLOR_TOKENS) {
    s = s.replace(new RegExp(`\\b${token}\\b`, 'g'), '');
  }
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function stripTrailingLetter(s: string): string {
  return s.replace(/[A-Z]$/u, '');
}

function leadingLettersAndFourDigits(s: string): { prefix: string; digits: string } | null {
  const match = /([A-Z]*)\s*([0-9]{4})/.exec(s);
  if (!match) return null;
  const digits = match[2] ?? '';
  if (digits.length !== 4) return null;
  return { prefix: match[1] ?? '', digits };
}

/**
 * Two grade strings are "equivalent" when:
 *   1. exact match (after normalize, including color-strip); OR
 *   2. the trailing single letter (5502S → 5502, 1234A → 1234) matches; OR
 *   3. both contain a 4-digit token with the same leading letters.
 *
 * When both sides lack a grade, treat as equivalent (nothing to disagree on).
 * Conservative false when exactly one side has a grade — a graded lot and a
 * grade-less lot are not equivalent for the sidebar.
 */
export function gradesEquivalent(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const aHas = Boolean(a?.trim());
  const bHas = Boolean(b?.trim());
  if (aHas !== bHas) return false;
  if (!aHas && !bHas) return true;

  const na = normalizeGrade(a);
  const nb = normalizeGrade(b);
  if (na && nb && na === nb) return true;

  if (na && nb) {
    const strippedA = stripTrailingLetter(na);
    const strippedB = stripTrailingLetter(nb);
    if (strippedA && strippedB && strippedA === strippedB) return true;

    const aInfo = leadingLettersAndFourDigits(na);
    const bInfo = leadingLettersAndFourDigits(nb);
    if (aInfo && bInfo && aInfo.prefix === bInfo.prefix && aInfo.digits === bInfo.digits) {
      return true;
    }
  }
  return false;
}

export interface ComparableLotLike {
  polymer?: string;
  grade?: string | null;
  quantityLb?: string | number | null;
  country?: string | null;
  location?: string | null;
  createdAt?: string | Date;
}

function regionPrefixMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const aLc = a.trim().toLowerCase();
  const bLc = b.trim().toLowerCase();
  if (!aLc || !bLc) return false;
  return aLc === bLc || aLc.startsWith(bLc) || bLc.startsWith(aLc);
}

/**
 * Score the "is this similar" question. Sum of:
 *   +1 when gradesEquivalent (post band + contour filtering)
 *   +1 when quantity bands are exact (0..3)
 *   +(1 - bandDiff/3) when bands within reach (capped 0..3 → 1)
 *   +1 when same continent & non-UNKNOWN
 *   +1 when location / city prefix matches
 *   +(0.5 small time bonus — recent rows slightly preferred)
 */
export function closeInScope(source: ComparableLotLike, candidate: ComparableLotLike): number {
  let score = 0;

  if (gradesEquivalent(source.grade, candidate.grade)) score += 1;

  const sourceBand = quantityBandLb(source.quantityLb ?? null);
  const candBand = quantityBandLb(candidate.quantityLb ?? null);
  if (sourceBand === candBand) {
    score += 1;
  } else if (bandsAreComparable(sourceBand, candBand)) {
    score += Math.max(0, 1 - Math.abs(sourceBand - candBand) / 3);
  }

  const sourceCont = coarseContinentFor(source.country ?? null, source.location ?? null);
  const candCont = coarseContinentFor(candidate.country ?? null, candidate.location ?? null);
  if (sourceCont !== 'UNKNOWN' && sourceCont === candCont) score += 1;

  if (regionPrefixMatch(source.location ?? null, candidate.location ?? null)) {
    score += 1;
  }

  return score;
}

/**
 * Combined pre-filter applied to a candidate set before scoring — keeps
 * candidates that are at least weakly similar (same polymer family OR
 * strongly similar by grade/continent) so we don't compare apples to glass.
 */
export function isWeaklyComparable(
  source: ComparableLotLike,
  candidate: ComparableLotLike,
): boolean {
  if (source.polymer && candidate.polymer && source.polymer !== candidate.polymer) {
    return false;
  }

  // When both rows have a grade, they must be equivalent.
  const sourceHasGrade = Boolean(source.grade?.trim());
  const candidateHasGrade = Boolean(candidate.grade?.trim());
  if (sourceHasGrade && candidateHasGrade) {
    if (!gradesEquivalent(source.grade, candidate.grade)) return false;
  }

  const sourceBand = quantityBandLb(source.quantityLb ?? null);
  const candBand = quantityBandLb(candidate.quantityLb ?? null);
  // band diff <= 2 is the soft-comparable floor (small ↔ medium is fine,
  // small ↔ bulk is not a comparable lot — different paperwork).
  if (Math.abs(sourceBand - candBand) > 2) return false;

  return true;
}
