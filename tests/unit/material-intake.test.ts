import { describe, expect, it } from 'vitest';
import {
  buildDeterministicMaterialIntake,
  deterministicMaterialExtraction,
  mergeMaterialExtraction,
} from '@/lib/business/material-intake';
import type { MaterialIntakeExtraction } from '@/lib/contracts/material-intake';

const EMPTY_EXTRACTION: MaterialIntakeExtraction = {
  material: null,
  manufacturer: null,
  grade: null,
  polymer: null,
  condition: null,
  color: null,
  quantityLb: null,
  destination: null,
  country: null,
  neededBy: null,
  equivalentAllowed: null,
  flameRating: null,
  glassFiberPercent: null,
  meltFlow: null,
  application: null,
  packaging: null,
  annualUsageLb: null,
  certifications: [],
  notes: [],
  cautions: [],
};

describe('material intake normalization', () => {
  it('extracts explicit resin and commercial facts without a provider call', () => {
    const result = deterministicMaterialExtraction(
      'Need 5,000 lbs of PC ABS GF30 black prime. Equivalents acceptable. Deliver to Chicago, IL by 2026-09-30. Application: electrical enclosure. UL94 V-0 required.',
    );

    expect(result.polymer).toBe('PC');
    expect(result.condition).toBe('PRIME_VIRGIN');
    expect(result.color).toBe('Black');
    expect(result.quantityLb).toBe(5_000);
    expect(result.destination).toBe('Chicago, IL');
    expect(result.country).toBe('USA');
    expect(result.neededBy).toBe('2026-09-30');
    expect(result.equivalentAllowed).toBe(true);
    expect(result.application).toBe('electrical enclosure');
    expect(result.certifications).toContain('UL94 V-0');
  });

  it('keeps missing facts visible instead of guessing them', () => {
    const analysis = buildDeterministicMaterialIntake('Looking for black PA66 GF33 material');

    expect(analysis.engine).toBe('deterministic');
    expect(analysis.draft.quantityLb).toBeNull();
    expect(analysis.draft.destination).toBe('');
    expect(analysis.draft.condition).toBe('OTHER');
    expect(analysis.questions).toContain('What approximate quantity is needed?');
    expect(analysis.questions).toContain('Where should the material be delivered?');
    expect(analysis.cautions.join(' ')).toContain('Confirm every field');
  });

  it('lets shared deterministic resin normalization override a conflicting AI polymer', () => {
    const merged = mergeMaterialExtraction('Need PA66 GF33 black, 2,204 lbs', {
      ...EMPTY_EXTRACTION,
      material: 'PA66 GF33 black',
      polymer: 'PP',
      quantityLb: 2_204,
    });

    expect(merged.polymer).toBe('PA66');
    expect(merged.cautions.join(' ')).toContain('recognized PA66');
  });

  it('recognizes exact-grade-only language', () => {
    const result = deterministicMaterialExtraction(
      'Need 1,102 lbs of CELCON M90 natural. Exact grade only; no substitutions.',
    );
    expect(result.equivalentAllowed).toBe(false);
  });
});
