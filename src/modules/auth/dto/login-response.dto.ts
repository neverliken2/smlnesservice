export interface UserInfo {
  userCode: string;
  userName: string;
  userLevel: number;
}

export interface DatabaseInfo {
  dataCode: string;
  databaseName: string;
  dataName: string;
}

/**
 * Response ของ /auth/login
 *
 * - preSelectToken — ใช้ผ่าน /auth/select-database, อายุสั้น (default 2m)
 * - databases — list ที่ user มีสิทธิ์เข้าถึง (filter ตาม dataGroup ถ้า provide)
 */
export interface LoginResponse {
  preSelectToken: string;
  preSelectExpiresIn: number;
  user: UserInfo;
  databases: DatabaseInfo[];
}

/**
 * Response ของ /auth/select-database และ /auth/refresh
 *
 * - accessToken — ใช้ผ่าน JwtAuthGuard กับทุก endpoint
 */
export interface SessionTokenResponse {
  accessToken: string;
  expiresIn: number;
  user: UserInfo;
  database: DatabaseInfo;
}
