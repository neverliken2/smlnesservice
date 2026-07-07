import { z } from 'zod';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const SalesOverviewQuerySchema = z.object({
  startDate: z
    .string()
    .regex(ISO_DATE, 'startDate ต้องเป็น YYYY-MM-DD')
    .optional(),
  endDate: z.string().regex(ISO_DATE, 'endDate ต้องเป็น YYYY-MM-DD').optional(),
  branch: z.string().max(50).optional(),
  warehouse: z.string().max(50).optional(),
});
export type SalesOverviewQuery = z.infer<typeof SalesOverviewQuerySchema>;

export interface SalesOverviewRow {
  type: string;
  isSubTotal: boolean;
  totalSales: number;
  totalCost: number;
  grossProfit: number;
  profitPercent: number;
}

export interface SalesOverviewTotal {
  type: string;
  totalSales: number;
  totalCost: number;
  grossProfit: number;
  profitPercent: number;
}

export interface SalesOverviewResponse {
  rows: SalesOverviewRow[];
  total: SalesOverviewTotal;
  dateRange: { from: string; to: string };
}
