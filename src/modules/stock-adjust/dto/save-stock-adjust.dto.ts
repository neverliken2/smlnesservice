import { z } from 'zod';

export const SaveStockAdjustBodySchema = z.object({
  doc_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'doc_date ต้องเป็น YYYY-MM-DD'),
  doc_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'doc_time ต้องเป็น HH:mm')
    .optional()
    .or(z.literal('')),
  doc_ref: z.string().max(255).optional().or(z.literal('')),
  doc_ref_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'doc_ref_date ต้องเป็น YYYY-MM-DD')
    .optional()
    .or(z.literal('')),
  wh_from: z.string().min(1, 'wh_from ว่าง').max(25),
  location_from: z.string().max(25).default(''),
  remark: z.string().max(255).optional().or(z.literal('')),
  lines: z
    .array(
      z.object({
        item_code: z.string().min(1, 'item_code ว่าง'),
        item_name: z.string().default(''),
        unit_code: z.string().min(1, 'unit_code ว่าง'),
        sum_amount: z.coerce.number(),
        wh_code: z.string().max(25).optional().or(z.literal('')),
        shelf_code: z.string().max(25).optional().or(z.literal('')),
        stand_value: z.coerce.number(),
        divide_value: z.coerce.number(),
      }),
    )
    .min(1, 'lines ว่าง'),
});
export type SaveStockAdjustBody = z.infer<typeof SaveStockAdjustBodySchema>;

export interface SaveStockAdjustResponse {
  doc_no: string;
  total_amount: number;
}
