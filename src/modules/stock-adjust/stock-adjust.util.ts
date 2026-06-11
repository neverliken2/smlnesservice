/**
 * Helpers ของ stock-adjust module
 *
 * Port จาก source pre-migration (NextStep_Stock_Adjust/src/actions/stock-adjust.ts)
 *   round2 — สำหรับ total_amount
 *   round5 — สำหรับ sum_amount แต่ละ line
 *   nullIfEmpty — string ว่าง → NULL (ตรง pattern ของ smlerp22 INSERT)
 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function round5(n: number): number {
  return Math.round(n * 100000) / 100000;
}

export function nullIfEmpty(
  s: string | null | undefined,
): string | null {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  return t === '' ? null : t;
}

/**
 * Parse erp_doc_format.format pattern → คำนวณ doc_no ถัดไป
 *
 * Format tokens (mirrors SMLERP22):
 *   @     = formatCode (เช่น "IA")
 *   YY    = year ค.ศ. 2-digit last
 *   YYYY  = year ค.ศ. 4-digit
 *   MM    = month 2-digit
 *   DD    = day 2-digit
 *   #...# = running, zero-padded ตามจำนวน #
 *   อื่นๆ = literal
 *
 * Pure function — รับ findLast callback (caller-provided async) เพื่อให้ใช้ใน-tx ก็ได้
 * caller ใช้ตอน save (in-tx FOR UPDATE) หรือ pre-check (out-of-tx) ก็ใช้ได้เหมือนกัน
 *
 * @throws Error ถ้า format ไม่มี # หรือ docDate format ผิด
 */
export interface ExpandDocNoOptions {
  format: string;
  docDate: string; // 'YYYY-MM-DD'
  formatCode: string;
  findLast: (pgPattern: string) => Promise<string | undefined>;
}

export async function expandDocNo(
  opts: ExpandDocNoOptions,
): Promise<string> {
  const { format, docDate, formatCode, findLast } = opts;

  const runMatch = /(#+)/.exec(format);
  if (!runMatch) {
    throw new Error(`format "${format}" ไม่มี # สำหรับ running`);
  }
  const digitCount = runMatch[1].length;
  const beforeRun = format.slice(0, runMatch.index);
  const afterRun = format.slice(runMatch.index + digitCount);

  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(docDate);
  if (!dateMatch) {
    throw new Error(`docDate "${docDate}" ไม่ใช่ YYYY-MM-DD`);
  }
  const [, yyyy, mm, dd] = dateMatch;
  const yy = yyyy.slice(-2);

  const expand = (tpl: string) =>
    tpl
      .replace(/@/g, formatCode)
      .replace(/YYYY/g, yyyy)
      .replace(/YY/g, yy)
      .replace(/MM/g, mm)
      .replace(/DD/g, dd);

  const prefix = expand(beforeRun);
  const suffix = expand(afterRun);
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pgPattern = `^${escapeRegex(prefix)}[0-9]{${digitCount}}${escapeRegex(suffix)}$`;

  const lastDocNo = await findLast(pgPattern);
  let nextRunning = 1;
  if (lastDocNo) {
    const digits = lastDocNo.slice(prefix.length, prefix.length + digitCount);
    const parsed = parseInt(digits, 10);
    if (!Number.isNaN(parsed)) nextRunning = parsed + 1;
  }

  return prefix + String(nextRunning).padStart(digitCount, '0') + suffix;
}
