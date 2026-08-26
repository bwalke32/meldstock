// @polsia:user-owned — pure adapter from the focused molder request form to
// the existing authenticated WANTED-lot contract. This lets the product pivot
// ship without a risky database migration while preserving every word of the
// material request in the notes field for blends and specialty families that
// are not first-class Prisma enum values yet.

import { normalizeResinInput } from '@/lib/business/resin-normalize';
import type { CreateLot, LotCondition, Polymer } from '@/lib/contracts/lots';

export interface MaterialRequestDraft {
  material: string;
  condition: LotCondition;
  color?: string;
  quantityLb: number;
  destination: string;
  country: string;
  neededBy?: string;
  equivalentAllowed: boolean;
  targetPricePerLb?: number;
  details?: string;
}

/**
 * Map the simplified sourcing brief onto the accepted marketplace schema.
 * WANTED + ANONYMOUS are deliberate: the route still derives ownership from
 * the authenticated session, while public readers never receive molder identity.
 */
export function materialRequestToLot(input: MaterialRequestDraft): CreateLot {
  const material = input.material.trim();
  const normalized = normalizeResinInput(material, {
    mode: 'write',
    polymerCandidate: 'OTHER',
  });
  const polymer: Polymer = normalized.polymers[0] ?? 'OTHER';
  const color = input.color?.trim() || normalized.color || 'Any';

  const notes = [
    `Requested material: ${material}`,
    `Equivalent grade allowed: ${input.equivalentAllowed ? 'Yes' : 'No'}`,
    input.neededBy ? `Needed by: ${input.neededBy}` : null,
    input.details?.trim() ? `Additional requirements: ${input.details.trim()}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');

  return {
    type: 'WANTED',
    polymer,
    condition: input.condition,
    color,
    form: 'Pellets',
    manufacturer: null,
    // Keep the user's exact request on the write seam. The API's existing
    // normalizer may extract canonical tokens, so notes above remain the
    // lossless source until the documented material-schema migration lands.
    grade: material,
    quantityLb: input.quantityLb,
    packaging: 'Flexible',
    location: input.destination.trim(),
    country: input.country.trim(),
    askingPricePerLb: input.targetPricePerLb ?? null,
    hasCoa: false,
    notes,
    visibility: 'ANONYMOUS',
    selectedCompanyIdentifiers: null,
  };
}
