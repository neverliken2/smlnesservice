import { Injectable } from '@nestjs/common';
import { PoolManagerService } from '../../core/db/pool-manager.service';

/**
 * Read-only SQL queries สำหรับ credit-note module
 * Port จาก NextStep_CN_Coupon/src/actions/credit-note.ts + reports.ts
 *
 * trans_flag = 44 ใบขาย, 48 = Credit Note
 */

const SALE_TRANS_FLAG = 44;
const CN_TRANS_FLAG = 48;

export interface CustomerRow {
  code: string;
  name_1: string;
}

export interface SalesInvoiceRow {
  doc_no: string;
  doc_date: Date | string;
  cust_code: string;
  cust_name: string;
  total_amount: string;
  vat_type: number;
  vat_rate: string;
  discount_word: string;
  inquiry_type: number;
}

export interface InvoiceHeaderRow {
  doc_no: string;
  doc_date: Date | string;
  cust_code: string;
  total_amount: string;
  vat_type: number;
  vat_rate: string;
  discount_word: string;
  inquiry_type: number;
}

export interface InvoiceLineRow {
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
}

export interface DocFormatRow {
  format: string;
}

export interface LastDocNoRow {
  doc_no: string;
}

export interface CouponListRow {
  number: string;
  cust_code: string;
  cust_name: string;
  ref_doc_no: string;
  doc_date: Date | string;
  amount: string | number;
  balance_amount: string | number;
  date_expire: Date | string;
  single_use: number;
}

export interface PriceDiffRawRow {
  cn_doc_no: string;
  cn_date: Date;
  item_code: string;
  item_name: string;
  qty: string;
  original_price: string;
  adjusted_price: string;
  diff_per_unit: string;
  diff_total: string;
  source_invoice: string;
}

@Injectable()
export class CreditNoteRepository {
  constructor(private readonly pool: PoolManagerService) {}

  // ──────────────────────────── Customers ────────────────────────────

  async searchCustomers(
    database: string,
    query: string,
  ): Promise<CustomerRow[]> {
    const like = `%${query}%`;
    const result = await this.pool.query<CustomerRow>(
      database,
      `SELECT code, name_1
         FROM ar_customer
        WHERE (code ILIKE $1 OR name_1 ILIKE $1)
          AND COALESCE(status, 0) = 0
        ORDER BY code
        LIMIT 50`,
      [like],
      { timeout: 10_000 },
    );
    return result.rows;
  }

  // ──────────────────────────── Sales Invoices ────────────────────────────

  async listSalesInvoices(
    database: string,
    custCode: string | undefined,
  ): Promise<SalesInvoiceRow[]> {
    const params: (string | number)[] = [SALE_TRANS_FLAG];
    const where: string[] = [
      `t.trans_flag = $1`,
      `COALESCE(t.last_status, 0) = 0`,
    ];
    if (custCode) {
      params.push(custCode);
      where.push(`t.cust_code = $${params.length}`);
    }

    const result = await this.pool.query<SalesInvoiceRow>(
      database,
      `SELECT t.doc_no, t.doc_date, t.cust_code,
              COALESCE(c.name_1, '') AS cust_name,
              t.total_amount, t.vat_type, t.vat_rate, t.discount_word, t.inquiry_type
         FROM ic_trans t
         LEFT JOIN ar_customer c ON c.code = t.cust_code
        WHERE ${where.join(' AND ')}
        ORDER BY t.doc_date DESC, t.doc_no DESC
        LIMIT 100`,
      params,
      { timeout: 15_000 },
    );
    return result.rows;
  }

  // ──────────────────────────── Invoice Detail ────────────────────────────

  async findInvoiceHeader(
    database: string,
    docNo: string,
  ): Promise<InvoiceHeaderRow | null> {
    const result = await this.pool.query<InvoiceHeaderRow>(
      database,
      `SELECT doc_no, doc_date, cust_code, total_amount,
              vat_type, vat_rate, discount_word, inquiry_type
         FROM ic_trans
        WHERE trans_flag = $1
          AND doc_no = $2
          AND COALESCE(last_status, 0) = 0
        LIMIT 1`,
      [SALE_TRANS_FLAG, docNo],
      { timeout: 10_000 },
    );
    return result.rows[0] ?? null;
  }

