import { z } from 'zod';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const StockBalanceQuerySchema = z.object({
  fromDate: z.string().regex(ISO_DATE).optional(),
  toDate: z.string().regex(ISO_DATE).optional(),
  /** comma-separated item codes */
  icCodeList: z.string().max(2000).optional(),
  /** "from1:to1,from2:to2" — alphabetic range */
  icCodeRanges: z.string().max(2000).optional(),
  mainGroup: z.string().max(50).optional(),
  subGroup: z.string().max(50).optional(),
});
export type StockBalanceQuery = z.infer<typeof StockBalanceQuerySchema>;

export interface StockBalanceRow {
  ic_code: string;
  ic_name: string;
  ic_unit_code: string;
  qty_in: number;
  amount_in: number;
  avg_cost_in: number;
  qty_out: number;
  amount_out: number;
  avg_cost_out: number;
  balance_qty: number;
  current_avg_cost: number;
  avg_cost: number;
  balance_amount: number;
}

export interface StockBalanceResponse {
  rows: StockBalanceRow[];
  count: number;
}
