import { randomUUID } from 'crypto';

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

export function nullIfEmpty(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  return t === '' ? null : t;
}

// ──────────────────────────── Audit log (ตาราง logs) ────────────────────────────

/**
 * 'YYYY-MM-DD' → 'D/M/พ.ศ.' เช่น '2026-07-28' → '28/7/2569'
 * (รูปแบบเดียวกับที่ desktop เขียนลง logs.data1 — ไม่ pad ศูนย์)
 */
export function toThaiShortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return '';
  const [, y, mm, dd] = m;
  return `${Number(dd)}/${Number(mm)}/${Number(y) + 543}`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface AuditData1Fields {
  docDate: string; // 'YYYY-MM-DD'
  docTime: string;
  docNo: string;
  docFormatCode: string;
  docRefDate: string | null;
  docRef: string | null;
  whFrom: string;
  locationFrom: string;
  remark: string | null;
}

/**
 * สร้างค่า `logs.data1` — snapshot ของหัวเอกสาร
 *
 * รูปแบบ mirror จาก `_icTransScreenTop._logCreate("top")` ของ SMLERP22
 * (ยืนยันกับเอกสารจริง IS-2607-0001 ที่ desktop บันทึก):
 *   <?xml version="1.0" encoding="utf-8"?><top><d t=2 f=doc_date>28/7/2569</d>...</top>
 *   t=1 string, t=2 date
 *
 * ⚠️ desktop เก็บค่านี้ในรูป **escape แล้ว** (`&lt;` ไม่ใช่ `<`) เพราะส่ง query ผ่าน XML
 *    เราจึง escape ให้เหมือนกัน ไม่งั้นหน้าดู audit log ของ desktop จะแสดงผลต่างกัน
 */
export function buildAuditData1(f: AuditData1Fields): string {
  const d = (t: number, field: string, value: string) =>
    `<d t=${t} f=${field}>${value ?? ''}</d>`;

  const xml =
    '<?xml version="1.0" encoding="utf-8"?><top>' +
    d(2, 'doc_date', toThaiShortDate(f.docDate)) +
    d(1, 'doc_time', f.docTime || '') +
    d(1, 'doc_no', f.docNo) +
    d(1, 'doc_format_code', f.docFormatCode) +
    d(2, 'doc_ref_date', toThaiShortDate(f.docRefDate || '')) +
    d(1, 'doc_ref', f.docRef || '') +
    d(1, 'wh_from', f.whFrom || '') +
    d(1, 'location_from', f.locationFrom || '') +
    d(1, 'remark', f.remark || '') +
    '</top>';

  return escapeXml(xml).slice(0, 5000);
}

/** guid 32 hex ไม่มีขีด — ตรงกับ `Guid.NewGuid().ToString("N")` ของ desktop */
export function newAuditGuid(): string {
  return randomUUID().replace(/-/g, '');
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

export async function expandDocNo(opts: ExpandDocNoOptions): Promise<string> {
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
