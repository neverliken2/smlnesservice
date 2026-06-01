import { SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'isPublic';

/**
 * @Public() — ติดบน controller/handler เพื่อข้าม global SmlGuidGuard
 * ใช้กับ endpoint ที่ไม่ต้อง session เช่น /health, /auth/login
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
