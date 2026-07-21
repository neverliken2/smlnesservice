/**
 * Constants ของเอกสาร IA (Inventory Adjust — ปรับปรุงสต๊อก)
 *
 * อ้างอิงจาก SMLERP22 schema + ข้อตกลงใน smlnesservice-migration-plan.md §1
 *
 * - IA เป็น value-only adjust:
 *     detail.qty = 0, price = 0
 *     sum_amount = (target_avg_cost − old_cost) × qty_in_standard_unit
 * - APP_CREATOR_CODE = marker ของเอกสารที่สร้างจาก web (เก็บใน ic_trans.creator_code)
 *   หมายเหตุ: ใช้ underscore (อ้างอิงจาก convention เดียวกับ CN: APP_CREATOR_CODE='nextstep_cn_coupon')
 *   แตกต่างจาก clientCode ของ Auth ที่ใช้ dash ('nextstep-stock-adjust')
 */
export const IA_TRANS_FLAG = 66;
export const IA_FORMAT_CODE = 'IA';
export const IA_TRANS_TYPE = 3; // Inventory
export const IA_INQUIRY_TYPE = 0; // 1.ปรับปรุงสินค้า
export const APP_CREATOR_CODE = 'nextstep_stock_adjust';
export const PURCHASE_TRANS_FLAG = 12; // ใช้ใน getPurchaseHistory

/**
 * Constants ของเอกสาร RMB (สินค้า/วัตถุดิบ คงเหลือยกมา — Beginning Balance)
 *
 * อ้างอิง SMLERP22: trans_flag=54 (สินค้า_ยอดคงเหลือสินค้ายกมา), ยกเลิก=55
 * ต่างจาก IA: detail เก็บ qty จริง + price (ต้นทุน/หน่วย), sum_amount = qty × price
 * Field values ยืนยันจากเอกสารจริงที่ desktop บันทึก (DB demo, doc RMB-2606-0001):
 *   average_cost = price, ratio = 0, calc_flag = 1, is_get_price = 1, ref_row = -1
 */
export const RMB_TRANS_FLAG = 54;
export const RMB_FORMAT_CODE = 'RMB';
export const RMB_TRANS_TYPE = 3; // Inventory
export const RMB_INQUIRY_TYPE = 0;
