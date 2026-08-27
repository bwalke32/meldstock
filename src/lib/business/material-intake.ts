import { normalizeResinInput } from '@/lib/business/resin-normalize';
import type { LotCondition } from '@/lib/contracts/lots';
import type {
  MaterialIntakeAnalysis,
  MaterialIntakeEngine,
  MaterialIntakeExtraction,
} from '@/lib/contracts/material-intake';

const MATERIAL_LIMIT = 120;
const DETAILS_LIMIT = 1000;

export function deterministicMaterialExtraction(requestText: string): MaterialIntakeExtraction {
  const source = normalizeSpace(requestText);
  const parsed = normalizeResinInput(source, { mode: 'write', polymerCandidate: 'OTHER' });
  const quantityLb = extractPounds(source);
  const destination = extractDestination(source);
  const neededBy = extractIsoDate(source);
  const equivalency = extractEquivalency(source);

  return {
    material: extractMaterial(source),
    manufacturer: null,
    grade: parsed.gradeCanonical?.slice(0, 80) ?? null,
    polymer: parsed.polymers[0] ?? null,
    condition: extractCondition(source),
    color: parsed.color,
    quantityLb,
    destination,
    country: extractCountry(source, destination),
    neededBy,
    equivalentAllowed: equivalency,
    flameRating: parsed.flame,
    glassFiberPercent: parsed.glass.min === parsed.glass.max ? parsed.glass.min : null,
    meltFlow: extractMeltFlow(source),
    application: extractApplication(source),
    packaging: extractPackaging(source),
    annualUsageLb: extractAnnualUsage(source),
    certifications: extractCertifications(source),
    notes: [],
    cautions: [],
  };
}

export function mergeMaterialExtraction(
  requestText: string,
  ai: MaterialIntakeExtraction,
): MaterialIntakeExtraction {
  const deterministic = deterministicMaterialExtraction(requestText);
  const cautions = [...ai.cautions];

  // A single unambiguous parser hit wins over a conflicting model polymer.
  // The deterministic parser is shared with listing writes and search, so this
  // keeps AI intake aligned with the fields that actually drive matching.
  if (deterministic.polymer && ai.polymer && deterministic.polymer !== ai.polymer) {
    cautions.push(
      `The text parser recognized ${deterministic.polymer}; confirm the polymer family before sending.`,
    );
  }

  return {
    ...ai,
    material: ai.material ?? deterministic.material,
    polymer: deterministic.polymer ?? ai.polymer,
    condition: deterministic.condition ?? ai.condition,
    color: deterministic.color ?? ai.color,
    quantityLb: deterministic.quantityLb ?? ai.quantityLb,
    destination: ai.destination ?? deterministic.destination,
    country: ai.country ?? deterministic.country,
    neededBy: ai.neededBy ?? deterministic.neededBy,
    equivalentAllowed: deterministic.equivalentAllowed ?? ai.equivalentAllowed,
    flameRating: deterministic.flameRating ?? ai.flameRating,
    glassFiberPercent: deterministic.glassFiberPercent ?? ai.glassFiberPercent,
    meltFlow: deterministic.meltFlow ?? ai.meltFlow,
    certifications: dedupe([...deterministic.certifications, ...ai.certifications]),
    cautions: dedupe(cautions).slice(0, 6),
  };
}

