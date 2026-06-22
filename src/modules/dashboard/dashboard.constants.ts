/**
 * Constants ของ Dashboard module
 *
 * - APP_CREATOR_CODE = marker สำหรับเอกสารที่สร้างจาก Dashboard (เก็บใน ic_trans.creator_code)
 *   ใช้ underscore (convention เดียวกับ CN: 'nextstep_cn_coupon', Stock Adjust: 'nextstep_stock_adjust')
 *   แตกต่างจาก clientCode ของ Auth ที่ใช้ dash ('nextstep-dashboard')
 *
 * - Phase 1: read-only ทั้งหมด → ยังไม่ใช้ creator_code
 *   เผื่อไว้สำหรับ feature future (TaxInvoice on-demand, Approval, PettyCash)
 */
export const APP_CREATOR_CODE = 'nextstep_dashboard';
