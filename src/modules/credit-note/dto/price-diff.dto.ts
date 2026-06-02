import { z } from 'zod';

export const PriceDiffQuerySchema = z.object({
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'fromDate ต้องเป็น YYYY-MM-DD'),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'toDate ต้องเป็น YYYY-MM-DD'),
});

export type PriceDiffQueryDto = z.infer<typeof PriceDiffQuerySchema>;

export interface PriceDiffRow {
  cn_doc_no: string;
  cn_date: string;
  item_code: string;
  item_name: string;
  qty: number;
  original_price: number;
  adjusted_price: number;
  diff_per_unit: number;
  diff_total: number;
  source_invoice: string;
}

export interface PriceDiffReportResponse {
  rows: PriceDiffRow[];
  summary: {
    cn_count: number;
    line_count: number;
    diff_total_sum: number;
  };
}
