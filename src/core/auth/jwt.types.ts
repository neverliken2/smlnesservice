/**
 * JWT payload — sign โดย AuthService
 *
 * 2 ชนิด token (`tokenType`):
 * - `pre-select` — ออกหลัง /auth/login ก่อน user เลือก data DB
 *   ใช้ได้แค่ผ่าน /auth/select-database; อายุสั้น (default 2m)
 * - `session`    — ออกหลัง /auth/select-database
 *   ใช้กับ endpoint ทั่วไป ผ่าน JwtAuthGuard; อายุ SESSION_EXPIRES_IN (default 8h)
 *
 * `clientCode` — ระบุ client (เช่น "nextstep-cn-coupon") ที่ออก JWT ใบนี้ให้
 *   JwtStrategy ตรวจอีกชั้นว่า clientCode ยังอยู่ใน ClientRegistry
 *   (กัน JWT เก่าใช้หลัง admin rotate client token)
 */
export type JwtTokenType = 'pre-select' | 'session';

export interface JwtPayload {
  /** Subject — user_code */
  sub: string;
  provider: string;
  tokenType: JwtTokenType;
  /** Client ที่ login เข้ามา (ระบุโดย ClientAuthGuard) */
  clientCode: string;
  /** มีเฉพาะ tokenType === 'session' */
  database?: string;
  /** มีเฉพาะ tokenType === 'session' */
  userLevel?: number;
  iat?: number;
  exp?: number;
}