  /**
   * Detail พร้อม available_qty (qty ที่ยังส่งคืนได้ — หัก CN เก่าแล้ว)
   *
   * สูตร mirror SMLERP22 _qtyRemainQuery() (SMLInventoryControl/_icTransItemGridControl.cs:3185-3215):
   *   (qty * stand/divide - SUM(CN.qty * stand/divide)) / stand * divide
   *
   * Subquery: trans_flag=48 CN, ref_doc_no=invoice, item_code match, ref_row=line_number,
   *           last_status=0, inquiry_type NOT IN (2,3) (ไม่นับ "ลดหนี้ไม่กระทบสต๊อก")
   */
  async findInvoiceLines(
    database: string,
    docNo: string,
  ): Promise<InvoiceLineRow[]> {
    const result = await this.pool.query<InvoiceLineRow>(
      database,
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
        ORDER BY d.line_number`,
      [SALE_TRANS_FLAG, docNo, CN_TRANS_FLAG],
      { timeout: 15_000 },
    );
    return result.rows;
  }

  // ──────────────────────────── Doc Format ────────────────────────────

  async findDocFormat(
    database: string,
    code: string,
  ): Promise<DocFormatRow | null> {
    const result = await this.pool.query<DocFormatRow>(
      database,
      `SELECT format FROM erp_doc_format WHERE code = $1 LIMIT 1`,
      [code],
      { timeout: 5_000 },
    );
    return result.rows[0] ?? null;
  }

  async findLastDocNo(
    database: string,
    formatCode: string,
    pgPattern: string,
  ): Promise<LastDocNoRow | null> {
    const result = await this.pool.query<LastDocNoRow>(
      database,
      `SELECT doc_no
         FROM ic_trans
        WHERE trans_flag = $1
          AND doc_format_code = $2
          AND doc_no ~ $3
        ORDER BY doc_no DESC
        LIMIT 1`,
      [CN_TRANS_FLAG, formatCode, pgPattern],
      { timeout: 10_000 },
    );
    return result.rows[0] ?? null;
  }

  // ──────────────────────────── Web Coupons ────────────────────────────

  async listWebCoupons(
    database: string,
    appCreatorCode: string,
    options: {
      limit: number;
      query: string;
      fromDate: string;
      toDate: string;
    },
  ): Promise<CouponListRow[]> {
    const params: (string | number)[] = [
      CN_TRANS_FLAG,
      options.limit,
      appCreatorCode,
    ];
    const where: string[] = [
      `t.creator_code = $3`,
      `COALESCE(cp.last_status, 0) = 0`,
      `COALESCE(t.last_status, 0) = 0`,
    ];

    if (options.query) {
      params.push(`%${options.query}%`);
      const i = params.length;
      where.push(
        `(t.doc_no ILIKE $${i} OR t.cust_code ILIKE $${i} OR c.name_1 ILIKE $${i} OR t.doc_ref ILIKE $${i})`,
      );
    }
    if (options.fromDate) {
      params.push(options.fromDate);
      where.push(`t.doc_date >= $${params.length}::date`);
    }
    if (options.toDate) {
      params.push(options.toDate);
      where.push(`t.doc_date <= $${params.length}::date`);
    }

    const sql = `
      SELECT
        t.doc_no              AS number,
        t.cust_code,
        COALESCE(c.name_1, '') AS cust_name,
        COALESCE(t.doc_ref, '') AS ref_doc_no,
        t.doc_date,
        cp.amount,
        cp.balance_amount,
        cp.date_expire,
        COALESCE(cp.single_use, 1) AS single_use
        FROM coupon_list cp
        INNER JOIN ic_trans t
          ON t.doc_no = cp.number
         AND t.trans_flag = $1
        LEFT JOIN ar_customer c ON c.code = t.cust_code
       WHERE ${where.join(' AND ')}
       ORDER BY t.doc_date DESC, t.doc_no DESC
       LIMIT $2
    `;
    const result = await this.pool.query<CouponListRow>(database, sql, params, {
      timeout: 15_000,
    });
    return result.rows;
  }

  // ──────────────────────────── Reports ────────────────────────────

  async getCnPriceDiff(
    database: string,
    fromDate: string,
    toDate: string,
  ): Promise<PriceDiffRawRow[]> {
    const result = await this.pool.query<PriceDiffRawRow>(
      database,
      `SELECT
         cn.doc_no AS cn_doc_no,
         cn.doc_date AS cn_date,
         cn.item_code,
         cn.item_name,
         cn.qty,
         inv.price AS original_price,
         cn.price AS adjusted_price,
         (inv.price - cn.price) AS diff_per_unit,
         ROUND(((inv.price - cn.price) * cn.qty)::numeric, 2) AS diff_total,
         cn.ref_doc_no AS source_invoice
         FROM ic_trans_detail cn
         JOIN ic_trans_detail inv
           ON inv.trans_flag = $1
          AND inv.doc_no = cn.ref_doc_no
          AND inv.line_number = cn.ref_row
          AND inv.item_code = cn.item_code
        WHERE cn.trans_flag = $2
          AND COALESCE(cn.last_status, 0) = 0
          AND COALESCE(inv.last_status, 0) = 0
          AND cn.price <> inv.price
          AND cn.doc_date BETWEEN $3::date AND $4::date
        ORDER BY cn.doc_date DESC, cn.doc_no DESC, cn.line_number
        LIMIT 500`,
      [SALE_TRANS_FLAG, CN_TRANS_FLAG, fromDate, toDate],
      { timeout: 30_000, isReport: true },
    );
    return result.rows;
  }
}
