import type { ItemOption } from './search-items.dto';
import type { UnitOption } from './get-item-defaults.dto';

/**
 * Response shape ของ GET /api/v1/stock-adjust/item-locations/:itemCode
 *
 * ใช้กับ flow "Bulk IA by Location" ที่ฝั่ง NextStep_Stock_Adjust
 * — 1 ใบเอกสารต่อ (wh, shelf) ที่ item เคยมี transaction ใน ic_trans_detail
 *
 * Note: stock_qty + old_cost ของ 2 shelf ใน wh เดียวกันจะเท่ากัน
 *       เพราะ SML track ที่ระดับ wh ไม่ใช่ (wh, shelf) — เป็น by-design
 */
export interface ItemLocationRow {
  wh_code: string;
  wh_name: string;
  shelf_code: string;
  shelf_name: string;
  /** ใน unit_standard */
  stock_qty: number;
  /** avg cost ปัจจุบันของ wh นั้น */
  old_cost: number;
}

export interface GetItemLocationsResponse {
  item: ItemOption | null;
  units: UnitOption[];
  locations: ItemLocationRow[];
}
