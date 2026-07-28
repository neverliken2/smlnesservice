import { z } from 'zod';

export const SaveStockAdjustBodySchema = z.object({
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
  location_from: z.string().max(25).default(''),
  remark: z.string().max(255).optional().or(z.literal('')),
  lines: z
    .array(
      z.object({
        item_code: z.string().min(1, 'item_code ว่าง'),
        item_name: z.string().default(''),
        unit_code: z.string().min(1, 'unit_code ว่าง'),
        sum_amount: z.coerce.number(),
        wh_code: z.string().max(25).optional().or(z.literal('')),
        shelf_code: z.string().max(25).optional().or(z.literal('')),
        stand_value: z.coerce.number(),
        divide_value: z.coerce.number(),
      }),
    )
    .min(1, 'lines ว่าง'),
});
export type SaveStockAdjustBody = z.infer<typeof SaveStockAdjustBodySchema>;

export interface SaveStockAdjustResponse {
  doc_no: string;
  total_amount: number;
}

/**
 * Body ของ POST /stock-adjust/reduce — เอกสาร IS (ตัดสต็อกออก, trans_flag=68)
 *
 * ต่างจาก IA: line มี qty + price จริง (ไม่ใช่ value-only)
 *   qty        = จำนวนที่ตัดออก — ต้อง > 0
 *   price      = ทุนเฉลี่ยปัจจุบันของ (item, wh, shelf) — ต้อง ≥ 0
 *   sum_amount = qty × price — ต้อง > 0
 * ทุกค่าเป็นบวก เพราะ calc_flag=−1 ฝั่ง DB จะหักออกให้เอง
 *
 * header ใช้ schema เดียวกับ IA (doc_date/doc_ref/wh_from/...) เลย reuse ผ่าน .extend()
 */
export const SaveStockReduceBodySchema = SaveStockAdjustBodySchema.extend({
  lines: z
    .array(
      z.object({
        item_code: z.string().min(1, 'item_code ว่าง'),
        item_name: z.string().default(''),
        unit_code: z.string().min(1, 'unit_code ว่าง'),
        qty: z.coerce.number().positive('จำนวนที่ตัดต้องมากกว่า 0'),
        price: z.coerce.number().min(0, 'ทุนต่อหน่วยติดลบไม่ได้'),
        sum_amount: z.coerce.number().positive('มูลค่าที่ตัดต้องมากกว่า 0'),
        wh_code: z.string().max(25).optional().or(z.literal('')),
        shelf_code: z.string().max(25).optional().or(z.literal('')),
        stand_value: z.coerce.number(),
        divide_value: z.coerce.number(),
      }),
    )
    .min(1, 'lines ว่าง'),
});
export type SaveStockReduceBody = z.infer<typeof SaveStockReduceBodySchema>;
