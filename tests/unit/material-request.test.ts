import { describe, expect, it } from 'vitest';
import { materialRequestToLot } from '@/lib/business/material-request';

describe('materialRequestToLot', () => {
  it('creates a private WANTED request without trusting client identity', () => {
    const lot = materialRequestToLot({
      material: 'SABIC CYCOLOY C6600 Black',
      condition: 'PRIME_VIRGIN',
      quantityLb: 5_000,
      destination: 'Chicago, IL',
      country: 'USA',
      neededBy: '2026-09-05',
      equivalentAllowed: true,
      details: 'UL94 V-0 required.',
    });

    expect(lot).toMatchObject({
      type: 'WANTED',
      visibility: 'ANONYMOUS',
      quantityLb: 5_000,
      location: 'Chicago, IL',
      country: 'USA',
    });
    expect(lot).not.toHaveProperty('postedByUserId');
    expect(lot.notes).toContain('Requested material: SABIC CYCOLOY C6600 Black');
    expect(lot.notes).toContain('Equivalent grade allowed: Yes');
  });

  it('preserves a blend request losslessly in notes while using a searchable polymer bucket', () => {
    const lot = materialRequestToLot({
      material: 'PC/ABS FR black, exact grade or equivalent',
      condition: 'PRIME_VIRGIN',
      quantityLb: 2_500,
      destination: 'Monterrey, NL',
      country: 'Mexico',
      equivalentAllowed: true,
    });

    expect(['PC', 'ABS', 'OTHER']).toContain(lot.polymer);
    expect(lot.notes).toContain('Requested material: PC/ABS FR black, exact grade or equivalent');
  });
});
