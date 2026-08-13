// @polsia:user-owned — shared zod contract for the price-trend sparkline
// strip rendered above the spec sheet on /lots/[id]. Imported by both the
// route handler (`/api/lots/[id]/price-trend`, server) AND the client island
// (`src/components/custom/lot-price-trend`, client). Single source of truth
// so a shape change shows up as a tsc / ZodError, not silent drift in typed UI.
//
// The wire shape is intentionally minimal: a sparse daily series + 30-day
// stats + the source lot's polymer + grade so the client can label the
// cohort without a follow-up lookup. `currentLotPrice` is the same string
// shape `LotItem.askingPricePerLb` carries on the detail wire (Prisma
// Decimal serialised as a string), so the strip's "You are here" marker
// format-lines-up with the spec sheet's asking-price row.
import { z } from 'zod';
import { PolymerEnum } from '@/lib/contracts/lots';

export const PriceTrendPoint = z.object({
  // YYYY-MM-DD bucket key in the SERVER'S local timezone. The plan documents
  // this so the next reader doesn't introduce UTC-vs-local drift later.
  date: z.string(),
  median: z.number().finite(),
  min: z.number().finite(),
  max: z.number().finite(),
  count: z.number().int().nonnegative(),
});
export type PriceTrendPoint = z.infer<typeof PriceTrendPoint>;

export const PriceTrendStats = z.object({
  min: z.number().finite(),
  median: z.number().finite(),
  max: z.number().finite(),
  sampleCount: z.number().int().nonnegative(),
});
export type PriceTrendStats = z.infer<typeof PriceTrendStats>;

export const PriceTrendResponse = z.object({
  series: z.array(PriceTrendPoint),
  windowStart: z.string(),
  windowEnd: z.string(),
  stats: PriceTrendStats,
  currentLotPrice: z.string().nullable(),
  polymer: PolymerEnum,
  grade: z.string().nullable(),
});
export type PriceTrendResponse = z.infer<typeof PriceTrendResponse>;
