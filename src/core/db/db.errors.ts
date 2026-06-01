/**
 * Database custom errors
 * Ported from NextStep_CN_Coupon/src/lib/db.ts
 */

export class QueryTimeoutError extends Error {
  public readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(
      `Query timeout หลังจาก ${timeoutMs / 1000} วินาที - กรุณาลดช่วงวันที่หรือเพิ่มเงื่อนไขการค้นหา`,
    );
    this.name = 'QueryTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class DatabaseConnectionError extends Error {
  constructor(database: string, originalError?: Error) {
    super(
      `ไม่สามารถเชื่อมต่อฐานข้อมูล ${database} ได้${originalError ? `: ${originalError.message}` : ''}`,
    );
    this.name = 'DatabaseConnectionError';
  }
}
