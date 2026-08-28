import { normalizeResinInput } from '@/lib/business/resin-normalize';
import type { LotCondition } from '@/lib/contracts/lots';
import type {
  MaterialIntakeAnalysis,
  MaterialIntakeBatchAnalysis,
  MaterialIntakeEngine,
  MaterialIntakeExtraction,
} from '@/lib/contracts/material-intake';

const MATERIAL_LIMIT = 120;
const DETAILS_LIMIT = 1000;

export function deterministicMaterialExtraction(requestText: string): MaterialIntakeExtraction {
  const source = normalizeSpace(requestText);
  const parsed = normalizeResinInput(source, { mode: 'write', polymerCandidate: 'OTHER' });
  const quantityRange = extractPoundRange(source);
  const quantityLb = quantityRange?.min ?? extractPounds(source);
  const destination = extractDestination(source);
  const neededBy = extractIsoDate(source);
  const equivalency = extractEquivalency(source);

  return {
    material: extractMaterial(source),
    manufacturer: null,
    // The shared grade normalizer is intentionally not copied into listing
    // details here: on pasted emails its broad canonical text can absorb a
    // signature or quoted thread. The concise material field remains the
    // deterministic source; configured AI may extract a separately validated
    // grade.
    grade: null,
    polymer: parsed.polymers[0] ?? null,
    condition: extractCondition(source),
    color: extractColorDescriptor(source) ?? parsed.color,
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
    notes: [
      ...(quantityRange?.max
        ? [
            `Requested quantity range: ${formatNumber(quantityRange.min)}-${formatNumber(quantityRange.max)} lb`,
          ]
        : []),
      ...(/\bASAP\b/i.test(source) ? ['Timing requested: ASAP'] : []),
    ],
    cautions: [
      ...(quantityRange?.max
        ? ['The minimum of the stated quantity range is used for matching; confirm the full range.']
        : []),
      ...(/\bFOB\s+point\b/i.test(source)
        ? [
            'Confirm whether the FOB point is the delivery destination or only the freight-pricing point.',
          ]
        : []),
    ],
  };
}

/**
 * Split only on strong request boundaries. Ordinary commas and conjunctions
 * stay untouched because they often describe one blend, grade, or condition.
 */
export function splitMaterialRequests(requestText: string): string[] {
  const normalized = stripQuotedEmailTail(requestText.replace(/\r\n?/g, '\n')).trim();
  if (!normalized) return [];
  const boundary = '\u001f';

  const marked = normalized
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
    .replace(/\n\s*(?:[-*•]|\d+[.)])\s+/g, boundary)
    .replace(
      /(?:[.!?;]\s+|\n+)(?=(?:also\s+)?(?:need|looking\s+for|requesting|seeking|source|sourcing)\b)/gi,
      boundary,
    )
    .replace(
      /\s+(?=(?:also|additionally)\s+(?:need|looking\s+for|requesting|seeking|sourcing)\b)/gi,
      boundary,
    )
    .replace(/\n+/g, ' ');

  const candidates = marked
    .split(boundary)
    .map((item) =>
      normalizeSpace(item)
        .replace(/^(?:also|additionally)\s+/i, '')
        .trim(),
    )
    .filter((item) => item.length >= 8);
  const likelyRequests = candidates.filter(looksLikeMaterialRequest);
  const items = likelyRequests.length ? likelyRequests : candidates;

  return (items.length ? items : [normalizeSpace(normalized)]).slice(0, 8);
}

function looksLikeMaterialRequest(value: string): boolean {
  const parsed = normalizeResinInput(value, { mode: 'write', polymerCandidate: 'OTHER' });
  if (parsed.polymers.length > 0) return true;
  return (
    /\b(?:need|looking\s+for|requesting|seeking|source|sourcing|quote(?:\s+needed)?\s+for)\b/i.test(
      value,
    ) && /\b(?:resin|material|grade|regrind|repro|prime|virgin|pellets?|scrap)\b/i.test(value)
  );
}

export function mergeMaterialExtraction(
  requestText: string,
  ai: MaterialIntakeExtraction,
): MaterialIntakeExtraction {
  const deterministic = deterministicMaterialExtraction(requestText);
  const cautions = [...deterministic.cautions, ...ai.cautions];

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
    notes: dedupe([...deterministic.notes, ...ai.notes]).slice(0, 8),
    cautions: dedupe(cautions).slice(0, 6),
  };
}

