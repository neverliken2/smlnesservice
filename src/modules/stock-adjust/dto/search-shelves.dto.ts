import { z } from 'zod';

export const SearchShelvesQuerySchema = z.object({
  query: z.string().max(50).default(''),
  whCode: z.string().max(50).default(''),
});
export type SearchShelvesQuery = z.infer<typeof SearchShelvesQuerySchema>;

export interface ShelfOption {
  code: string;
  name: string;
  wh_code: string;
}