export function materialExtractionToAnalysis(
  requestText: string,
  extracted: MaterialIntakeExtraction,
  engine: MaterialIntakeEngine,
): MaterialIntakeAnalysis {
  const material = (extracted.material ?? '').trim().slice(0, MATERIAL_LIMIT);
  const condition = extracted.condition ?? 'OTHER';
  const color = (extracted.color ?? '').trim().slice(0, 80);
  const destination = (extracted.destination ?? '').trim().slice(0, 160);
  const country = (extracted.country ?? '').trim().slice(0, 80);
  const neededBy = extracted.neededBy ?? '';
  const equivalentAllowed = extracted.equivalentAllowed ?? true;
  const recognized: MaterialIntakeAnalysis['recognized'] = [];

  addRecognized(recognized, 'material', 'Material', material, 'high');
  addRecognized(recognized, 'polymer', 'Polymer', extracted.polymer, 'high');
  if (extracted.condition) {
    addRecognized(recognized, 'condition', 'Condition', humanizeEnum(condition), 'medium');
  }
  addRecognized(recognized, 'color', 'Color', color, 'high');
  if (extracted.quantityLb) {
    addRecognized(
      recognized,
      'quantity',
      'Quantity',
      `${formatNumber(extracted.quantityLb)} lb`,
      'high',
    );
  }
  addRecognized(recognized, 'destination', 'Destination', destination, 'medium');
  addRecognized(recognized, 'country', 'Country', country, 'medium');
  addRecognized(recognized, 'neededBy', 'Needed by', neededBy, 'medium');
  if (extracted.equivalentAllowed !== null) {
    addRecognized(
      recognized,
      'equivalency',
      'Equivalents',
      equivalentAllowed ? 'Allowed' : 'Exact grade only',
      'high',
    );
  }
  addRecognized(recognized, 'application', 'Application', extracted.application, 'medium');

  const technical = technicalSummary(extracted);
  addRecognized(recognized, 'technical', 'Technical', technical, 'medium');

  const questions: string[] = [];
  if (!material)
    questions.push('What resin, manufacturer grade, or performance target is required?');
  if (!extracted.quantityLb) questions.push('What approximate quantity is needed?');
  if (!destination) questions.push('Where should the material be delivered?');
  if (!country) questions.push('Which country is the delivery destination in?');
  if (extracted.equivalentAllowed === null) {
    questions.push('Must it be the exact grade, or are qualified equivalents acceptable?');
  }
  if (!extracted.condition)
    questions.push('Must the material be prime, or are other conditions acceptable?');
  if (!extracted.application)
    questions.push('What part or application will the resin be used for?');
  if (!neededBy) questions.push('When is the material required?');

  const details = buildDetails(requestText, extracted);
  const cautions = dedupe([
    ...extracted.cautions,
    ...(engine === 'ai'
      ? ['AI organized the request; the molder must confirm every field before it is sent.']
      : ['AI is not configured, so Meldstock used its local resin parser. Confirm every field.']),
    'Suggested equivalents still require normal technical and regulatory qualification.',
  ]).slice(0, 6);

  return {
    engine,
    draft: {
      material,
      condition,
      color,
      quantityLb: extracted.quantityLb,
      destination,
      country,
      neededBy,
      equivalentAllowed,
      details,
    },
    recognized,
    questions: questions.slice(0, 6),
    cautions,
  };
}

export function buildDeterministicMaterialIntake(requestText: string): MaterialIntakeAnalysis {
  return materialExtractionToAnalysis(
    requestText,
    deterministicMaterialExtraction(requestText),
    'deterministic',
  );
}

function addRecognized(
  items: MaterialIntakeAnalysis['recognized'],
  field: MaterialIntakeAnalysis['recognized'][number]['field'],
  label: string,
  value: string | null | undefined,
  confidence: MaterialIntakeAnalysis['recognized'][number]['confidence'],
) {
  if (!value) return;
  items.push({ field, label, value: value.slice(0, 160), confidence });
}

function buildDetails(source: string, extracted: MaterialIntakeExtraction): string {
  const lines = [
    extracted.manufacturer ? `Manufacturer: ${extracted.manufacturer}` : null,
    extracted.grade ? `Grade: ${extracted.grade}` : null,
    extracted.flameRating ? `Flame rating: ${extracted.flameRating}` : null,
    extracted.glassFiberPercent !== null
      ? `Glass reinforcement: ${formatNumber(extracted.glassFiberPercent)}%`
      : null,
    extracted.meltFlow ? `Melt flow: ${extracted.meltFlow}` : null,
    extracted.application ? `Application: ${extracted.application}` : null,
    extracted.packaging ? `Packaging: ${extracted.packaging}` : null,
    extracted.annualUsageLb ? `Annual usage: ${formatNumber(extracted.annualUsageLb)} lb` : null,
    extracted.certifications.length
      ? `Certifications / compliance: ${extracted.certifications.join(', ')}`
      : null,
    ...extracted.notes.map((note) => `Note: ${note}`),
  ].filter((line): line is string => Boolean(line));

  const prefix = lines.length ? `${lines.join('\n')}\nOriginal request: ` : 'Original request: ';
  return `${prefix}${normalizeSpace(source)}`.slice(0, DETAILS_LIMIT);
}

function technicalSummary(extracted: MaterialIntakeExtraction): string | null {
  const values = [
    extracted.flameRating,
    extracted.glassFiberPercent !== null
      ? `${formatNumber(extracted.glassFiberPercent)}% GF`
      : null,
    extracted.meltFlow,
    ...extracted.certifications,
  ].filter((value): value is string => Boolean(value));
  return values.length ? values.join(' · ') : null;
}

