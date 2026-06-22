import { z } from 'zod';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const StockMovementQuerySchema = z.object({
  productCode: z.string().min(1).max(50),
  fromDate: z.string().regex(ISO_DATE).optional(),
  toDate: z.string().regex(ISO_DATE).optional(),
});
export type StockMovementQuery = z.infer<typeof StockMovementQuerySchema>;

export interface StockMovementRow {
  doc_date: string;
  doc_time: string;
  trans_type: string;
  doc_no: string;
  warehouse: string;
  shelf_code: string;
  unit_code: string;
  qty_in: number;
  avg_cost_in: number;
  amount_in: number;
  qty_out: number;
  avg_cost_out: number;
  amount_out: number;
  running_balance: number;
  running_amount: number;
}

export interface StockMovementResponse {
  rows: StockMovementRow[];
  count: number;
}
