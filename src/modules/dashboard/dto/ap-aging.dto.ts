import { z } from 'zod';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const ApAgingQuerySchema = z.object({
  asOfDate: z.string().regex(ISO_DATE).optional(),
  supplierCodes: z.string().max(4000).optional(),
});
export type ApAgingQuery = z.infer<typeof ApAgingQuerySchema>;

export interface ApAgingRow {
  ap_code: string;
  ap_name: string;
  current_amount: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  days_over_90: number;
  total_amount: number;
}

export interface ApAgingResponse {
  rows: ApAgingRow[];
  asOfDate: string;
}
