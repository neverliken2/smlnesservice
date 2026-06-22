import { z } from 'zod';

export const ProductTransactionsParamSchema = z.object({
  productCode: z.string().min(1).max(50),
});
export type ProductTransactionsParam = z.infer<
  typeof ProductTransactionsParamSchema
>;

export interface LatestPurchase {
  doc_date: string;
  doc_time: string;
  doc_no: string;
  branch_code: string;
  branch_name: string;
  supplier_code: string;
  supplier_name: string;
  warehouse_code: string;
  area_code: string;
  qty: number;
  unit_name: string;
  discount: number;
  amount: number;
}

export interface LatestSale {
  doc_date: string;
  doc_time: string;
  doc_no: string;
  branch_code: string;
  branch_name: string;
  customer_code: string;
  customer_name: string;
  warehouse_code: string;
  area_code: string;
  qty: number;
  unit_name: string;
  discount: number;
  amount: number;
}

export interface ProductTransactionsResponse {
  latestPurchases: LatestPurchase[];
  latestSales: LatestSale[];
}
