import { z } from 'zod';
import type { UnitOption } from './get-item-defaults.dto';

/**
 * Validate import ของเมนูคงเหลือยกมา (RMB)
 * คอลัมน์: item_code, unit_code, wh_code, shelf_code, qty, cost
 * — ไม่ query stock/old_cost (เอกสารยกมาใช้ตั้งยอด ไม่เกี่ยวกับยอดปัจจุบัน)
 * — เช็ค wh/shelf ว่ามีจริงใน ic_warehouse / ic_shelf (คู่ wh+shelf)
 */
export const ValidateImportBalanceBodySchema = z.object({
  rows: z
    .array(
      z.object({
        row_index: z.coerce.number().int(),
        item_code: z.string(),
        unit_code: z.string(),
        wh_code: z.string(),
        shelf_code: z.string(),
        qty: z.coerce.number(),
        cost: z.coerce.number(),
      }),
    )
    .max(1000, 'เกินขีดจำกัด 1,000 บรรทัด'),
});
export type ValidateImportBalanceBody = z.infer<
  typeof ValidateImportBalanceBodySchema
>;

export interface ValidatedImportBalanceRow {
  row_index: number;
  item_code: string;
  unit_code: string;
  wh_code: string;
  shelf_code: string;
  qty: number;
  cost: number;
  valid: boolean;
  error?: string;
  item_name?: string;
  unit_standard?: string;
  stand_value?: number;
  divide_value?: number;
  units?: UnitOption[];
}

export interface ValidateImportBalanceResponse {
  rows: ValidatedImportBalanceRow[];
  total: number;
  ok_count: number;
  error_count: number;
}
