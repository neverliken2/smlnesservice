/**
 * Default ของ erp_option — ใช้เมื่อ row ไม่มี หรือ column เป็น NULL
 *
 * อ้างอิงจาก SMLERP22 default + ข้อตกลงในเอกสาร smlnesservice-migration-plan.md §4.1
 */
export const ERP_OPTION_DEFAULTS = {
  VAT_RATE: 7,
  ITEM_AMOUNT_DECIMAL: 2,
  ITEM_QTY_DECIMAL: 3,
  ITEM_PRICE_DECIMAL: 5,
} as const;
