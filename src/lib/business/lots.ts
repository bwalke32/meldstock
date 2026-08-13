// @polsia:user-owned — pure helpers for the trading-floor. Imported from
// client islands; no server-only deps.
import type { LotCondition, LotItem, Polymer } from '@/lib/contracts/lots';

export const POLYMER_LABELS: Record<Polymer, string> = {
  ABS: 'ABS',
  PC: 'PC',
  PP: 'PP',
  PE_HDPE: 'HDPE',
  PE_LDPE: 'LDPE',
  PE_LLDPE: 'LLDPE',
  PA6: 'PA6',
  PA66: 'PA66',
  PA612: 'PA612',
  PBT: 'PBT',
  PET: 'PET',
  POM: 'POM',
  PPS: 'PPS',
  TPU: 'TPU',
  TPV: 'TPV',
  TPE: 'TPE',
  HIPS: 'HIPS',
  GPPS: 'GPPS',
  OTHER: 'Other',
};

export const CONDITION_LABELS: Record<LotCondition, string> = {
  PRIME_VIRGIN: 'Prime / Virgin',
  OFF_GRADE_WIDE_SPEC: 'Off-Grade / Wide-Spec',
  REPROCESSED: 'Reprocessed',
  RECYCLED_CONTENT: 'Recycled Content',
  REGRIND_GRANULATED: 'Regrind / Granulated',
  SCRAP: 'Scrap',
  PARTS_SPRUES_RUNNERS: 'Parts / Sprues / Runners',
  PURGE: 'Purge',
  POST_INDUSTRIAL: 'Post-Industrial (PIR)',
  POST_CONSUMER: 'Post-Consumer (PCR)',
  MASTERBATCH_COMPOUND: 'Masterbatch / Compound',
  OTHER: 'Other',
};

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function formatLb(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined || raw === '') {
    return '— lb';
  }
  const value = typeof raw === 'string' ? Number.parseFloat(raw) : raw;
  if (!Number.isFinite(value)) {
    return '— lb';
  }
  return `${NUMBER_FORMATTER.format(value)} lb`;
}

const PRICE_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatPricePerLb(raw: string | number | null | undefined): {
  label: string;
  isPlaceholder: boolean;
} {
  if (raw === null || raw === undefined || raw === '') {
    return { label: 'price on request', isPlaceholder: true };
  }
  const value = typeof raw === 'string' ? Number.parseFloat(raw) : raw;
  if (!Number.isFinite(value) || value === 0) {
    return { label: 'price on request', isPlaceholder: true };
  }
  return { label: `${PRICE_FORMATTER.format(value)} / lb`, isPlaceholder: false };
}

const TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function formatTimestamp(iso: string): string {
  return TIME_FORMATTER.format(new Date(iso));
}

export function isFresh(iso: string, windowMs: number = 15_000): boolean {
  const created = new Date(iso).getTime();
  if (!Number.isFinite(created)) {
    return false;
  }
  return Date.now() - created < windowMs;
}

export function conditionLabel(c: LotCondition): string {
  return CONDITION_LABELS[c] ?? c;
}

export function polymerLabel(p: Polymer): string {
  return POLYMER_LABELS[p] ?? p;
}

// Renders a relative age string for the trade row ("2m", "1h", "3d").
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeAge(iso: string, now: number = Date.now()): string {
  const created = new Date(iso).getTime();
  if (!Number.isFinite(created)) {
    return '';
  }
  const delta = Math.max(0, now - created);
  if (delta < MINUTE) {
    return `${Math.max(1, Math.round(delta / SECOND))}s`;
  }
  if (delta < HOUR) {
    return `${Math.round(delta / MINUTE)}m`;
  }
  if (delta < DAY) {
    return `${Math.round(delta / HOUR)}h`;
  }
  return `${Math.round(delta / DAY)}d`;
}

// Stable short-id used by both the feed and the detail page.
export function shortLotId(lot: Pick<LotItem, 'id'>): string {
  return lot.id.slice(-6).toUpperCase();
}
