import { z } from 'zod';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const ArMovementQuerySchema = z.object({
  dateFrom: z.string().regex(ISO_DATE).optional(),
  dateTo: z.string().regex(ISO_DATE).optional(),
  /** CSV ของ customer codes */
  customerCodes: z.string().max(4000).optional(),
});
export type ArMovementQuery = z.infer<typeof ArMovementQuerySchema>;

export interface ArMovementRow {
  roworder: number;
  doc_sort: number;
  cust_code: string;
  cust_name: string | null;
  doc_type: number;
  doc_date: string;
  doc_no: string;
  tax_doc_no: string | null;
  doc_ref: string | null;
  credit_day: number | null;
  amount: number;
  trans_type_name: string;
}

export interface ArMovementResponse {
  rows: ArMovementRow[];
  count: number;
}
