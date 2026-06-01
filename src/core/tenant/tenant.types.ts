/**
 * Tenant context — ข้อมูลที่ทุก request (หลังผ่าน JWT) ต้องมี
 * Inject ผ่าน @Tenant() decorator ใน controller method
 */
export interface TenantContext {
  /** Auth DB provider code เช่น "demo", "next" — map → smlerpmain<provider> */
  provider: string;
  /** Data DB ที่ user เลือกหลัง login */
  database: string;
  /** sml_user_list.user_code */
  userCode: string;
  /** sml_user_list.user_level (0 = admin) */
  userLevel: number;
}
