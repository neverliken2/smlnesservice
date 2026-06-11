import { z } from 'zod';

export const SearchWarehousesQuerySchema = z.object({
  query: z.string().max(50).default(''),
});
export type SearchWarehousesQuery = z.infer<typeof SearchWarehousesQuerySchema>;

export interface WarehouseOption {
  code: string;
  name: string;
}
