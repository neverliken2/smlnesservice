/**
 * Raw row จาก erp_option — PG numeric/decimal returns เป็น string
 * จะ normalize เป็น number ใน service ก่อนส่ง response
 */
export interface ErpOptionRow {
  vat_rate: string | number | null;
  item_amount_decimal: string | number | null;
  item_qty_decimal: string | number | null;
  item_price_decimal: string | number | null;
}

/**
 * Response shape — shape คงที่เสมอ (fallback ทุก column)
 */
export interface ErpOptionResponse {
  vat_rate: number;
  item_amount_decimal: number;
  item_qty_decimal: number;
  item_price_decimal: number;
}