export function materialExtractionToAnalysis(
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
  const quantityRangeNote = extracted.notes.find((note) =>
    note.startsWith('Requested quantity range:'),
  );
  if (quantityRangeNote) {
    addRecognized(
      recognized,
      'quantity',
      'Quantity',
      quantityRangeNote.replace('Requested quantity range:', '').trim(),
      'high',
    );
  } else if (extracted.quantityLb) {
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
  const timingAsap = extracted.notes.includes('Timing requested: ASAP');
  addRecognized(
    recognized,
    'neededBy',
    'Needed by',
    neededBy || (timingAsap ? 'ASAP' : ''),
    'medium',
  );
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
  if (!neededBy) {
    questions.push(
      timingAsap
        ? 'What calendar date should “ASAP” mean for this request?'
        : 'When is the material required?',
    );
  }

  const details = buildDetails(extracted);
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
    deterministicMaterialExtraction(requestText),
    'deterministic',
  );
}

export function buildDeterministicMaterialIntakeBatch(
  requestText: string,
): MaterialIntakeBatchAnalysis {
  return {
    engine: 'deterministic',
    items: splitMaterialRequests(requestText).map(buildDeterministicMaterialIntake),
  };
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

function buildDetails(extracted: MaterialIntakeExtraction): string {
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

  // Raw pasted email text stays in the browser draft and analysis request. It
  // is not copied into a public-facing listing where signatures, names, phone
  // numbers, or quoted email history could expose the requester or customer.
  return lines.map(redactContactDetails).join('\n').slice(0, DETAILS_LIMIT);
}

function stripQuotedEmailTail(source: string): string {
  return (
    source.split(
      /\n\s*(?:thanks(?:,|\s|$)|best(?:\s+regards)?,?|regards,?|sincerely,?|sent\s+from\s+my\b|on\s+.+\s+wrote:|from:\s+.+)/i,
    )[0] ?? source
  );
}

function redactContactDetails(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email removed]')
    .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, '[phone removed]');
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
  const withoutQuantity = withoutLead.replace(
    /^\s*~?[\d,.]+(?:\s*[-–]\s*[\d,.]+)?\s*k?\s*\/?\s*(?:lbs?|pounds)\.?\s*(?:of\s+)?/i,
    '',
  );
  const firstClause = withoutQuantity.split(
    /(?:\s+delivered\s+to|\s+ship(?:ped)?\s+to|\s+needed\s+by|\s+ASAP\b|\s+FOB\s+(?:point\s+)?(?:is\s+)?|[.;\n])/i,
  )[0];
  if (!firstClause) return null;
  return (
    firstClause
      .replace(
        /^(?:prime|virgin|off[- ]?grade|wide[- ]?spec|repro(?:cessed)?|regrind|granulat(?:e|ed))\s*,?\s*/i,
        '',
      )
      .trim()
      .slice(0, MATERIAL_LIMIT) || null
  );
}

function extractPounds(source: string): number | null {
  const match = source.match(/(?:^|\b)([\d,.]+)\s*(k)?\s*\/?\s*(?:lb|lbs|pounds)\b/i);
  if (!match?.[1]) return null;
  const value = Number(match[1].replace(/,/g, '')) * (match[2] ? 1000 : 1);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function extractPoundRange(source: string): { min: number; max: number | null } | null {
  const range = source.match(
    /(?:^|\b)~?\s*([\d,.]+)\s*(k)?\s*[-–]\s*([\d,.]+)\s*(k)?\s*\/?\s*(?:lb|lbs|pounds)\b/i,
  );
  if (!range?.[1] || !range[3]) return null;
  const usesThousands = Boolean(range[2] || range[4]);
  const left = Number(range[1].replace(/,/g, '')) * (usesThousands ? 1000 : 1);
  const right = Number(range[3].replace(/,/g, '')) * (usesThousands ? 1000 : 1);
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) return null;
  return { min: Math.min(left, right), max: Math.max(left, right) };
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
    /\b(?:deliver(?:ed)?\s+to|ship(?:ped)?\s+to|destination\s*[:-]?|FOB\s+point(?:\s+is)?)\s+([^.;\n]{2,160})/i,
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
  if (
    destination &&
    /,\s*(?:Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)$/i.test(
      destination,
    )
  )
    return 'USA';
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

function extractColorDescriptor(source: string): string | null {
  const tintedClear = source.match(
    /\b((?:blue|green|gray|grey|amber|smoke|red)[ -]?tint(?:ed)?\s+clear)\b/i,
  )?.[1];
  if (tintedClear) {
    const tintColor = tintedClear.match(/^\w+/)?.[0] ?? '';
    return `${tintColor[0]?.toUpperCase() ?? ''}${tintColor.slice(1).toLowerCase()}-Tint Clear`;
  }
  return null;
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
