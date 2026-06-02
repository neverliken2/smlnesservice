import { z } from 'zod';

/**
 * Payload สำหรับ POST /credit-notes — มาจาก UI (web NextStep CN Coupon)
 *
 * Policy (mirror NextStep):
 *   - ไม่ recompute ยอดใน server — ใช้ค่าจากใบขายต้นทางตรงๆ
 *   - ถ้า qty ส่งคืน < qty ขาย → pro-rata: field_cn = field_source × (qty_cn / qty_source)
 *   - Header total: รวมเฉพาะ row ที่ set_ref_line='' (ไม่นับ sub-item ของชุด)
 *   - Mirror discount_word จาก source → ส่วนลดท้ายบิลทำงานถูก
 */

// แต่ละบรรทัด — backend จะ pro-rata เอง (qty_cn + price จาก user; field อื่นใช้สำหรับ verify)
export const CreditNoteLineSchema = z.object({
  line_number: z.number().int().min(0),
  item_code: z.string().max(50),
  item_name: z.string().max(200).optional().default(''),
  unit_code: z.string().max(50).optional().default(''),
  qty: z.number(),
  available_qty: z.number().optional(),
  price: z.number().min(0),
  discount: z.string().optional().default(''),
  discount_amount: z.number().optional().default(0),
  sum_amount: z.number().optional().default(0),
  sum_amount_exclude_vat: z.number().optional().default(0),
  total_vat_value: z.number().optional().default(0),
  wh_code: z.string().max(50).optional().default(''),
  shelf_code: z.string().max(50).optional().default(''),
  vat_type: z.number().int().optional().default(0),
  item_type: z.number().int().optional().default(0),
  set_ref_line: z.string().optional().default(''),
  set_ref_price: z.number().optional().default(0),
  set_ref_qty: z.number().optional().default(0),
  is_permium: z.number().int().optional().default(0),
  // เพิ่ม
  qty_cn: z.number().min(0),
  original_price: z.number().optional().default(0),
});

export const CreditNotePayloadSchema = z.object({
  doc_no: z.string().min(1, 'กรุณาระบุเลขที่เอกสาร').max(25),
  doc_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)'),
  cust_code: z.string().min(1, 'กรุณาระบุลูกค้า').max(50),
  ref_doc_no: z.string().min(1, 'กรุณาเลือกใบขายอ้างอิง').max(25),
  ref_doc_date: z.string().optional().default(''),
  vat_type: z.number().int().optional().default(0),
  vat_rate: z.number().optional().default(0),
  /** 0..5 ประเภทการรับคืน — ดู allowedCnTypes ใน service */
  inquiry_type: z.number().int().min(0).max(5),
  discount_word: z.string().optional().default(''),
  remark: z.string().max(200).optional().default(''),
  /** วันหมดอายุคูปอง (YYYY-MM-DD) — default = today + 30 วัน */
  coupon_expire_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** ใช้คูปองได้ครั้งเดียว (default = true) */
  coupon_single_use: z.boolean().optional(),
  lines: z.array(CreditNoteLineSchema).min(1, 'lines ต้องมีอย่างน้อย 1 รายการ'),
});

export type CreditNoteLinePayloadDto = z.infer<typeof CreditNoteLineSchema>;
export type CreditNotePayloadDto = z.infer<typeof CreditNotePayloadSchema>;

export interface CouponInfo {
  number: string;
  amount: number;
  /** YYYY-MM-DD */
  expire_date: string;
}

export interface SaveCreditNoteResult {
  doc_no: string;
  coupon: CouponInfo | null;
}
