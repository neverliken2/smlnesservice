import { z } from 'zod';

export const CustomerSearchQuerySchema = z.object({
  query: z.string().max(50).optional(),
});

export type CustomerSearchQueryDto = z.infer<typeof CustomerSearchQuerySchema>;

export interface CustomerOption {
  code: string;
  name: string;
}
