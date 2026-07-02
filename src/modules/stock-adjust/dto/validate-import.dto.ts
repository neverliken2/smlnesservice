import { z } from 'zod';
import type { UnitOption } from './get-item-defaults.dto';

export const ValidateImportBodySchema = z.object({
  rows: z
    .array(
      z.object({
        row_index: z.coerce.number().int(),
        item_code: z.string(),
        unit_code: z.string(),
        new_cost: z.coerce.number(),
      }),
    )
    .max(1000, 'เกินขีดจำกัด 1,000 บรรทัด'),
  wh_code: z.string().min(1, 'กรุณาระบุคลัง'),
  shelf_code: z.string().default(''),
});
export type ValidateImportBody = z.infer<typeof ValidateImportBodySchema>;

/**
 * ValidatedImportRow — ผลตอบ per-row (ตรงกับ source pre-migration)
 *   valid=true  → มี item_name, unit_standard, units, stand_value, divide_value, old_cost, stock_qty
 *   valid=false → มี error message
 */
export interface ValidatedImportRow {
  row_index: number;
  item_code: string;
  unit_code: string;
  new_cost: number;
  valid: boolean;
  error?: string;
  item_name?: string;
  unit_standard?: string;
  old_cost?: number;
  stock_qty?: number;
  stand_value?: number;
  divide_value?: number;
  units?: UnitOption[];
}

export interface ValidateImportResponse {
  rows: ValidatedImportRow[];
  total: number;
  ok_count: number;
  error_count: number;
}
