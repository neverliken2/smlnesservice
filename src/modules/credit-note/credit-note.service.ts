import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PoolManagerService } from '../../core/db/pool-manager.service';
import { ErrorCode } from '../../core/error/error-codes';
import { CreditNoteRepository } from './credit-note.repository';
import {
  addDays,
  parseDiscountPercent,
  round2,
  toISODate,
  todayISO,
} from './credit-note.util';
import type { CustomerOption } from './dto/customer.dto';
import type { SalesInvoiceOption } from './dto/sales-invoice.dto';
import type { InvoiceDetailResponse } from './dto/invoice-detail.dto';
import type { CouponListItem } from './dto/coupon.dto';
import type {
  PriceDiffReportResponse,
  PriceDiffRow,
} from './dto/price-diff.dto';
import type {
  CreditNoteLinePayloadDto,
  CreditNotePayloadDto,
  SaveCreditNoteResult,
} from './dto/save-credit-note.dto';

const SALE_TRANS_FLAG = 44;
const CN_TRANS_FLAG = 48;
const TRANS_TYPE_AR = 2;
const CN_FORMAT_CODE = 'WCN';

/**
 * Marker ที่บอกว่าเอกสาร/คูปองถูกสร้างจาก NextStep CN Coupon web
 * ใช้ filter `ic_trans.creator_code` ใน listWebCoupons
 *
 * คงค่าเดิมจาก NextStep (snake_case ไม่ใช่ dash) เพื่อให้ data ที่ออกก่อนหน้านี้
 * และของ service ใหม่อยู่ใน list เดียวกัน
 */
export const APP_CREATOR_CODE = 'nextstep_cn_coupon';

@Injectable()
export class CreditNoteService {
  private readonly logger = new Logger(CreditNoteService.name);

  constructor(
    private readonly repo: CreditNoteRepository,
    private readonly pool: PoolManagerService,
  ) {}

  // ──────────────────────────── 1. Customers ────────────────────────────

  async searchCustomers(
    database: string,
    query: string,
  ): Promise<CustomerOption[]> {
    const q = (query || '').trim().slice(0, 50);
    const rows = await this.repo.searchCustomers(database, q);
    return rows.map((r) => ({ code: r.code, name: r.name_1 || '' }));
  }

  // ──────────────────────────── 2. Sales Invoices ────────────────────────────

  async listSalesInvoices(
    database: string,
    custCode: string | undefined,
    query: string | undefined,
    limit: number | undefined,
    offset: number | undefined,
  ): Promise<SalesInvoiceOption[]> {
    const code = (custCode || '').trim();
    const q = (query || '').trim();
    const safeLimit = Math.min(Math.max(limit ?? 30, 1), 100);
    const safeOffset = Math.max(offset ?? 0, 0);
    const rows = await this.repo.listSalesInvoices(
      database,
      code || undefined,
      q || undefined,
      safeLimit,
      safeOffset,
    );
    return rows.map((r) => ({
      doc_no: r.doc_no,
      doc_date: toISODate(r.doc_date),
      cust_code: r.cust_code,
      cust_name: r.cust_name || '',
      total_amount: Number(r.total_amount) || 0,
      vat_type: r.vat_type ?? 0,
      vat_rate: Number(r.vat_rate) || 0,
      discount_word: r.discount_word || '',
      inquiry_type: r.inquiry_type ?? 0,
      // is_fully_used เป็น false ทุกตัวใน list query — ค่อย fetch แยกที่ /fully-used-status
      is_fully_used: false,
    }));
  }

  /**
   * Batch check is_fully_used ของ doc_no list — ใช้หลัง list ขึ้นมา
   * Frontend เรียก endpoint นี้ → render สีเทาทีหลัง (lazy load)
   */
  async getFullyUsedStatus(
    database: string,
    docNos: string[],
  ): Promise<Record<string, boolean>> {
    // กัน abuse — limit ที่ 200 docNos/call
    const safeDocNos = (docNos || []).slice(0, 200).filter((d) => typeof d === 'string' && d.length > 0);
    if (safeDocNos.length === 0) return {};
    const rows = await this.repo.getFullyUsedStatus(database, safeDocNos);
    const map: Record<string, boolean> = {};
    for (const r of rows) {
      map[r.doc_no] = r.is_fully_used === true;
    }
    // doc_no ที่ไม่มี line (เคสประหลาด) ก็ถือว่า false
    return map;
  }

