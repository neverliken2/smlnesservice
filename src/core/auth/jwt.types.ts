/**
 * JWT payload — sign โดย AuthService
 *
 * 2 ชนิด token (`tokenType`):
 * - `pre-select` — ออกหลัง /auth/login สำเร็จ ก่อน user เลือก data DB
 *   ใช้ได้แค่ผ่าน /auth/select-database; อายุสั้น (default 2m)
 * - `session` — ออกหลัง /auth/select-database; ใช้กับ endpoint ทั่วไป
 *   ผ่าน JwtAuthGuard; อายุ JWT_EXPIRES_IN
 */
export type JwtTokenType = 'pre-select' | 'session';

export interface JwtPayload {
  /** Subject — user_code */
  sub: string;
  provider: string;
  tokenType: JwtTokenType;
  /** มีเฉพาะ tokenType === 'session' */
  database?: string;
  /** มีเฉพาะ tokenType === 'session' */
  userLevel?: number;
  iat?: number;
  exp?: number;
}
