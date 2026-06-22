import { z } from 'zod';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const PayableOverdueQuerySchema = z.object({
  asOfDate: z.string().regex(ISO_DATE).optional(),
  supplierCodes: z.string().max(4000).optional(),
});
export type PayableOverdueQuery = z.infer<typeof PayableOverdueQuerySchema>;

export interface PayableOverdueRow {
  ap_code: string;
  ap_name: string | null;
  doc_no: string;
  doc_date: string;
  due_date: string | null;
  doc_type: number;
  ref_doc_no: string;
  ref_doc_date: string | null;
  total_amount: number;
  balance_amount: number;
  overdue_days: number;
}

export interface PayableOverdueResponse {
  rows: PayableOverdueRow[];
  asOfDate: string;
}
