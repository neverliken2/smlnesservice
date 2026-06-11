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
