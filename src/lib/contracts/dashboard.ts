// @polsia:user-owned — shared zod contract for the signed-in dashboard
// overview. Imported by /api/dashboard/overview (server) AND the dashboard
// client island (client) so route + island parse the same shape and client
// drift fails at runtime, not silently in typed UI code.
//
// The canonical `LotItem` (schema + inferred type) lives in
// `@/lib/contracts/lots`. Import it from there directly; this file only
// extends it with the dashboard-specific `metrics` envelope.
import { z } from 'zod';
import { LotItem } from '@/lib/contracts/lots';

export const DashboardMetrics = z.object({
  myHave: z.number().int().nonnegative(),
  myWanted: z.number().int().nonnegative(),
  openRfqCount: z.number().int().nonnegative(),
  // True when the RFQ count was filtered by the caller's profile.materialsBought.
  // False (and openRfqCount reflects total open WANTEDs) when no buyer materials
  // are set. The UI uses this to swap the "matching your interest" copy.
  interestMatched: z.boolean(),
});
export type DashboardMetrics = z.infer<typeof DashboardMetrics>;

export const DashboardOverview = z.object({
  metrics: DashboardMetrics,
  recent: z.array(LotItem),
});
export type DashboardOverview = z.infer<typeof DashboardOverview>;
