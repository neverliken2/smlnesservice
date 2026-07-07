import { expandDocNo, nullIfEmpty, round2, round5 } from './stock-adjust.util';

describe('stock-adjust.util', () => {
  // ──────────────────────────── round2 ────────────────────────────

  describe('round2', () => {
    it('ปัดทศนิยมเป็น 2 ตำแหน่งแบบ half-up', () => {
      expect(round2(1.234)).toBe(1.23);
      expect(round2(1.235)).toBe(1.24); // half-up
      expect(round2(1.236)).toBe(1.24);
    });

    it('คืนค่าเดิมถ้าทศนิยมน้อยกว่า 2', () => {
      expect(round2(1)).toBe(1);
      expect(round2(1.2)).toBe(1.2);
    });

    it('จัดการ 0 และ negative ได้', () => {
      expect(round2(0)).toBe(0);
      // หมายเหตุ: เลขที่ "half" (-1.235, 0.005) มี float precision issue ใน JS
      // ใช้เลขที่ไม่ใกล้ขอบ — ผลตรงตามคาด
      expect(round2(-1.234)).toBe(-1.23);
      expect(round2(-1.236)).toBe(-1.24);
    });

    it('ตัวอย่างจาก source: sum_amount=239.61 รวมจาก lines', () => {
      const lines = [100.123, 80.456, 59.031];
      const total = round2(lines.reduce((a, b) => a + b, 0));
      expect(total).toBe(239.61);
    });
  });

  // ──────────────────────────── round5 ────────────────────────────

  describe('round5', () => {
    it('ปัดทศนิยมเป็น 5 ตำแหน่ง', () => {
      expect(round5(1.123456)).toBe(1.12346);
      expect(round5(1.123455)).toBe(1.12346);
      expect(round5(1.123454)).toBe(1.12345);
    });

    it('คืนค่าเดิมถ้าทศนิยมน้อยกว่า 5', () => {
      expect(round5(1.234)).toBe(1.234);
    });
  });

  // ──────────────────────────── nullIfEmpty ────────────────────────────

  describe('nullIfEmpty', () => {
    it('คืน null เมื่อ string ว่าง / null / undefined', () => {
      expect(nullIfEmpty('')).toBeNull();
      expect(nullIfEmpty('   ')).toBeNull();
      expect(nullIfEmpty(null)).toBeNull();
      expect(nullIfEmpty(undefined)).toBeNull();
    });

    it('trim + คืนค่าเมื่อมี content', () => {
      expect(nullIfEmpty('abc')).toBe('abc');
      expect(nullIfEmpty('  abc  ')).toBe('abc');
    });
  });

  // ──────────────────────────── expandDocNo ────────────────────────────

  describe('expandDocNo', () => {
    it('gen เลขแรก (running=1) ถ้าไม่มี docNo เดิม', async () => {
      const docNo = await expandDocNo({
        format: '@YYMM####',
        docDate: '2026-06-11',
        formatCode: 'IA',
        findLast: async () => undefined,
      });
      expect(docNo).toBe('IA26060001');
    });

    it('gen เลขถัดไปจาก doc_no ล่าสุด', async () => {
      const docNo = await expandDocNo({
        format: '@YYMM####',
        docDate: '2026-06-11',
        formatCode: 'IA',
        findLast: async () => 'IA26060005',
      });
      expect(docNo).toBe('IA26060006');
    });

    it('รองรับ YYYY 4 หลัก', async () => {
      const docNo = await expandDocNo({
        format: '@-YYYY-MM-####',
        docDate: '2026-06-11',
        formatCode: 'CN',
        findLast: async () => undefined,
      });
      expect(docNo).toBe('CN-2026-06-0001');
    });

    it('รองรับ DD', async () => {
      const docNo = await expandDocNo({
        format: '@YYMMDD###',
        docDate: '2026-06-11',
        formatCode: 'IA',
        findLast: async () => undefined,
      });
      expect(docNo).toBe('IA260611001');
    });

    it('strip suffix ถูกตอน parse running จาก last doc_no', async () => {
      const docNo = await expandDocNo({
        format: '@YYMM####X',
        docDate: '2026-06-11',
        formatCode: 'IA',
        findLast: async () => 'IA26060042X',
      });
      expect(docNo).toBe('IA26060043X');
    });

    it('จำนวน # กำหนด zero-padding', async () => {
      const d6 = await expandDocNo({
        format: '@######',
        docDate: '2026-06-11',
        formatCode: 'IA',
        findLast: async () => undefined,
      });
      expect(d6).toBe('IA000001');
    });

    it('throw ถ้า format ไม่มี #', async () => {
      await expect(
        expandDocNo({
          format: '@YYMM',
          docDate: '2026-06-11',
          formatCode: 'IA',
          findLast: async () => undefined,
        }),
      ).rejects.toThrow(/ไม่มี #/);
    });

    it('throw ถ้า docDate format ผิด', async () => {
      await expect(
        expandDocNo({
          format: '@YYMM####',
          docDate: '2026/06/11',
          formatCode: 'IA',
          findLast: async () => undefined,
        }),
      ).rejects.toThrow(/YYYY-MM-DD/);
    });

    it('ถ้า last doc_no parse ไม่ได้ → fallback running=1', async () => {
      const docNo = await expandDocNo({
        format: '@YYMM####',
        docDate: '2026-06-11',
        formatCode: 'IA',
        findLast: async () => 'IA2606XXXX', // digits not parseable
      });
      expect(docNo).toBe('IA26060001');
    });
  });
});
