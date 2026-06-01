/**
 * Database types & constants
 * Ported from NextStep_CN_Coupon/src/lib/db.ts
 */

export interface QueryOptions {
  /** Query timeout in milliseconds */
  timeout?: number;
  /** ใช้ timeout นานขึ้นสำหรับ report */
  isReport?: boolean;
}

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export const TIMEOUTS = {
  /** 30 วินาที - รอ connection (เผื่อ remote server) */
  CONNECTION: 30_000,
  /** 30 วินาที - query ปกติ */
  QUERY_DEFAULT: 30_000,
  /** 60 วินาที - query รายงาน */
  QUERY_REPORT: 60_000,
  /** 2 นาที - query ใหญ่มาก (export) */
  QUERY_MAX: 120_000,
  /** 60 วินาที - ปิด idle connection */
  IDLE: 60_000,
} as const;

export type SqlParam = string | number | boolean | null | Date | Buffer;
