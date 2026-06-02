/**
 * Utility helpers สำหรับ credit-note module
 * Port จาก NextStep_CN_Coupon/src/actions/credit-note.ts (helpers section)
 */

/** แปลง discount_word เช่น "10%" → 0.10; "50" (ไม่มี %) → 0 */
export function parseDiscountPercent(word: string): number {
  if (!word) return 0;
  const trimmed = word.trim();
  if (!trimmed.endsWith('%')) return 0;
  const pct = parseFloat(trimmed.slice(0, -1));
  return Number.isNaN(pct) ? 0 : pct / 100;
}

/** Round 2 decimal places */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Date|string → YYYY-MM-DD */
export function toISODate(d: Date | string | null | undefined): string {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/** เพิ่มวันจาก YYYY-MM-DD แล้วคืนเป็น YYYY-MM-DD */
export function addDays(isoDate: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate || '');
  if (!m) return isoDate;
  const d = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days),
  );
  return d.toISOString().slice(0, 10);
}

/** Today as YYYY-MM-DD (UTC) */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Validate date string format YYYY-MM-DD */
export function isISODate(s: string | undefined | null): boolean {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
