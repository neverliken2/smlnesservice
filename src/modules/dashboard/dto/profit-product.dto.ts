import { z } from 'zod';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const ProfitProductQuerySchema = z.object({
  startDate: z.string().regex(ISO_DATE).optional(),
  endDate: z.string().regex(ISO_DATE).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),

  productCodeFrom: z.string().max(50).optional(),
  productCodeTo: z.string().max(50).optional(),
  /** JSON array `[{from, to}, ...]` */
  productRanges: z.string().max(2000).optional(),
  /** CSV ของ product codes */
  selectedProducts: z.string().max(4000).optional(),
  productCode: z.string().max(100).optional(),
  brand: z.string().max(50).optional(),
  productClass: z.string().max(50).optional(),
  productSize: z.string().max(50).optional(),
  productColor: z.string().max(50).optional(),
  productGrade: z.string().max(50).optional(),
  productModel: z.string().max(50).optional(),
  productCategory: z.string().max(50).optional(),
  productGroupMain: z.string().max(50).optional(),
  productGroupSub: z.string().max(50).optional(),
  productGroupSub2: z.string().max(50).optional(),
});
export type ProfitProductQuery = z.infer<typeof ProfitProductQuerySchema>;

export interface ProfitProductRow {
  code: string;
  name_1: string;
  unit_name: string;
  qty_sale: number;
  amount_sale: number;
  cost_sale: number;
  qty_sale_return: number;
  amount_sale_return: number;
  cost_sale_return: number;
  net_amount_sale: number;
  net_cost_sale: number;
  profit: number;
  per_profit: number;
}

export interface ProfitProductTotals {
  qty_sale: number;
  amount_sale: number;
  cost_sale: number;
  qty_sale_return: number;
  amount_sale_return: number;
  cost_sale_return: number;
  net_amount_sale: number;
  net_cost_sale: number;
  profit: number;
}

export interface ProfitProductResponse {
  rows: ProfitProductRow[];
  pagination: {
    page: number;
    pageSize: number;
    totalRecords: number;
    totalPages: number;
  };
  totals: ProfitProductTotals;
}
