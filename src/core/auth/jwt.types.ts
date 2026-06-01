/**
 * JWT payload — sign โดย AuthService หลัง login สำเร็จ
 */
export interface JwtPayload {
  /** Subject — user_code */
  sub: string;
  provider: string;
  database: string;
  userLevel: number;
  iat?: number;
  exp?: number;
}
