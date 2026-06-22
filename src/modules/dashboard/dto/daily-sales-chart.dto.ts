import { z } from 'zod';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const DailySalesChartQuerySchema = z.object({
  startDate: z.string().regex(ISO_DATE),
  endDate: z.string().regex(ISO_DATE),
  groupBy: z.enum(['daily', 'monthly']).default('daily'),
});
export type DailySalesChartQuery = z.infer<typeof DailySalesChartQuerySchema>;

export interface DailySalesChartPoint {
  /** ISO date 'YYYY-MM-DD' (daily) หรือ 'YYYY-MM-01' (monthly normalized) */
  month: string;
  value: number;
  cost: number;
}

export interface DailySalesChartResponse {
  points: DailySalesChartPoint[];
}