function extractMaterial(source: string): string | null {
  if (!source) return null;
  const withoutLead = source.replace(
    /^(?:need|looking for|requesting|quote(?: needed)? for|source|sourcing)\s+/i,
    '',
  );
  const firstClause = withoutLead.split(
    /(?:\s+delivered\s+to|\s+ship(?:ped)?\s+to|\s+needed\s+by|[.;\n])/i,
  )[0];
  if (!firstClause) return null;
  return (
    firstClause
      .replace(/^\s*[\d,.]+\s*(?:lb|lbs|pounds)\s+(?:of\s+)?/i, '')
      .trim()
      .slice(0, MATERIAL_LIMIT) || null
  );
}

function extractPounds(source: string): number | null {
  const match = source.match(/\b([\d,.]+)\s*(?:lb|lbs|pounds)\b/i);
  if (!match?.[1]) return null;
  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function extractAnnualUsage(source: string): number | null {
  const match = source.match(
    /(?:annual(?:\s+usage)?|per\s+year|yearly)\D{0,16}([\d,.]+)\s*(?:lb|lbs|pounds)\b/i,
  );
  if (!match?.[1]) return null;
  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function extractDestination(source: string): string | null {
  const match = source.match(
    /\b(?:deliver(?:ed)?\s+to|ship(?:ped)?\s+to|destination\s*[:-]?)\s+([^.;\n]{2,160})/i,
  );
  if (!match?.[1]) return null;
  return match[1]
    .replace(/\s+(?:by|within|no later than)\s+.+$/i, '')
    .trim()
    .slice(0, 160);
}

function extractCountry(source: string, destination: string | null): string | null {
  if (/\b(?:USA|U\.S\.A\.|United States)\b/i.test(source)) return 'USA';
  if (/\bCanada\b/i.test(source)) return 'Canada';
  if (/\bMexico\b/i.test(source)) return 'Mexico';
  if (destination && /,\s*[A-Z]{2}(?:\s+\d{5})?$/i.test(destination)) return 'USA';
  return null;
}

function extractIsoDate(source: string): string | null {
  return source.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1] ?? null;
}

function extractEquivalency(source: string): boolean | null {
  if (
    /\b(?:exact\s+grade\s+only|must\s+be\s+exact|no\s+equivalents?|no\s+substitutions?)\b/i.test(
      source,
    )
  ) {
    return false;
  }
  if (
    /\b(?:equivalents?|alternatives?|substitutes?)\s+(?:are\s+)?(?:allowed|acceptable|welcome|ok(?:ay)?)\b/i.test(
      source,
    )
  ) {
    return true;
  }
  return null;
}

function extractCondition(source: string): LotCondition | null {
  const checks: Array<[RegExp, LotCondition]> = [
    [/\b(?:prime|virgin)\b/i, 'PRIME_VIRGIN'],
    [/\b(?:off[- ]?grade|wide[- ]?spec)\b/i, 'OFF_GRADE_WIDE_SPEC'],
    [/\b(?:repro|reprocessed)\b/i, 'REPROCESSED'],
    [/\b(?:regrind|granulat(?:e|ed))\b/i, 'REGRIND_GRANULATED'],
    [/\b(?:post[- ]?industrial|PIR)\b/i, 'POST_INDUSTRIAL'],
    [/\b(?:post[- ]?consumer|PCR)\b/i, 'POST_CONSUMER'],
    [/\b(?:masterbatch|compound)\b/i, 'MASTERBATCH_COMPOUND'],
  ];
  return checks.find(([pattern]) => pattern.test(source))?.[1] ?? null;
}

function extractMeltFlow(source: string): string | null {
  const match = source.match(
    /\b(?:MFI|MFR|melt\s+flow)\s*[:=]?\s*([\d.]+(?:\s*[-–]\s*[\d.]+)?(?:\s*g\/10\s*min)?)\b/i,
  );
  return match?.[1] ? match[0].slice(0, 80) : null;
}

function extractApplication(source: string): string | null {
  const match = source.match(/\b(?:application|used\s+for|molding)\s*[:-]?\s*([^.;\n]{3,180})/i);
  return match?.[1]?.trim().slice(0, 180) ?? null;
}

function extractPackaging(source: string): string | null {
  const match = source.match(/\b(?:gaylords?|boxes|bags?|supersacks?|bulk|railcar|octabins?)\b/i);
  return match?.[0] ?? null;
}

function extractCertifications(source: string): string[] {
  const hits =
    source.match(/\b(?:UL\s*94\s*V[- ]?[012]|FDA|NSF|RoHS|REACH|food[- ]contact)\b/gi) ?? [];
  return dedupe(hits.map((value) => value.toUpperCase())).slice(0, 8);
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function humanizeEnum(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(' ');
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}
