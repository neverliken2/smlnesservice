import { z } from 'zod';

export const GetPurchaseHistoryQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});
export type GetPurchaseHistoryQuery = z.infer<
  typeof GetPurchaseHistoryQuerySchema
>;

export interface PurchaseHistoryRow {
  doc_no: string;
  doc_date: string; // ISO 'YYYY-MM-DD' จาก TO_CHAR
  vendor_code: string;
  vendor_name: string;
  qty: number;
  price: number;
  unit_code: string;
  vat_type: number; // 1=รวมใน, 2=แยกนอก, อื่น=ไม่มี
}

export interface GetPurchaseHistoryResponse {
  rows: PurchaseHistoryRow[];
  has_more: boolean;
}
