import { z } from 'zod';

export const LoginSchema = z.object({
  provider: z
    .string()
    .min(1, 'provider ต้องไม่ว่าง')
    .max(20)
    .regex(/^[a-zA-Z0-9]+$/, 'provider ต้องเป็น alphanumeric'),
  username: z
    .string()
    .min(1, 'username ต้องไม่ว่าง')
    .max(50)
    .regex(/^[a-zA-Z0-9_]+$/, 'username มีได้แค่ alphanumeric / underscore'),
  password: z.string().min(1, 'password ต้องไม่ว่าง').max(50),
  dataGroup: z
    .string()
    .max(50)
    .regex(/^[a-zA-Z0-9_-]+$/, 'dataGroup format ไม่ถูกต้อง')
    .optional(),
});

export type LoginDto = z.infer<typeof LoginSchema>;

export const SelectDatabaseSchema = z.object({
  dataCode: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-zA-Z0-9_-]+$/, 'dataCode format ไม่ถูกต้อง'),
});

export type SelectDatabaseDto = z.infer<typeof SelectDatabaseSchema>;
