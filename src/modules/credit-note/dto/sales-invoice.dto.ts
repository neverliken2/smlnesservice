import { z } from 'zod';

export const ListSalesInvoicesQuerySchema = z.object({
  custCode: z.string().max(50).optional(),
  query: z.string().max(100).optional(),
});

export type ListSalesInvoicesQueryDto = z.infer<
  typeof ListSalesInvoicesQuerySchema
>;

export interface SalesInvoiceOption {
  doc_no: string;
  doc_date: string;
  cust_code: string;
  cust_name: string;
  total_amount: number;
  vat_type: number;
  vat_rate: number;
  discount_word: string;
  /** 0=เงินเชื่อ, 1=เงินสด, 2=บริการเครดิต, 3=บริการเงินสด */
  inquiry_type: number;
}
