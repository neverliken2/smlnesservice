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
 * - preSelectToken — JWT ชั่วคราว (default 2m) สำหรับเรียก /auth/select-database
 * - databases — list ที่ user มีสิทธิ์ (filter ตาม dataGroup ถ้า provide)
 */
export interface LoginResponse {
  preSelectToken: string;
  preSelectExpiresIn: number;
  user: UserInfo;
  databases: DatabaseInfo[];
}

/**
 * Response ของ /auth/select-database
 *
 * - guidCode  — session key ของจริง (row ใน sml_guid ของ auth DB)
 *   ใช้ผ่าน `Authorization: SmlGuid <provider>:<guidCode>` กับทุก endpoint
 * - sessionTtlHours — TTL นับจาก last_access_time (sliding) — default 8h
 */
export interface SessionTokenResponse {
  guidCode: string;
  sessionTtlHours: number;
  user: UserInfo;
  database: DatabaseInfo;
}

/**
 * Response ของ /auth/logout
 */
export interface LogoutResponse {
  deleted: boolean;
}
