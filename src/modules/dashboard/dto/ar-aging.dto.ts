import { z } from 'zod';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const ArAgingQuerySchema = z.object({
  asOfDate: z.string().regex(ISO_DATE).optional(),
  /** CSV ของ customer codes */
  customerCodes: z.string().max(4000).optional(),
});
export type ArAgingQuery = z.infer<typeof ArAgingQuerySchema>;

export interface ArAgingRow {
  ar_code: string;
  ar_name: string;
  current_amount: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  days_over_90: number;
  total_amount: number;
}

export interface ArAgingResponse {
  rows: ArAgingRow[];
  asOfDate: string;
}
