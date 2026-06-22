import { z } from 'zod';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const ReorderPointQuerySchema = z.object({
  fromDate: z.string().regex(ISO_DATE).optional(),
  toDate: z.string().regex(ISO_DATE).optional(),
  icCodeList: z.string().max(2000).optional(),
  icCodeRanges: z.string().max(2000).optional(),
});
export type ReorderPointQuery = z.infer<typeof ReorderPointQuerySchema>;

export interface ReorderPointRow {
  ic_code: string;
  ic_name: string;
  ic_unit_code: string;
  balance_qty: number;
  purchase_point: number;
  minimum_qty: number;
  maximum_qty: number;
  last_purchase_date: string | null;
  average_cost_end: number;
  last_purchase_qty: number;
  purchase_amount: number;
  sale_amount: number;
  forecast_purchase: number;
}

export interface ReorderPointResponse {
  rows: ReorderPointRow[];
  count: number;
}
