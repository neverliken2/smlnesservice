import { SetMetadata } from '@nestjs/common';

export const SKIP_API_KEY_KEY = 'skipApiKey';

/**
 * ติด @SkipApiKey() บน controller/handler เพื่อข้าม ApiKeyGuard
 * ใช้กับ endpoint ที่ต้อง public เช่น /health
 */
export const SkipApiKey = () => SetMetadata(SKIP_API_KEY_KEY, true);
