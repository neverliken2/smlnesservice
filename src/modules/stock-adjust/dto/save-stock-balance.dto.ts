import { z } from 'zod';

/**
 * Save RMB (สินค้า/วัตถุดิบ คงเหลือยกมา, trans_flag=54)
 * ต่างจาก IA: line มี qty + price (ต้นทุน/หน่วย) — sum_amount คำนวณฝั่ง server = qty × price
 * wh/shelf ระบุรายบรรทัดได้ (fallback = header wh_from/location_from)
 * FE group บรรทัดเป็น 1 ใบต่อ (wh,shelf) แล้วเรียก endpoint นี้ทีละใบ — เหมือน bulk IA
 */
export const SaveStockBalanceBodySchema = z.object({
  doc_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'doc_date ต้องเป็น YYYY-MM-DD'),
  doc_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'doc_time ต้องเป็น HH:mm')
    .optional()
    .or(z.literal('')),
  doc_ref: z.string().max(255).optional().or(z.literal('')),
  doc_ref_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'doc_ref_date ต้องเป็น YYYY-MM-DD')
    .optional()
    .or(z.literal('')),
  wh_from: z.string().min(1, 'wh_from ว่าง').max(25),
  location_from: z.string().min(1, 'location_from ว่าง').max(25),
  remark: z.string().max(255).optional().or(z.literal('')),
  lines: z
    .array(
      z.object({
        item_code: z.string().min(1, 'item_code ว่าง'),
        item_name: z.string().default(''),
        unit_code: z.string().min(1, 'unit_code ว่าง'),
        qty: z.coerce.number(),
        price: z.coerce.number(),
        wh_code: z.string().max(25).optional().or(z.literal('')),
        shelf_code: z.string().max(25).optional().or(z.literal('')),
        stand_value: z.coerce.number(),
        divide_value: z.coerce.number(),
      }),
    )
    .min(1, 'lines ว่าง')
    .max(1000, 'เกินขีดจำกัด 1,000 บรรทัด'),
});
export type SaveStockBalanceBody = z.infer<typeof SaveStockBalanceBodySchema>;

export interface SaveStockBalanceResponse {
  doc_no: string;
  total_amount: number;
}
