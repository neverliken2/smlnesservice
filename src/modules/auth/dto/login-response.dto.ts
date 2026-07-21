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
 * สิทธิ์เมนูเพิ่มเติม (per-client) — ตอนนี้มีเฉพาะ nextstep-stock-adjust
 */
export interface MenuPermissions {
  /** menu_ic_stk_balance — เมนู "สินค้า/วัตถุดิบ คงเหลือยกมา" (RMB) */
  canStockBalance: boolean;
}

/**
 * Response ของ /auth/login
 *
 * - preSelectToken — JWT ชั่วคราว (default 2m) ใช้ผ่าน /auth/select-database
 * - databases — list ที่ user มีสิทธิ์ (filter ตาม dataGroup ถ้า provide)
 * - permissions — สิทธิ์เมนูย่อย (มีเฉพาะ client ที่เกี่ยวข้อง เช่น nextstep-stock-adjust)
 */
export interface LoginResponse {
  preSelectToken: string;
  preSelectExpiresIn: number;
  user: UserInfo;
  databases: DatabaseInfo[];
  permissions?: MenuPermissions;
}

/**
 * Response ของ /auth/select-database
 *
 * - accessToken — session JWT (default 8h) — ใช้ผ่าน Authorization Bearer ทุก endpoint
 *   payload มี clientCode + provider + database + userCode ในตัว
 */
export interface SessionTokenResponse {
  accessToken: string;
  expiresIn: number;
  user: UserInfo;
  database: DatabaseInfo;
}