  // ──────────────────────────── 3. Invoice Detail ────────────────────────────

  async getInvoiceDetail(
    database: string,
    docNo: string,
  ): Promise<InvoiceDetailResponse> {
    const doc = (docNo || '').trim();
    if (!doc) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'doc_no ว่าง',
      });
    }

    // Header + detail rune parallel (independent queries — ประหยัด 1 round-trip)
    const [header, lines] = await Promise.all([
      this.repo.findInvoiceHeader(database, doc),
      this.repo.findInvoiceLines(database, doc),
    ]);

    if (!header) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'ไม่พบเอกสารขาย',
      });
    }

    return {
      header: {
        doc_no: header.doc_no,
        doc_date: toISODate(header.doc_date),
        cust_code: header.cust_code,
        cust_name: '', // client มี cust_name จาก ListSalesInvoices ก่อนหน้า
        total_amount: Number(header.total_amount) || 0,
        vat_type: header.vat_type ?? 0,
        vat_rate: Number(header.vat_rate) || 0,
        discount_word: header.discount_word || '',
        inquiry_type: header.inquiry_type ?? 0,
      },
      lines: lines.map((r) => ({
        line_number: r.line_number,
        item_code: r.item_code,
        item_name: r.item_name || '',
        unit_code: r.unit_code || '',
        qty: Number(r.qty) || 0,
        available_qty: Number(r.available_qty) || 0,
        price: Number(r.price) || 0,
        discount: r.discount || '',
        discount_amount: Number(r.discount_amount) || 0,
        sum_amount: Number(r.sum_amount) || 0,
        sum_amount_exclude_vat: Number(r.sum_amount_exclude_vat) || 0,
        total_vat_value: Number(r.total_vat_value) || 0,
        wh_code: r.wh_code || '',
        shelf_code: r.shelf_code || '',
        vat_type: r.vat_type ?? 0,
        item_type: r.item_type ?? 0,
        set_ref_line: r.set_ref_line || '',
        set_ref_price: Number(r.set_ref_price) || 0,
        set_ref_qty: Number(r.set_ref_qty) || 0,
        is_permium: r.is_permium ?? 0,
      })),
    };
  }

  // ──────────────────────────── 4. Web Coupons ────────────────────────────

  async listWebCoupons(
    database: string,
    options: {
      limit?: number;
      query?: string;
      fromDate?: string;
      toDate?: string;
    },
  ): Promise<CouponListItem[]> {
    const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
    const rawQuery = (options.query || '').trim().slice(0, 100);
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const fromDate =
      options.fromDate && datePattern.test(options.fromDate)
        ? options.fromDate
        : '';
    const toDate =
      options.toDate && datePattern.test(options.toDate) ? options.toDate : '';

    const rows = await this.repo.listWebCoupons(database, APP_CREATOR_CODE, {
      limit,
      query: rawQuery,
      fromDate,
      toDate,
    });

    return rows.map((r) => ({
      number: r.number,
      cust_code: r.cust_code || '',
      cust_name: r.cust_name || '',
      ref_doc_no: r.ref_doc_no || '',
      doc_date: toISODate(r.doc_date),
      amount: Number(r.amount) || 0,
      balance_amount: Number(r.balance_amount) || 0,
      date_expire: toISODate(r.date_expire),
      single_use: Number(r.single_use) || 0,
      // ถ้า last_editor_code = APP_CREATOR_CODE = CN เก่าก่อนเก็บ staff_name → ส่ง '' กลับไป
      staff_name: r.staff_name && r.staff_name !== APP_CREATOR_CODE ? r.staff_name : '',
    }));
  }

  // ──────────────────────────── 5. Reports ────────────────────────────

  async getCnPriceDiffReport(
    database: string,
    fromDate: string,
    toDate: string,
  ): Promise<PriceDiffReportResponse> {
    const rows = await this.repo.getCnPriceDiff(database, fromDate, toDate);
    const mapped: PriceDiffRow[] = rows.map((r) => ({
      cn_doc_no: r.cn_doc_no,
      cn_date: toISODate(r.cn_date),
      item_code: r.item_code,
      item_name: r.item_name || '',
      qty: Number(r.qty) || 0,
      original_price: Number(r.original_price) || 0,
      adjusted_price: Number(r.adjusted_price) || 0,
      diff_per_unit: Number(r.diff_per_unit) || 0,
      diff_total: Number(r.diff_total) || 0,
      source_invoice: r.source_invoice || '',
    }));

    const uniqueCn = new Set(mapped.map((r) => r.cn_doc_no));
    const diffSum = mapped.reduce((s, r) => s + r.diff_total, 0);
    return {
      rows: mapped,
      summary: {
        cn_count: uniqueCn.size,
        line_count: mapped.length,
        diff_total_sum: Math.round(diffSum * 100) / 100,
      },
    };
  }

  // ──────────────────────────── 6. Save Credit Note ────────────────────────────

  /**
   * สร้าง CN — port logic 1:1 จาก NextStep CN Coupon
   *
   * Steps ทั้งหมดอยู่ใน 1 transaction:
   *   1. duplicate doc_no check
   *   2. lock source invoice header + detail (FOR UPDATE)
   *   3. validate inquiry_type compatibility กับ source
   *   4. pro-rata calculation (qty + price ratio)
   *   5. decide issueCoupon (cash inquiry + erp_option.cn_coupon_only)
   *   6. INSERT ic_trans (header)
   *   7. INSERT ic_trans_detail (lines)
   *   8. UPDATE source invoice used_status=1
   *   9. INSERT coupon_list (ถ้า issueCoupon, DELETE first)
   *  10. INSERT cb_trans (DELETE first)
   *  11. DELETE cb_trans_detail (กัน leftover)
   *  12. Self-lock CN ถ้า issueCoupon (UPDATE used_status=1 ของ CN เอง)
   *  13. INSERT ap_ar_trans_detail (DELETE first)
   */
  async saveCreditNote(
    database: string,
    payload: CreditNotePayloadDto,
  ): Promise<SaveCreditNoteResult> {
    // Filter lines ที่ qty_cn > 0 + validate
    const linesWithQty = (payload.lines || []).filter(
      (l) => Number(l.qty_cn) > 0,
    );
    if (linesWithQty.length === 0) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'กรุณาระบุจำนวนสินค้าที่ส่งคืนอย่างน้อย 1 รายการ',
      });
    }
    const requestedLines = new Map<number, CreditNoteLinePayloadDto>();
    for (const l of linesWithQty) {
      const lineNumber = Number(l.line_number);
      if (!Number.isInteger(lineNumber) || lineNumber < 0) {
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_ERROR,
          message: `เลขบรรทัดไม่ถูกต้อง: ${l.line_number}`,
        });
      }
      if (requestedLines.has(lineNumber)) {
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_ERROR,
          message: `เลขบรรทัดซ้ำ: ${lineNumber}`,
        });
      }
      requestedLines.set(lineNumber, l);
    }

    // calc_flag → stock impact (inquiry_type 0-based ใน DB)
    //   0,1,4,5 = รับคืน → +1 (เพิ่ม stock)
    //   2,3     = ลดหนี้ไม่กระทบสต๊อก → 0
    const calcFlag =
      payload.inquiry_type === 2 || payload.inquiry_type === 3 ? 0 : 1;

    const now = new Date();
    const docTime = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes(),
    ).padStart(2, '0')}`;

    return this.pool.transaction(database, async (client) => {
      // 1. duplicate check
      const dup = await client.query(
        `SELECT doc_no FROM ic_trans WHERE trans_flag = $1 AND doc_no = $2 LIMIT 1`,
        [CN_TRANS_FLAG, payload.doc_no],
      );
      if (dup.rows.length > 0) {
        throw new ConflictException({
          code: ErrorCode.DUPLICATE_DOC_NO,
          message: `เลขที่เอกสาร ${payload.doc_no} ถูกใช้แล้ว`,
        });
      }

      // 2. lock source header + detail
      const headerResult = await client.query<{
        doc_no: string;
        doc_date: Date | string;
        cust_code: string;
        vat_type: number;
        vat_rate: string;
        discount_word: string;
        inquiry_type: number;
      }>(
        `SELECT doc_no, doc_date, cust_code, vat_type, vat_rate, discount_word,
                COALESCE(inquiry_type, 0) AS inquiry_type
           FROM ic_trans
          WHERE trans_flag = $1 AND doc_no = $2 AND COALESCE(last_status, 0) = 0
          LIMIT 1
          FOR UPDATE`,
        [SALE_TRANS_FLAG, payload.ref_doc_no],
      );
      if (headerResult.rows.length === 0) {
        throw new NotFoundException({
          code: ErrorCode.NOT_FOUND,
          message: 'ไม่พบใบขายอ้างอิง',
        });
      }
      const sourceHeader = headerResult.rows[0];
      if (sourceHeader.cust_code !== payload.cust_code) {
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_ERROR,
          message: 'ลูกค้าไม่ตรงกับใบขายอ้างอิง',
        });
      }

      // 3. validate inquiry_type compatibility
      // (sale inquiry → allowed CN inquiry types)
      //   sale 0 (เงินเชื่อ)   → CN 0 (รับคืนเครดิต) / 2 (ลดหนี้เครดิต ไม่กระทบสต๊อก)
      //   sale 1 (เงินสด)      → CN 1 (รับคืนเงินสด) / 3 (ลดหนี้เงินสด)
      //   sale 2 (บริการเครดิต) → CN 4
      //   sale 3 (บริการเงินสด) → CN 5
      const allowedCnTypes: Record<number, number[]> = {
        0: [0, 2],
        1: [1, 3],
        2: [4],
        3: [5],
      };
      const allowed = allowedCnTypes[sourceHeader.inquiry_type] ?? [
        0, 1, 2, 3, 4, 5,
      ];
      if (!allowed.includes(payload.inquiry_type)) {
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_ERROR,
          message: `ประเภทการรับคืน (${payload.inquiry_type}) ไม่เข้ากับประเภทของใบขายอ้างอิง`,
        });
      }

      // lock source detail + ดึง available_qty
      const detailResult = await client.query<{
        line_number: number;
        item_code: string;
        item_name: string;
        unit_code: string;
        qty: string;
        available_qty: string;
        price: string;
        discount: string;
        discount_amount: string;
        sum_amount: string;
        sum_amount_exclude_vat: string;
        total_vat_value: string;
        wh_code: string;
        shelf_code: string;
        vat_type: number;
        item_type: number;
        set_ref_line: string;
        set_ref_price: string;
        set_ref_qty: string;
        is_permium: number;
      }>(
        `SELECT d.line_number, d.item_code, d.item_name, d.unit_code,
                d.qty,
                GREATEST(0, (
                  d.qty * (NULLIF(d.stand_value, 0) / NULLIF(d.divide_value, 0))
                  - COALESCE((
                      SELECT SUM(x.qty * (NULLIF(x.stand_value, 0) / NULLIF(x.divide_value, 0)))
                        FROM ic_trans_detail x
                       WHERE x.trans_flag = $3
                         AND x.ref_doc_no = d.doc_no
                         AND x.item_code = d.item_code
                         AND x.ref_row = d.line_number
                         AND COALESCE(x.last_status, 0) = 0
                         AND COALESCE(x.inquiry_type, 0) NOT IN (2, 3)
                    ), 0)
                ) / NULLIF(d.stand_value, 0) * NULLIF(d.divide_value, 0)
                ) AS available_qty,
                d.price, d.discount, d.discount_amount,
                d.sum_amount, d.sum_amount_exclude_vat, d.total_vat_value,
                d.wh_code, d.shelf_code, d.vat_type, d.item_type,
                d.set_ref_line, d.set_ref_price, d.set_ref_qty, d.is_permium
           FROM ic_trans_detail d
          WHERE d.trans_flag = $1
            AND d.doc_no = $2
            AND COALESCE(d.last_status, 0) = 0
          ORDER BY d.line_number
          FOR UPDATE`,
        [SALE_TRANS_FLAG, payload.ref_doc_no, CN_TRANS_FLAG],
      );

      const sourceLines = new Map(
        detailResult.rows.map((line) => [line.line_number, line]),
      );

      // 4. pro-rata calculation
      type ProRated = {
        line_number: number;
        item_code: string;
        item_name: string;
        unit_code: string;
        qty: number;
        price: number;
        discount: string;
        wh_code: string;
        shelf_code: string;
        vat_type: number;
        item_type: number;
        set_ref_line: string;
        set_ref_price: number;
        set_ref_qty: number;
        is_permium: number;
        qty_cn: number;
        cn_sum_amount: number;
        cn_sum_amount_exclude_vat: number;
        cn_total_vat_value: number;
        cn_discount_amount: number;
      };
      const prorated: ProRated[] = [];

      for (const [lineNumber, requested] of requestedLines) {
        const source = sourceLines.get(lineNumber);
        if (!source) {
          throw new BadRequestException({
            code: ErrorCode.VALIDATION_ERROR,
            message: `ไม่พบบรรทัดสินค้าในใบขายอ้างอิง: ${lineNumber}`,
          });
        }
        if (requested.item_code && requested.item_code !== source.item_code) {
          throw new BadRequestException({
            code: ErrorCode.VALIDATION_ERROR,
            message: `บรรทัด ${lineNumber}: รหัสสินค้าไม่ตรงกับใบขายอ้างอิง`,
          });
        }

        const qty = Number(source.qty) || 0;
        const availableQty = Number(source.available_qty) || 0;
        const requestedQty = Number(requested.qty_cn);
        const originalPrice = Number(source.price) || 0;
        const requestedPrice = Number(requested.price);

        if (requestedQty > availableQty) {
          throw new BadRequestException({
            code: ErrorCode.VALIDATION_ERROR,
            message: `บรรทัด ${source.item_code}: จำนวนส่งคืน (${requestedQty}) เกินจำนวนที่ส่งคืนได้ (${availableQty})`,
          });
        }
        if (requestedPrice > originalPrice) {
          throw new BadRequestException({
            code: ErrorCode.VALIDATION_ERROR,
            message: `บรรทัด ${source.item_code}: ราคา (${requestedPrice}) เกินราคาเดิม (${originalPrice})`,
          });
        }

        const qtyR = qty > 0 ? requestedQty / qty : 0;
        const priceR = originalPrice > 0 ? requestedPrice / originalPrice : 1;
        const ratio = qtyR * priceR;

        prorated.push({
          line_number: source.line_number,
          item_code: source.item_code,
          item_name: source.item_name || '',
          unit_code: source.unit_code || '',
          qty,
          price: requestedPrice,
          discount: source.discount || '',
          wh_code: source.wh_code || '',
          shelf_code: source.shelf_code || '',
          vat_type: source.vat_type ?? 0,
          item_type: source.item_type ?? 0,
          set_ref_line: source.set_ref_line || '',
          set_ref_price: Number(source.set_ref_price) || 0,
          set_ref_qty: Number(source.set_ref_qty) || 0,
          is_permium: source.is_permium ?? 0,
          qty_cn: requestedQty,
          cn_sum_amount: round2((Number(source.sum_amount) || 0) * ratio),
          cn_sum_amount_exclude_vat: round2(
            (Number(source.sum_amount_exclude_vat) || 0) * ratio,
          ),
          cn_total_vat_value: round2(
            (Number(source.total_vat_value) || 0) * ratio,
          ),
          cn_discount_amount: round2(
            (Number(source.discount_amount) || 0) * ratio,
          ),
        });
      }

      // Header totals — รวมเฉพาะ row ที่ set_ref_line='' (กัน double count ของ sub-item ในชุด)
      const headRows = prorated.filter((line) => !line.set_ref_line);
      const total_value = round2(
        headRows.reduce((sum, l) => sum + l.cn_sum_amount, 0),
      );
      const total_vat_value = round2(
        headRows.reduce((sum, l) => sum + l.cn_total_vat_value, 0),
      );
      const total_except_vat = round2(
        headRows
          .filter((l) => l.cn_total_vat_value === 0)
          .reduce((sum, l) => sum + l.cn_sum_amount, 0),
      );
      const total_before_vat = round2(
        headRows
          .filter((l) => l.cn_total_vat_value > 0)
          .reduce((sum, l) => sum + l.cn_sum_amount_exclude_vat, 0),
      );
      const total_after_vat = round2(total_before_vat + total_vat_value);
      const discountPct = parseDiscountPercent(
        sourceHeader.discount_word || '',
      );
      const overall_discount = round2(total_value * discountPct);
      const line_discount_sum = round2(
        prorated.reduce((sum, l) => sum + l.cn_discount_amount, 0),
      );
      const total_discount = round2(overall_discount + line_discount_sum);
      // ยอดสุทธิ = total_value − ส่วนลดท้ายบิล (formula ตรง — กัน rounding error สะสม)
      const total_amount = round2(total_value - overall_discount);
      const sourceDocDate = toISODate(sourceHeader.doc_date);

      // 5. decide issueCoupon (cash inquiry + erp_option.cn_coupon_only)
      let issueCoupon = false;
      const cashInquiryTypes = [1, 3, 5];
      if (cashInquiryTypes.includes(payload.inquiry_type)) {
        const optResult = await client.query<{ cn_coupon_only: number | null }>(
          `SELECT cn_coupon_only FROM erp_option LIMIT 1`,
        );
        if ((optResult.rows[0]?.cn_coupon_only ?? 0) === 1) {
          issueCoupon = true;
        }
      }

      // Self-redeem: ออกคูปอง → CN จ่ายด้วยคูปอง → ic_trans.balance=0
      // แต่ coupon ยังใช้ได้ → coupon_list.balance_amount = total_amount
      const icBalanceAmount = issueCoupon ? 0 : total_amount;
      const cashAmountInCb = issueCoupon ? 0 : total_amount;
      const couponAmountInCb = issueCoupon ? total_amount : 0;
      const totalAmountPayInCb = total_amount;

      // expire date
      const today = todayISO();
      let expireDate = payload.coupon_expire_date || addDays(today, 30);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expireDate)) {
        expireDate = addDays(today, 30);
      }
      if (issueCoupon && expireDate < today) {
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_ERROR,
          message: 'วันหมดอายุคูปองห้ามน้อยกว่าวันที่ปัจจุบัน',
        });
      }

      // 6. INSERT ic_trans (header)
      await client.query(
        `INSERT INTO ic_trans (
           trans_type, trans_flag,
           doc_date, doc_no, doc_format_code, doc_time,
           doc_ref, doc_ref_date,
           tax_doc_no, tax_doc_date,
           cust_code,
           vat_type, vat_rate,
           total_value, total_discount, total_vat_value,
           total_before_vat, total_after_vat, total_except_vat,
           total_amount, balance_amount,
           inquiry_type,
           discount_word,
           remark,
           status, last_status, used_status, used_status_2, doc_success,
           creator_code, last_editor_code
         ) VALUES (
           $1, $2,
           $3, $4, $5, $6,
           $7, $8,
           $9, $10,
           $11,
           $12, $13,
           $14, $15, $16,
           $17, $18, $19,
           $20, $21,
           $22,
           $23,
           $24,
           0, 0, 0, 0, 0,
           $25, $26
         )`,
        [
          TRANS_TYPE_AR,
          CN_TRANS_FLAG,
          payload.doc_date,
          payload.doc_no,
          CN_FORMAT_CODE,
          docTime,
          payload.ref_doc_no,
          sourceDocDate || null,
          payload.doc_no, // tax_doc_no = doc_no
          payload.doc_date, // tax_doc_date = doc_date
          sourceHeader.cust_code,
          sourceHeader.vat_type,
          Number(sourceHeader.vat_rate) || 0,
          total_value,
          total_discount,
          total_vat_value,
          total_before_vat,
          total_after_vat,
          total_except_vat,
          total_amount,
          icBalanceAmount,
          payload.inquiry_type,
          sourceHeader.discount_word || '',
          (payload.remark || '').slice(0, 200),
          APP_CREATOR_CODE,                                   // $25 creator_code — filter marker คงเดิม
          (payload.staff_name || '').slice(0, 200) || APP_CREATOR_CODE, // $26 last_editor_code — user_name ของผู้ออก CN
        ],
      );

      // 7. INSERT ic_trans_detail (lines)
      let lineNo = 0;
      for (const ln of prorated) {
        await client.query(
          `INSERT INTO ic_trans_detail (
             trans_type, trans_flag,
             doc_date, doc_no, doc_time, doc_ref,
             cust_code, line_number,
             item_code, item_name, unit_code,
             qty, price, discount,
             sum_amount, total_vat_value,
             sum_amount_exclude_vat, discount_amount,
             wh_code, shelf_code,
             vat_type, item_type,
             calc_flag,
             stand_value, divide_value,
             is_get_price, doc_ref_type,
             inquiry_type,
             set_ref_line, set_ref_price, set_ref_qty, is_permium,
             ref_doc_no, ref_doc_date, ref_line_number, ref_row,
             status, last_status,
             creator_code, last_editor_code
           ) VALUES (
             $1, $2,
             $3, $4, $5, $6,
             $7, $8,
             $9, $10, $11,
             $12, $13, $14,
             $15, $16,
             $17, $18,
             $19, $20,
             $21, $22,
             $23,
             1, 1,
             1, 1,
             $33,
             $24, $25, $26, $27,
             $28, $29, $30, $31,
             0, 0,
             $32, $32
           )`,
          [
            TRANS_TYPE_AR,
            CN_TRANS_FLAG,
            payload.doc_date,
            payload.doc_no,
            docTime,
            payload.ref_doc_no,
            sourceHeader.cust_code,
            lineNo,
            ln.item_code,
            (ln.item_name || '').slice(0, 200),
            ln.unit_code || '',
            ln.qty_cn,
            ln.price,
            ln.discount || '',
            ln.cn_sum_amount,
            ln.cn_total_vat_value,
            ln.cn_sum_amount_exclude_vat,
            ln.cn_discount_amount,
            ln.wh_code || '',
            ln.shelf_code || '',
            ln.vat_type,
            ln.item_type,
            calcFlag,
            ln.set_ref_line || '',
            ln.set_ref_price,
            ln.set_ref_qty,
            ln.is_permium,
            payload.ref_doc_no,
            sourceDocDate || null,
            ln.line_number, // ref_line_number
            ln.line_number, // ref_row (smallint)
            APP_CREATOR_CODE,
            payload.inquiry_type, // $33 inquiry_type mirror header
          ],
        );
        lineNo++;
      }

      // 8. UPDATE source invoice used_status=1
      await client.query(
        `UPDATE ic_trans
            SET used_status = 1
          WHERE trans_flag = $1
            AND doc_no = $2
            AND COALESCE(used_status, 0) <> 1`,
        [SALE_TRANS_FLAG, payload.ref_doc_no],
      );

      // 9. INSERT coupon_list (ถ้า issueCoupon)
      let coupon: {
        number: string;
        amount: number;
        expire_date: string;
      } | null = null;
      if (issueCoupon) {
        const singleUseFlag = payload.coupon_single_use === false ? 0 : 1;
        await client.query(`DELETE FROM coupon_list WHERE number = $1`, [
          payload.doc_no,
        ]);
        await client.query(
          `INSERT INTO coupon_list (
             is_lock_record, number, amount, date, date_expire,
             balance_amount, remark, single_use, coupon_type, last_status,
             cust_code
           ) VALUES (
             1, $1, $2, $3, $4,
             $2, $5, $6, 0, 0,
             $7
           )`,
          [
            payload.doc_no,
            total_amount,
            payload.doc_date,
            expireDate,
            'Coupon from CN',
            singleUseFlag,
            sourceHeader.cust_code,
          ],
        );
        coupon = {
          number: payload.doc_no,
          amount: total_amount,
          expire_date: expireDate,
        };
      }

      // 10. INSERT cb_trans
      await client.query(
        `DELETE FROM cb_trans WHERE doc_no = $1 AND trans_flag = $2`,
        [payload.doc_no, CN_TRANS_FLAG],
      );
      await client.query(
        `INSERT INTO cb_trans (
           trans_type, trans_flag,
           doc_date, doc_no, doc_time, doc_format_code,
           pay_type,
           ap_ar_code,
           total_amount, total_net_amount,
           cash_amount, coupon_amount, total_amount_pay,
           status
         ) VALUES (
           $1, $2,
           $3, $4, $5, $6,
           2,
           $7,
           $8, $9,
           $10, $11, $12,
           0
         )`,
        [
          TRANS_TYPE_AR,
          CN_TRANS_FLAG,
          payload.doc_date,
          payload.doc_no,
          docTime,
          CN_FORMAT_CODE,
          sourceHeader.cust_code,
          total_amount,
          total_amount,
          cashAmountInCb,
          couponAmountInCb,
          totalAmountPayInCb,
        ],
      );

      // 11. ลบ cb_trans_detail เก่า (กัน leftover) + 12. Self-lock CN ถ้า issueCoupon
      if (issueCoupon) {
        await client.query(
          `DELETE FROM cb_trans_detail WHERE doc_no = $1 AND trans_flag = $2`,
          [payload.doc_no, CN_TRANS_FLAG],
        );
        await client.query(
          `UPDATE ic_trans SET used_status = 1
            WHERE trans_flag = $1 AND doc_no = $2`,
          [CN_TRANS_FLAG, payload.doc_no],
        );
      }

      // 13. INSERT ap_ar_trans_detail (link CN → invoice)
      if (payload.ref_doc_no) {
        await client.query(
          `DELETE FROM ap_ar_trans_detail WHERE doc_no = $1 AND trans_flag = $2`,
          [payload.doc_no, CN_TRANS_FLAG],
        );
        await client.query(
          `INSERT INTO ap_ar_trans_detail (
             trans_type, trans_flag,
             doc_date, doc_no,
             line_number,
             billing_no, billing_date,
             sum_debt_value, sum_debt_amount, sum_debt_balance,
             sum_before_vat,
             bill_type, calc_flag,
             status, last_status
           ) VALUES (
             $1, $2,
             $3, $4,
             0,
             $5, $6,
             $7, $7, $7,
             $8,
             1, -1,
             0, 0
           )`,
          [
            TRANS_TYPE_AR,
            CN_TRANS_FLAG,
            payload.doc_date,
            payload.doc_no,
            payload.ref_doc_no,
            sourceDocDate || null,
            total_amount,
            total_before_vat,
          ],
        );
      }

      this.logger.log(
        `Created CN ${payload.doc_no} ref=${payload.ref_doc_no} total=${total_amount} coupon=${issueCoupon ? payload.doc_no : '-'}`,
      );

      return { doc_no: payload.doc_no, coupon };
    });
  }
}
