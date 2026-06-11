import { z } from 'zod';

export const SearchItemsQuerySchema = z.object({
  query: z.string().max(50).default(''),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type SearchItemsQuery = z.infer<typeof SearchItemsQuerySchema>;

export interface ItemOption {
  code: string;
  name: string;
  unit_standard: string;
  average_cost: number;
}

export interface SearchItemsResponse {
  rows: ItemOption[];
  has_more: boolean;
}
