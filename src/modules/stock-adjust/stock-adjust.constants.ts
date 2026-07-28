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

/**
 * Constants ของเอกสาร IS (ปรับปรุงสต๊อกสินค้า/วัตถุดิบ "ลด" — ฝั่งตรงข้ามของ IA)
 *
 * อ้างอิง SMLERP22:
 *   - trans_flag=68 (สินค้า_ปรับปรุงสต๊อก_ขาด), ยกเลิก=69
 *   - doc_format_code='IS' (erp_doc_format.name_1 = "ปรับปรุงสินค้า(ขาด)")
 *   - `InventoryImproveProductStockReduceProcess.cs` ใช้ trans_flag=68
 *   - `_global.cs::_transStockCalcType` → 66 คืน +1, 68 คืน −1
 *
 * ⚠️ ต่างจาก IA ที่ calc_flag = +1:
 *   สูตรยอดคงเหลือคิดเป็น SUM(calc_flag × ...) และ flag 68 อยู่ในกลุ่ม "ออก" ทั้ง qty และ amount
 *   → ต้องเก็บ qty/sum_amount เป็น "ค่าบวกของส่วนที่หักออก" แล้ว calc_flag=−1 จะพาไปลบเอง
 *
 * เอกสารนี้เป็นแบบ **มีจำนวน** (ตัดสต็อกออกจริง) เหมือน grid ของ desktop
 * (`_icTransItemGridControl.cs` — IA/IS ใช้ grid ชุดเดียวกัน มี qty/price/sum_amount ให้กรอก):
 *   qty        = จำนวนที่ตัดออก (> 0)
 *   price      = ทุนเฉลี่ยปัจจุบันของ (item, wh, shelf) นั้น
 *   sum_amount = qty × price
 * ผลหลังบันทึก: จำนวนคงเหลือลดลง qty, มูลค่าลดลง sum_amount, ทุนเฉลี่ยเท่าเดิม
 */
/**
 * ── Audit log (ตาราง `logs`) ──
 *
 * desktop เขียน 1 แถวต่อการบันทึกเอกสาร (`_icTransControl.cs::_createLog`)
 * เราเขียนตามให้ครบทั้ง 3 เมนู เพื่อให้หน้า "ประวัติการใช้งาน" ของ SMLERP22 เห็นเอกสารที่สร้างจากเว็บ
 *
 * - `screen_code` = trans_flag ของเอกสาร (66 / 68 / 54)
 * - `menu_name`   = menu code เดียวกับที่ใช้เช็คสิทธิ์
 * - `function_type` = 2 เสมอ (ข้อมูลรายวัน), `function_code` = 1 (เพิ่มใหม่)
 * - `computer_name` desktop ใส่ชื่อเครื่อง — ฝั่งเว็บไม่มี จึงใส่ marker ของ app แทน
 */
export const AUDIT_FUNCTION_TYPE = 2;
export const AUDIT_OPERATION_INSERT = 1;
export const IA_MENU_NAME = 'menu_ic_stk_adjust';
export const IS_MENU_NAME = 'menu_ic_stk_adjust_subtract';
export const RMB_MENU_NAME = 'menu_ic_stk_balance';

export const IS_TRANS_FLAG = 68;
export const IS_FORMAT_CODE = 'IS';
export const IS_TRANS_TYPE = 3; // Inventory
export const IS_INQUIRY_TYPE = 0;
export const IS_CALC_FLAG = -1;
