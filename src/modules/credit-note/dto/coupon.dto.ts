import { z } from 'zod';

export const ListWebCouponsQuerySchema = z.object({
  query: z.string().max(100).optional(),
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'fromDate ต้องเป็น YYYY-MM-DD')
    .optional(),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'toDate ต้องเป็น YYYY-MM-DD')
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export type ListWebCouponsQueryDto = z.infer<typeof ListWebCouponsQuerySchema>;

export interface CouponListItem {
  number: string;
  cust_code: string;
  cust_name: string;
  ref_doc_no: string;
  doc_date: string;
  amount: number;
  balance_amount: number;
  date_expire: string;
  /** 0 = ใช้หลายครั้ง, 1 = ใช้ครั้งเดียว */
  single_use: number;
}
