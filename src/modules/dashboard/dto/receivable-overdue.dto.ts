import { z } from 'zod';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const ReceivableOverdueQuerySchema = z.object({
  asOfDate: z.string().regex(ISO_DATE).optional(),
  /** CSV ของ customer codes */
  customerCodes: z.string().max(4000).optional(),
});
export type ReceivableOverdueQuery = z.infer<
  typeof ReceivableOverdueQuerySchema
>;

export interface ReceivableOverdueRow {
  ar_code: string;
  ar_name: string | null;
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

export interface ReceivableOverdueResponse {
  rows: ReceivableOverdueRow[];
  asOfDate: string;
}
