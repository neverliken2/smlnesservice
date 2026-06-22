import { z } from 'zod';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const ApMovementQuerySchema = z.object({
  dateFrom: z.string().regex(ISO_DATE).optional(),
  dateTo: z.string().regex(ISO_DATE).optional(),
  /** CSV ของ supplier codes */
  supplierCodes: z.string().max(4000).optional(),
});
export type ApMovementQuery = z.infer<typeof ApMovementQuerySchema>;

export interface ApMovementRow {
  roworder: number;
  doc_sort: number;
  vend_code: string;
  vend_name: string | null;
  doc_type: number;
  doc_date: string;
  doc_no: string;
  tax_doc_no: string | null;
  doc_ref: string | null;
  credit_day: number | null;
  amount: number;
  trans_type_name: string;
}

export interface ApMovementResponse {
  rows: ApMovementRow[];
  count: number;
}
