import { Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../../core/error/error-codes';
import { CreditNoteRepository } from './credit-note.repository';
import { toISODate } from './credit-note.util';
import type { CustomerOption } from './dto/customer.dto';
import type { SalesInvoiceOption } from './dto/sales-invoice.dto';
import type { InvoiceDetailResponse } from './dto/invoice-detail.dto';
import type { CouponListItem } from './dto/coupon.dto';
import type {
  PriceDiffReportResponse,
  PriceDiffRow,
} from './dto/price-diff.dto';

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
  constructor(private readonly repo: CreditNoteRepository) {}

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
  ): Promise<SalesInvoiceOption[]> {
    const code = (custCode || '').trim();
    const rows = await this.repo.listSalesInvoices(database, code || undefined);
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
    }));
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
}
