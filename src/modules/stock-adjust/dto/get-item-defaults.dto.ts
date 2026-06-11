import { z } from 'zod';
import type { ItemOption } from './search-items.dto';

export const GetItemDefaultsQuerySchema = z.object({
  whCode: z.string().max(50).default(''),
});
export type GetItemDefaultsQuery = z.infer<typeof GetItemDefaultsQuerySchema>;

export interface UnitOption {
  code: string;
  stand_value: number;
  divide_value: number;
  ratio: number;
}

export interface GetItemDefaultsResponse {
  item: ItemOption | null;
  units: UnitOption[];
  stock_qty: number;
}
