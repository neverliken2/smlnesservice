import { z } from 'zod';

export const ListSalesInvoicesQuerySchema = z.object({
  custCode: z.string().max(50).optional(),
  query: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type ListSalesInvoicesQueryDto = z.infer<
  typeof ListSalesInvoicesQuerySchema
>;

export const FullyUsedStatusBodySchema = z.object({
  docNos: z.array(z.string().max(50)).max(200),
});

export type FullyUsedStatusBodyDto = z.infer<typeof FullyUsedStatusBodySchema>;

/** Response: map ของ doc_no → is_fully_used */
export type FullyUsedStatusResponse = Record<string, boolean>;

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
  /**
   * true = บิลนี้ถูก CN ครบทุก qty แล้ว (qty รวมเหลือ <= 0)
   * คำนวณจาก SUM(qty - CN qty) ของทุก line — mirror logic เดียวกับ available_qty
   * UI ใช้ flag นี้ render แบบเทาๆ ให้รู้ว่าใบนี้ไม่เหลือยอด
   */
  is_fully_used: boolean;
}
