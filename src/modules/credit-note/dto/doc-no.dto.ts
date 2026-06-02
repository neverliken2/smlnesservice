import { z } from 'zod';

export const NextDocNoQuerySchema = z.object({
  formatCode: z
    .string()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/, 'formatCode format ไม่ถูกต้อง')
    .optional(),
  docDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'docDate ต้องเป็น YYYY-MM-DD'),
});

export type NextDocNoQueryDto = z.infer<typeof NextDocNoQuerySchema>;

export interface NextDocNoResponse {
  doc_no: string;
}
