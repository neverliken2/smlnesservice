import { Injectable } from '@nestjs/common';
import { PoolManagerService } from '../../core/db/pool-manager.service';
import type {
  StockBalanceQuery,
  StockBalanceRow,
} from './dto/stock-balance.dto';
import type {
  LatestPurchase,
  LatestSale,
} from './dto/product-transactions.dto';
import type {
  ReorderPointQuery,
  ReorderPointRow,
} from './dto/reorder-point.dto';
import type {
  ProfitProductQuery,
  ProfitProductRow,
  ProfitProductTotals,
} from './dto/profit-product.dto';
import type { BankBalance, BankTransaction } from './dto/bank-statement.dto';
import type { ArMovementRow } from './dto/ar-movement.dto';
import type { ApMovementRow } from './dto/ap-movement.dto';

export interface ApOpenInvoiceRow {
  vend_code: string;
  vend_name: string | null;
  doc_no: string;
  doc_date: string;
  due_date: string | null;
  doc_type: number;
  ref_doc_no: string;
  ref_doc_date: string | null;
  total_amount: number;
  balance_amount: number;
}

export interface ArOpenInvoiceRow {
  cust_code: string;
  cust_name: string | null;
  doc_no: string;
  doc_date: string;
  due_date: string | null;
  doc_type: number;
  ref_doc_no: string;
  ref_doc_date: string | null;
  total_amount: number;
  balance_amount: number;
}

interface BankBookRawRow {
  code: string;
  name: string;
  book_number: string;
  bank_code: string;
  bank_branch: string;
}

interface BankRefRow {
  code: string;
  name: string;
}

interface BankBranchRawRow {
  code: string;
  name: string;
  bank_code: string;
}

export interface DailySalesAggregateRow {
  /** ISO date หรือ 'YYYY-MM' */
  period: string;
  net_sales: number;
  net_cost: number;
}

export interface SalesAggregateRow {
  total_sales: number;
  total_cost: number;
}

export interface StockMovementDbRow {
  doc_date: string;
  doc_time: string | null;
  trans_flag: number;
  doc_no: string;
  warehouse: string | null;
  shelf_code: string | null;
  unit_code: string | null;
  qty_in: number;
  amount_in: number;
  qty_out: number;
  amount_out: number;
}

export interface StockMovementBeginRow {
  begin_qty: number;
  begin_amount: number;
}

/**
 * Dashboard Repository — raw SQL via PoolManagerService
 *
 * Source ของ SQL: nextstep_dashboard/src/app/api/report/*\/route.ts
 *
 * Convention:
 *   - method ละ 1 query (read-only)
 *   - คืน raw row interface (business logic อยู่ใน service)
 *   - ใช้ { isReport: true } → 60s timeout
 */
@Injectable()
export class DashboardRepository {
  constructor(private readonly pool: PoolManagerService) {}

  // ──────────────────────────── Sales Overview ────────────────────────────

  /**
   * Aggregate ic_trans_detail สำหรับ sales-overview
   *
   * trans_flag: 44=ขายเชื่อ, 46=ขายสด (เพิ่ม inquiry_type IN (0,2)), 48=รับคืน
   * ไม่นับ item_type 3, 5
   */
  async getSalesAggregate(
    database: string,
    transFlag: 44 | 46 | 48,
    fromDate: string,
    toDate: string,
    branch?: string,
    warehouse?: string,
  ): Promise<SalesAggregateRow> {
    const params: (string | number)[] = [fromDate, toDate];
    const conds: string[] = [];

    if (branch) {
      params.push(branch);
      conds.push(`AND branch_code = $${params.length}`);
    }
    if (warehouse) {
      params.push(warehouse);
      conds.push(`AND warehouse_code = $${params.length}`);
    }

    const inquiryFilter = transFlag === 46 ? 'AND inquiry_type IN (0, 2)' : '';

    const sql = `
      SELECT
        COALESCE(SUM(sum_amount_exclude_vat), 0)::float8 AS total_sales,
        COALESCE(SUM(sum_of_cost), 0)::float8           AS total_cost
      FROM ic_trans_detail
      WHERE last_status = 0
        AND doc_date BETWEEN $1 AND $2
        AND trans_flag = ${transFlag}
        ${inquiryFilter}
        AND item_type NOT IN (3, 5)
        ${conds.join('\n        ')}
    `;

    const result = await this.pool.query<SalesAggregateRow>(
      database,
      sql,
      params,
      { isReport: true },
    );

    return result.rows[0] ?? { total_sales: 0, total_cost: 0 };
  }

  // ──────────────────────────── Stock Balance ────────────────────────────

  /**
   * Stock balance รวมต่อสินค้า — มี 4 subquery (qty_in, amount_in, qty_out, amount_out)
   * + current_avg_cost จาก purchase ล่าสุด (trans_flag 12/310)
   *
   * SQL port มาจาก nextstep_dashboard sales-balance route แทบ 1:1
   * Business logic (avg_cost, balance_amount) อยู่ใน service
   */
  async getStockBalance(
    database: string,
    q: StockBalanceQuery,
  ): Promise<
    Omit<
      StockBalanceRow,
      'avg_cost_in' | 'avg_cost_out' | 'avg_cost' | 'balance_amount'
    >[]
  > {
    const params: (string | number)[] = [];
    const inventoryConds: string[] = [
      'ic_inventory.item_type NOT IN (1, 3, 5)',
    ];

    if (q.icCodeList) {
      const codes = q.icCodeList
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      if (codes.length > 0) {
        const placeholders = codes
          .map((_, i) => `$${params.length + 1 + i}`)
          .join(',');
        inventoryConds.push(`ic_inventory.code IN (${placeholders})`);
        params.push(...codes);
      }
    }

    if (q.icCodeRanges) {
      const ranges = q.icCodeRanges
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean);
      const rangeConds: string[] = [];
      for (const range of ranges) {
        const [from, to] = range.split(':').map((r) => r.trim());
        if (from && to) {
          rangeConds.push(
            `(ic_inventory.code >= $${params.length + 1} AND ic_inventory.code <= $${params.length + 2})`,
          );
          params.push(from, to);
        }
      }
      if (rangeConds.length > 0) {
        inventoryConds.push(`(${rangeConds.join(' OR ')})`);
      }
    }

    // Schema (DB ใหม่): group_main / group_sub (source code Dashboard ใช้ group_code/group_sub_code ที่ไม่มี)
    if (q.mainGroup) {
      params.push(q.mainGroup);
      inventoryConds.push(`ic_inventory.group_main = $${params.length}`);
    }

    if (q.subGroup) {
      params.push(q.subGroup);
      inventoryConds.push(`ic_inventory.group_sub = $${params.length}`);
    }

    let dateCondition = 't.last_status = 0 AND t.item_type <> 5';
    if (q.fromDate) {
      params.push(q.fromDate);
      dateCondition += ` AND t.doc_date >= $${params.length}`;
    }
    if (q.toDate) {
      params.push(q.toDate);
      dateCondition += ` AND t.doc_date <= $${params.length}`;
    }

    const sql = `
      SELECT
        ic_inventory.code AS ic_code,
        ic_inventory.name_1 AS ic_name,
        ic_inventory.unit_standard AS ic_unit_code,
        COALESCE(ic_inventory.balance_qty, 0)::float8 AS balance_qty,
        COALESCE((
          SELECT SUM(CASE WHEN t.doc_date_calc >= '2018-10-01' AND (
            t.trans_flag IN (70, 54, 60, 58, 310, 12)
            OR (t.trans_flag = 66 AND t.qty > 0)
            OR (t.trans_flag = 14 AND t.inquiry_type = 0)
            OR (t.trans_flag = 48 AND t.inquiry_type < 2)
          ) THEN t.calc_flag * (t.qty * (t.stand_value / t.divide_value)) ELSE 0 END)
          FROM ic_trans_detail t
          WHERE t.item_code = ic_inventory.code AND ${dateCondition}
        ), 0)::float8 AS qty_in,
        COALESCE((
          SELECT SUM(CASE WHEN t.doc_date_calc >= '2018-10-01' AND (
            t.trans_flag IN (70, 54, 60, 58, 310, 12)
            OR (t.trans_flag = 66 AND (t.qty > 0 OR t.sum_of_cost > 0))
            OR t.trans_flag = 14
            OR (t.trans_flag = 48 AND t.inquiry_type < 2)
          ) THEN ((t.calc_flag * t.sum_of_cost) + COALESCE(t.profit_lost_cost_amount, 0)) ELSE 0 END)
          FROM ic_trans_detail t
          WHERE t.item_code = ic_inventory.code AND ${dateCondition}
        ), 0)::float8 AS amount_in,
        COALESCE((
          SELECT SUM(CASE WHEN t.doc_date_calc >= '2018-10-01' AND (
            t.trans_flag IN (56, 68, 72, 44)
            OR (t.trans_flag = 66 AND t.qty < 0)
            OR (t.trans_flag = 46 AND t.inquiry_type IN (0, 2))
            OR (t.trans_flag = 16 AND t.inquiry_type IN (0, 2))
            OR (t.trans_flag = 311 AND t.inquiry_type = 0)
          ) AND NOT (t.doc_ref <> '' AND t.is_pos = 1)
          THEN ABS(t.calc_flag * t.qty * (t.stand_value / t.divide_value)) ELSE 0 END)
          FROM ic_trans_detail t
          WHERE t.item_code = ic_inventory.code AND ${dateCondition}
        ), 0)::float8 AS qty_out,
        COALESCE((
          SELECT SUM(CASE WHEN t.doc_date_calc >= '2018-10-01' AND (
            t.trans_flag IN (56, 68, 72, 44)
            OR (t.trans_flag = 66 AND (t.qty < 0 OR t.sum_of_cost < 0))
            OR t.trans_flag = 46
            OR t.trans_flag = 16
            OR t.trans_flag = 311
          ) AND NOT (t.doc_ref <> '' AND t.is_pos = 1)
          THEN ABS(((CASE WHEN t.trans_flag = 66 AND t.qty < 0 THEN -1 ELSE t.calc_flag END) * t.sum_of_cost) + COALESCE(t.profit_lost_cost_amount, 0)) ELSE 0 END)
          FROM ic_trans_detail t
          WHERE t.item_code = ic_inventory.code AND ${dateCondition}
        ), 0)::float8 AS amount_out,
        COALESCE((
          SELECT t2.price FROM ic_trans_detail t2
          WHERE t2.item_code = ic_inventory.code
            AND t2.trans_flag IN (12, 310)
            AND t2.last_status = 0
          ORDER BY t2.doc_date DESC LIMIT 1
        ), 0)::float8 AS current_avg_cost
      FROM ic_inventory
      WHERE ${inventoryConds.join(' AND ')}
      ORDER BY ic_inventory.code
      LIMIT 2000
    `;

    const result = await this.pool.query<
      Omit<
        StockBalanceRow,
        'avg_cost_in' | 'avg_cost_out' | 'avg_cost' | 'balance_amount'
      >
    >(database, sql, params, { isReport: true });

    return result.rows;
  }

  // ──────────────────────────── Product Transactions ────────────────────────────

  async getLatestPurchases(
    database: string,
    productCode: string,
  ): Promise<LatestPurchase[]> {
    // Schema note (verified 2026-06-19 บน DB ใหม่ 10.121.20.83):
    //   - branch table = erp_branch_list (เก่าเป็น cm_branch)
    //   - supplier/customer code ของ trans_detail = cust_code (เก่าเป็น ref_code)
    //   - ไม่มี zone_code ที่ detail level — return '' แทน
    //   - doc_time เป็น varchar แล้ว ไม่ต้อง TO_CHAR
    const sql = `
      SELECT
        TO_CHAR(t.doc_date, 'DD Mon YYYY') AS doc_date,
        COALESCE(t.doc_time, '') AS doc_time,
        t.doc_no,
        COALESCE(t.branch_code, '000') AS branch_code,
        COALESCE(b.name_1, '(undefined)') AS branch_name,
        COALESCE(t.cust_code, '') AS supplier_code,
        COALESCE(s.name_1, '') AS supplier_name,
        COALESCE(t.wh_code, '01') AS warehouse_code,
        '' AS area_code,
        COALESCE(t.qty * (t.stand_value / NULLIF(t.divide_value, 0)), t.qty)::float8 AS qty,
        COALESCE(t.unit_code, '') AS unit_name,
        0::float8 AS discount,
        COALESCE(t.qty * t.price, 0)::float8 AS amount
      FROM ic_trans_detail t
      LEFT JOIN erp_branch_list b ON t.branch_code = b.code
      LEFT JOIN ap_supplier s ON t.cust_code = s.code
      WHERE t.item_code = $1
        AND t.trans_flag IN (12, 310)
        AND t.last_status = 0
      ORDER BY t.doc_date DESC, t.doc_no DESC
      LIMIT 10
    `;

    const result = await this.pool.query<LatestPurchase>(
      database,
      sql,
      [productCode],
      { isReport: true },
    );
    return result.rows;
  }

  async getLatestSales(
    database: string,
    productCode: string,
  ): Promise<LatestSale[]> {
    const sql = `
      SELECT
        TO_CHAR(t.doc_date, 'DD Mon YYYY') AS doc_date,
        COALESCE(t.doc_time, '') AS doc_time,
        t.doc_no,
        COALESCE(t.branch_code, '') AS branch_code,
        COALESCE(b.name_1, '(undefined)') AS branch_name,
        COALESCE(t.cust_code, '') AS customer_code,
        COALESCE(c.name_1, '') AS customer_name,
        COALESCE(t.wh_code, '01') AS warehouse_code,
        '' AS area_code,
        COALESCE(t.qty * (t.stand_value / NULLIF(t.divide_value, 0)), t.qty)::float8 AS qty,
        COALESCE(t.unit_code, '') AS unit_name,
        0::float8 AS discount,
        COALESCE(t.qty * t.price, 0)::float8 AS amount
      FROM ic_trans_detail t
      LEFT JOIN erp_branch_list b ON t.branch_code = b.code
      LEFT JOIN ar_customer c ON t.cust_code = c.code
      WHERE t.item_code = $1
        AND t.trans_flag IN (44)
        AND t.last_status = 0
      ORDER BY t.doc_date DESC, t.doc_no DESC
      LIMIT 10
    `;

    const result = await this.pool.query<LatestSale>(
      database,
      sql,
      [productCode],
      { isReport: true },
    );
    return result.rows;
  }

  // ──────────────────────────── Stock Movement ────────────────────────────

  /**
   * Stock movement detail ของสินค้าตัวเดียว — เรียง doc_date/doc_time/doc_no
   * Service จะคำนวณ running_balance, running_amount, trans_type ทีหลัง
   */
  async getStockMovementRows(
    database: string,
    productCode: string,
    fromDate?: string,
    toDate?: string,
  ): Promise<StockMovementDbRow[]> {
    const params: (string | number)[] = [productCode];
    const conds = [
      'ic_trans_detail.last_status = 0',
      'ic_trans_detail.item_type <> 5',
      'ic_trans_detail.item_code = $1',
    ];

    if (fromDate) {
      params.push(fromDate);
      conds.push(`doc_date_calc >= $${params.length}`);
    }
    if (toDate) {
      params.push(toDate);
      conds.push(`doc_date_calc <= $${params.length}`);
    }

    const sql = `
      SELECT
        TO_CHAR(doc_date, 'YYYY-MM-DD') AS doc_date,
        COALESCE(doc_time, '') AS doc_time,
        trans_flag,
        doc_no,
        wh_code AS warehouse,
        shelf_code,
        (SELECT unit_standard FROM ic_inventory WHERE ic_inventory.code = ic_trans_detail.item_code LIMIT 1) AS unit_code,
        (CASE WHEN doc_date_calc >= '2018-10-01' AND (
          trans_flag IN (70, 54, 60, 58, 310, 12)
          OR (trans_flag = 66 AND qty > 0)
          OR (trans_flag = 14 AND inquiry_type = 0)
          OR (trans_flag = 48 AND inquiry_type < 2)
        ) THEN calc_flag * (qty * (stand_value / divide_value)) ELSE 0 END)::float8 AS qty_in,
        (CASE WHEN doc_date_calc >= '2018-10-01' AND (
          trans_flag IN (70, 54, 60, 58, 310, 12)
          OR (trans_flag = 66 AND (qty > 0 OR sum_of_cost > 0))
          OR trans_flag = 14
          OR (trans_flag = 48 AND inquiry_type < 2)
        ) THEN ((calc_flag * sum_of_cost) + COALESCE(profit_lost_cost_amount, 0)) ELSE 0 END)::float8 AS amount_in,
        (CASE WHEN doc_date_calc >= '2018-10-01' AND (
          trans_flag IN (56, 68, 72, 44)
          OR (trans_flag = 66 AND qty < 0)
          OR (trans_flag = 46 AND inquiry_type IN (0, 2))
          OR (trans_flag = 16 AND inquiry_type IN (0, 2))
          OR (trans_flag = 311 AND inquiry_type = 0)
        ) AND NOT (ic_trans_detail.doc_ref <> '' AND ic_trans_detail.is_pos = 1)
        THEN ABS(calc_flag * qty * (stand_value / divide_value)) ELSE 0 END)::float8 AS qty_out,
        (CASE WHEN doc_date_calc >= '2018-10-01' AND (
          trans_flag IN (56, 68, 72, 44)
          OR (trans_flag = 66 AND (qty < 0 OR sum_of_cost < 0))
          OR trans_flag = 46
          OR trans_flag = 16
          OR trans_flag = 311
        ) AND NOT (ic_trans_detail.doc_ref <> '' AND ic_trans_detail.is_pos = 1)
        THEN ABS(((CASE WHEN trans_flag = 66 AND qty < 0 THEN -1 ELSE calc_flag END) * sum_of_cost) + COALESCE(profit_lost_cost_amount, 0)) ELSE 0 END)::float8 AS amount_out
      FROM ic_trans_detail
      WHERE ${conds.join(' AND ')}
      ORDER BY doc_date, doc_time, doc_no
      LIMIT 500
    `;

    const result = await this.pool.query<StockMovementDbRow>(
      database,
      sql,
      params,
      { isReport: true },
    );
    return result.rows;
  }

  /**
   * Beginning balance ก่อน fromDate — รวม qty_in - qty_out ทั้งหมดก่อนช่วง
   */
  async getStockMovementBegin(
    database: string,
    productCode: string,
    fromDate: string,
  ): Promise<StockMovementBeginRow> {
    const sql = `
      SELECT
        COALESCE(SUM(
          CASE WHEN (
            trans_flag IN (70, 54, 60, 58, 310, 12)
            OR (trans_flag = 66 AND qty > 0)
            OR (trans_flag = 14 AND inquiry_type = 0)
            OR (trans_flag = 48 AND inquiry_type < 2)
          ) THEN calc_flag * (qty * (stand_value / divide_value))
          WHEN (
            trans_flag IN (56, 68, 72, 44)
            OR (trans_flag = 66 AND qty < 0)
            OR (trans_flag = 46 AND inquiry_type IN (0, 2))
            OR (trans_flag = 16 AND inquiry_type IN (0, 2))
            OR (trans_flag = 311 AND inquiry_type = 0)
          ) AND NOT (doc_ref <> '' AND is_pos = 1)
          THEN -ABS(calc_flag * qty * (stand_value / divide_value))
          ELSE 0 END
        ), 0)::float8 AS begin_qty,
        COALESCE(SUM(
          CASE WHEN (
            trans_flag IN (70, 54, 60, 58, 310, 12)
            OR (trans_flag = 66 AND (qty > 0 OR sum_of_cost > 0))
            OR trans_flag = 14
            OR (trans_flag = 48 AND inquiry_type < 2)
          ) THEN ((calc_flag * sum_of_cost) + COALESCE(profit_lost_cost_amount, 0))
          WHEN (
            trans_flag IN (56, 68, 72, 44)
            OR (trans_flag = 66 AND (qty < 0 OR sum_of_cost < 0))
            OR trans_flag = 46
            OR trans_flag = 16
            OR trans_flag = 311
          ) AND NOT (doc_ref <> '' AND is_pos = 1)
          THEN -ABS(((CASE WHEN trans_flag = 66 AND qty < 0 THEN -1 ELSE calc_flag END) * sum_of_cost) + COALESCE(profit_lost_cost_amount, 0))
          ELSE 0 END
        ), 0)::float8 AS begin_amount
      FROM ic_trans_detail
      WHERE last_status = 0
        AND item_type <> 5
        AND item_code = $1
        AND doc_date_calc < $2
    `;

    const result = await this.pool.query<StockMovementBeginRow>(
      database,
      sql,
      [productCode, fromDate],
      { isReport: true },
    );

    return result.rows[0] ?? { begin_qty: 0, begin_amount: 0 };
  }

  // ──────────────────────────── Reorder Point ────────────────────────────

  /**
   * Reorder point — สินค้าที่ balance_qty < purchase_point
   *
   * ใช้ stored function `sml_ic_function_stock_balance(toDate, icCodeList)`
   * + subquery หา purchase_point/minimum/maximum + last purchase + sale ratio
   *
   * Source: nextstep_dashboard reorder-point/route.ts (port 1:1)
   */
  async getReorderPoints(
    database: string,
    q: ReorderPointQuery,
  ): Promise<ReorderPointRow[]> {
    // Date used as $1/$2 ใน subquery — ห้ามเป็น empty string (PG cast error)
    // ถ้าไม่ระบุ ใช้ sentinel range ที่ครอบทุก data
    const fromDate = q.fromDate ?? '1900-01-01';
    const toDate = q.toDate ?? '2100-12-31';
    const icCodeListRaw = q.icCodeList ?? '';

    const params: (string | number)[] = [fromDate, toDate, icCodeListRaw];
    const filterConds: string[] = [];

    if (q.icCodeList) {
      const codes = q.icCodeList
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      if (codes.length > 0) {
        const placeholders = codes
          .map((_, i) => `$${params.length + 1 + i}`)
          .join(',');
        filterConds.push(`ic_code IN (${placeholders})`);
        params.push(...codes);
      }
    }

    if (q.icCodeRanges) {
      const ranges = q.icCodeRanges
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean);
      const rangeConds: string[] = [];
      for (const range of ranges) {
        const [from, to] = range.split(':').map((r) => r.trim());
        if (from && to) {
          rangeConds.push(
            `(ic_code >= $${params.length + 1} AND ic_code <= $${params.length + 2})`,
          );
          params.push(from, to);
        }
      }
      if (rangeConds.length > 0) {
        filterConds.push(`(${rangeConds.join(' OR ')})`);
      }
    }

    let productFilter = 'WHERE balance_qty < purchase_point';
    if (filterConds.length > 0) {
      productFilter += ` AND (${filterConds.join(' OR ')})`;
    }

    const sql = `
      SELECT
        ic_code,
        ic_name,
        ic_unit_code,
        balance_qty,
        purchase_point,
        minimum_qty,
        maximum_qty,
        last_purchase_date,
        average_cost_end,
        last_purchase_qty,
        purchase_amount,
        sale_amount,
        CASE WHEN balance_qty < purchase_point THEN maximum_qty - balance_qty ELSE 0 END AS forecast_purchase
      FROM (
        SELECT
          ic_code,
          ic_name,
          ic_unit_code,
          balance_qty::float8 AS balance_qty,
          (SELECT purchase_point FROM ic_inventory_detail WHERE ic_inventory_detail.ic_code = temp1.ic_code)::float8 AS purchase_point,
          (SELECT minimum_qty FROM ic_inventory_detail WHERE ic_inventory_detail.ic_code = temp1.ic_code)::float8 AS minimum_qty,
          (SELECT maximum_qty FROM ic_inventory_detail WHERE ic_inventory_detail.ic_code = temp1.ic_code)::float8 AS maximum_qty,
          (SELECT TO_CHAR(doc_date, 'YYYY-MM-DD') FROM ic_trans_detail WHERE ic_trans_detail.item_code = temp1.ic_code AND trans_flag IN (12,310) AND last_status = 0 ORDER BY doc_date DESC LIMIT 1) AS last_purchase_date,
          (SELECT price FROM ic_trans_detail WHERE ic_trans_detail.item_code = temp1.ic_code AND trans_flag IN (12,310) AND last_status = 0 ORDER BY doc_date DESC LIMIT 1)::float8 AS average_cost_end,
          COALESCE((SELECT qty * (stand_value / divide_value) FROM ic_trans_detail WHERE ic_trans_detail.item_code = temp1.ic_code AND trans_flag IN (12,310) AND last_status = 0 ORDER BY doc_date DESC LIMIT 1), 0)::float8 AS last_purchase_qty,
          COALESCE((SELECT SUM(qty * (stand_value / divide_value)) FROM ic_trans_detail WHERE item_code = ic_code AND trans_flag IN (12,310) AND last_status = 0 AND doc_date BETWEEN $1 AND $2), 0)::float8 AS purchase_amount,
          (COALESCE((SELECT SUM(qty * (stand_value / divide_value)) FROM ic_trans_detail WHERE item_code = ic_code AND trans_flag IN (44) AND last_status = 0 AND doc_date BETWEEN $1 AND $2), 0)
           - COALESCE((SELECT SUM(qty * (stand_value / divide_value)) FROM ic_trans_detail WHERE item_code = ic_code AND trans_flag IN (48) AND last_status = 0 AND doc_date BETWEEN $1 AND $2), 0))::float8 AS sale_amount
        FROM sml_ic_function_stock_balance($2, $3) AS temp1
      ) AS temp2
      ${productFilter}
      ORDER BY ic_code
    `;

    const result = await this.pool.query<ReorderPointRow>(
      database,
      sql,
      params,
      { isReport: true },
    );
    return result.rows;
  }

  // ──────────────────────────── Profit Product ────────────────────────────

  /**
   * Profit per product — sale/cost ต่อสินค้า + paginate
   *
   * Source SQL: nextstep_dashboard profit-product/route.ts (port + group_main/sub naming fix)
   * Build base query แล้วใช้ซ้ำ 3 ครั้ง (count, paginated rows, totals)
   */
  async getProfitProducts(
    database: string,
    q: ProfitProductQuery,
  ): Promise<{
    rows: ProfitProductRow[];
    totalRecords: number;
    totals: ProfitProductTotals;
  }> {
    const startDate = q.startDate ?? '2022-12-18';
    const endDate = q.endDate ?? '2025-12-18';
    const params: (string | number)[] = [startDate, endDate];
    const conds: string[] = ['item_type <> 5'];

    if (q.productCodeFrom && q.productCodeTo) {
      conds.push(
        `code >= $${params.length + 1} AND code <= $${params.length + 2}`,
      );
      params.push(q.productCodeFrom, q.productCodeTo);
    } else if (q.productCodeFrom) {
      params.push(q.productCodeFrom);
      conds.push(`code >= $${params.length}`);
    } else if (q.productCodeTo) {
      params.push(q.productCodeTo);
      conds.push(`code <= $${params.length}`);
    }

    if (q.productRanges) {
      try {
        const ranges = JSON.parse(q.productRanges) as {
          from: string;
          to: string;
        }[];
        if (Array.isArray(ranges) && ranges.length > 0) {
          const rangeConds: string[] = [];
          for (const r of ranges) {
            if (typeof r?.from === 'string' && typeof r?.to === 'string') {
              rangeConds.push(
                `(code >= $${params.length + 1} AND code <= $${params.length + 2})`,
              );
              params.push(r.from, r.to);
            }
          }
          if (rangeConds.length > 0) {
            conds.push(`(${rangeConds.join(' OR ')})`);
          }
        }
      } catch {
        /* ignore invalid JSON */
      }
    }

    if (q.selectedProducts) {
      const codes = q.selectedProducts
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      if (codes.length > 0) {
        const ph = codes.map((_, i) => `$${params.length + 1 + i}`).join(', ');
        conds.push(`code IN (${ph})`);
        params.push(...codes);
      }
    }

    const ilikePushers: [string | undefined, string][] = [
      [q.productCode, '(code ILIKE $X OR name_1 ILIKE $X)'],
      [q.brand, 'item_brand ILIKE $X'],
      [q.productClass, 'item_class ILIKE $X'],
      [q.productSize, 'item_size ILIKE $X'],
      [q.productColor, 'item_color ILIKE $X'],
      [q.productGrade, 'item_grade ILIKE $X'],
      [q.productModel, 'item_model ILIKE $X'],
      [q.productCategory, 'item_category ILIKE $X'],
      [q.productGroupMain, 'group_main ILIKE $X'],
      [q.productGroupSub, 'group_sub ILIKE $X'],
      [q.productGroupSub2, 'group_sub2 ILIKE $X'],
    ];
    for (const [val, template] of ilikePushers) {
      if (val) {
        params.push(`%${val}%`);
        conds.push(template.replace(/\$X/g, `$${params.length}`));
      }
    }

    const whereClause = conds.join(' AND ');

    const baseQuery = `
      SELECT code, name_1, unit_name,
             qty_sale::float8, amount_sale::float8, cost_sale::float8,
             qty_sale_return::float8, amount_sale_return::float8, cost_sale_return::float8,
             (amount_sale - amount_sale_return)::float8 AS net_amount_sale,
             (cost_sale - cost_sale_return)::float8 AS net_cost_sale,
             ((amount_sale - amount_sale_return) - (cost_sale - cost_sale_return))::float8 AS profit,
             CASE WHEN (amount_sale - amount_sale_return) = 0 THEN 0
                  ELSE (((amount_sale - amount_sale_return) - (cost_sale - cost_sale_return)) / (amount_sale - amount_sale_return)) * 100
             END::float8 AS per_profit
      FROM (
        SELECT * FROM (
          SELECT code, name_1,
                 unit_cost || '(' || COALESCE((SELECT name_1 FROM ic_unit WHERE ic_unit.code = ic_inventory.unit_cost), '') || ')' AS unit_name,
                 COALESCE((SELECT SUM(qty * (stand_value / divide_value))
                           FROM ic_trans_detail
                           WHERE ic_trans_detail.item_code = ic_inventory.code
                             AND ic_trans_detail.item_type <> 5
                             AND ic_trans_detail.item_type <> 3
                             AND ic_trans_detail.last_status = 0
                             AND ic_trans_detail.doc_date BETWEEN $1 AND $2
                             AND (ic_trans_detail.trans_flag IN (44) OR (ic_trans_detail.trans_flag IN (46) AND ic_trans_detail.inquiry_type IN (0, 2)))), 0)::float8 AS qty_sale,
                 COALESCE((SELECT SUM(sum_amount_exclude_vat)
                           FROM ic_trans_detail
                           WHERE ic_trans_detail.item_code = ic_inventory.code
                             AND ic_trans_detail.item_type <> 5
                             AND ic_trans_detail.item_type <> 3
                             AND ic_trans_detail.last_status = 0
                             AND ic_trans_detail.doc_date BETWEEN $1 AND $2
                             AND ic_trans_detail.trans_flag IN (44, 46)), 0)::float8 AS amount_sale,
                 COALESCE((SELECT SUM(sum_of_cost)
                           FROM ic_trans_detail
                           WHERE ic_trans_detail.item_code = ic_inventory.code
                             AND ic_trans_detail.item_type <> 5
                             AND ic_trans_detail.item_type <> 3
                             AND ic_trans_detail.last_status = 0
                             AND ic_trans_detail.doc_date BETWEEN $1 AND $2
                             AND ic_trans_detail.trans_flag IN (44, 46)), 0)::float8 AS cost_sale,
                 COALESCE((SELECT SUM(qty * (stand_value / divide_value))
                           FROM ic_trans_detail
                           WHERE ic_trans_detail.item_code = ic_inventory.code
                             AND ic_trans_detail.item_type <> 5
                             AND ic_trans_detail.item_type <> 3
                             AND ic_trans_detail.last_status = 0
                             AND ic_trans_detail.doc_date BETWEEN $1 AND $2
                             AND ic_trans_detail.trans_flag IN (48)), 0)::float8 AS qty_sale_return,
                 COALESCE((SELECT SUM(sum_amount_exclude_vat)
                           FROM ic_trans_detail
                           WHERE ic_trans_detail.item_code = ic_inventory.code
                             AND ic_trans_detail.item_type <> 5
                             AND ic_trans_detail.item_type <> 3
                             AND ic_trans_detail.last_status = 0
                             AND ic_trans_detail.doc_date BETWEEN $1 AND $2
                             AND ic_trans_detail.trans_flag IN (48)), 0)::float8 AS amount_sale_return,
                 COALESCE((SELECT SUM(sum_of_cost)
                           FROM ic_trans_detail
                           WHERE ic_trans_detail.item_code = ic_inventory.code
                             AND ic_trans_detail.item_type <> 5
                             AND ic_trans_detail.item_type <> 3
                             AND ic_trans_detail.last_status = 0
                             AND ic_trans_detail.doc_date BETWEEN $1 AND $2
                             AND ic_trans_detail.trans_flag IN (48)), 0)::float8 AS cost_sale_return
          FROM ic_inventory
          WHERE ${whereClause}
        ) AS temp1
        WHERE qty_sale <> 0 OR qty_sale_return <> 0
        ORDER BY code
      ) AS temp2
    `;

    const countSql = `SELECT COUNT(*) AS total FROM (${baseQuery}) AS c`;
    const countRes = await this.pool.query<{ total: string }>(
      database,
      countSql,
      params,
      { isReport: true },
    );
    const totalRecords = parseInt(countRes.rows[0]?.total ?? '0', 10);

    const offset = (q.page - 1) * q.pageSize;
    const paginatedSql = `${baseQuery} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const paginatedParams = [...params, q.pageSize, offset];
    const rowsRes = await this.pool.query<ProfitProductRow>(
      database,
      paginatedSql,
      paginatedParams,
      { isReport: true },
    );

    const totalsSql = `
      SELECT
        COALESCE(SUM(qty_sale), 0)::float8 AS qty_sale,
        COALESCE(SUM(amount_sale), 0)::float8 AS amount_sale,
        COALESCE(SUM(cost_sale), 0)::float8 AS cost_sale,
        COALESCE(SUM(qty_sale_return), 0)::float8 AS qty_sale_return,
        COALESCE(SUM(amount_sale_return), 0)::float8 AS amount_sale_return,
        COALESCE(SUM(cost_sale_return), 0)::float8 AS cost_sale_return,
        COALESCE(SUM(amount_sale - amount_sale_return), 0)::float8 AS net_amount_sale,
        COALESCE(SUM(cost_sale - cost_sale_return), 0)::float8 AS net_cost_sale,
        COALESCE(SUM((amount_sale - amount_sale_return) - (cost_sale - cost_sale_return)), 0)::float8 AS profit
      FROM (${baseQuery}) AS t
    `;
    const totalsRes = await this.pool.query<ProfitProductTotals>(
      database,
      totalsSql,
      params,
      { isReport: true },
    );

    return {
      rows: rowsRes.rows,
      totalRecords,
      totals: totalsRes.rows[0] ?? {
        qty_sale: 0,
        amount_sale: 0,
        cost_sale: 0,
        qty_sale_return: 0,
        amount_sale_return: 0,
        cost_sale_return: 0,
        net_amount_sale: 0,
        net_cost_sale: 0,
        profit: 0,
      },
    };
  }

  // ──────────────────────────── Daily Sales Chart ────────────────────────────

  // ──────────────────────────── Bank Statement ────────────────────────────

  /**
   * Helper สร้าง UNION ALL ของ pass-book transactions
   *
   * @param dateClause  SQL fragment ตำแหน่ง date condition (use $1 หรือ $1-$2)
   * @param bookCondition  AND clause หลัง WHERE ของ erp_pass_book
   * @param includeRemark1  true = include customer/supplier name lookup (transactions query)
   */
  private buildBankUnionSql(
    dateClauseCb: string, // for cb_trans_detail (uses chq_due_date OR doc_date)
    dateClauseIc: string, // for ic_trans_detail / ic_trans (doc_date only)
    bookCondition: string,
    includeRemark1: boolean,
  ): string {
    const cbRemark1 = includeRemark1
      ? `CASE WHEN trans_flag IN (250,252,254,239,44,46,110,40,112,42,1802,48) THEN
           (SELECT name_1 FROM ar_customer WHERE ar_customer.code = (SELECT ap_ar_code FROM cb_trans WHERE cb_trans.doc_no = cb_trans_detail.doc_no AND cb_trans.trans_flag = cb_trans_detail.trans_flag))
         ELSE
           (SELECT name_1 FROM ap_supplier WHERE ap_supplier.code = (SELECT ap_ar_code FROM cb_trans WHERE cb_trans.doc_no = cb_trans_detail.doc_no AND cb_trans.trans_flag = cb_trans_detail.trans_flag))
         END AS remark1`
      : `'' AS remark1`;

    return `
      SELECT
        1 AS doc_sort,
        CASE WHEN pass_book_code IS NULL OR pass_book_code = '' THEN trans_number ELSE pass_book_code END AS book_no,
        TO_CHAR(CASE WHEN doc_type = 1 THEN chq_due_date ELSE doc_date END, 'YYYY-MM-DD') AS doc_date,
        COALESCE(doc_time, '') AS doc_time,
        doc_no,
        remark,
        CASE WHEN trans_flag IN (402,300,250,254,262,239,44,46,110,40,25,20,416,1802,16463) THEN amount ELSE 0 END AS amount_in,
        CASE WHEN trans_flag IN (401,301,260,264,252,19,112,42,48,11,10,14,456,12,315) THEN amount ELSE 0 END AS amount_out,
        0 AS amount_balance,
        trans_flag AS doc_type,
        ${cbRemark1}
      FROM cb_trans_detail
      WHERE CASE WHEN pass_book_code IS NULL OR pass_book_code = '' THEN trans_number ELSE pass_book_code END IN (
        SELECT code FROM erp_pass_book WHERE 1=1 ${bookCondition}
      )
        AND trans_flag IN (402,300,250,254,262,239,44,46,110,40,25,20,416,1802,16463,401,301,260,264,252,19,112,42,48,11,10,14,456,12,315)
        AND (${dateClauseCb})
        AND cb_trans_detail.status = 0
        AND doc_type = 1
        AND (CASE
          WHEN trans_flag IN (239,19) THEN (SELECT last_status FROM ap_ar_trans WHERE ap_ar_trans.doc_date = cb_trans_detail.doc_date AND ap_ar_trans.trans_flag = cb_trans_detail.trans_flag AND ap_ar_trans.doc_no = cb_trans_detail.doc_no)
          WHEN trans_flag IN (1802) THEN (SELECT last_status FROM as_trans WHERE as_trans.doc_date = cb_trans_detail.doc_date AND as_trans.trans_flag = cb_trans_detail.trans_flag AND as_trans.doc_no = cb_trans_detail.doc_no)
          ELSE (SELECT last_status FROM ic_trans WHERE ic_trans.doc_date = cb_trans_detail.doc_date AND ic_trans.trans_flag = cb_trans_detail.trans_flag AND ic_trans.doc_no = cb_trans_detail.doc_no)
        END) = 0

      UNION ALL

      SELECT
        1 AS doc_sort,
        item_code AS book_no,
        TO_CHAR(doc_date, 'YYYY-MM-DD') AS doc_date,
        COALESCE(doc_time, '') AS doc_time,
        doc_no,
        remark,
        CASE WHEN trans_flag IN (453, 401) THEN sum_amount ELSE (
          CASE WHEN trans_flag = 420 THEN transfer_amount
          WHEN trans_flag = 411 AND COALESCE(currency_code,'') != '' AND exchange_rate > 0 THEN sum_amount_2
          ELSE (CASE WHEN trans_flag = 411 AND COALESCE(currency_code,'') = '' THEN sum_amount ELSE 0 END)
          END
        ) END AS amount_in,
        CASE WHEN trans_flag IN (451,412,402) THEN sum_amount ELSE (CASE WHEN trans_flag = 422 THEN transfer_amount ELSE 0 END) END AS amount_out,
        0 AS amount_balance,
        trans_flag AS doc_type,
        '' AS remark1
      FROM ic_trans_detail
      WHERE item_code IN (SELECT code FROM erp_pass_book WHERE 1=1 ${bookCondition})
        AND trans_flag IN (453,411,401,451,412,402,420,422)
        AND (${dateClauseIc})
        AND COALESCE(last_status, 0) = 0

      UNION ALL

      SELECT
        1 AS doc_sort,
        item_code AS book_no,
        TO_CHAR(doc_date, 'YYYY-MM-DD') AS doc_date,
        COALESCE(doc_time, '') AS doc_time,
        doc_no,
        remark,
        SUM(sum_amount) AS amount_in,
        0 AS amount_out,
        0 AS amount_balance,
        trans_flag AS doc_type,
        '' AS remark1
      FROM ic_trans_detail
      WHERE item_code IN (SELECT code FROM erp_pass_book WHERE 1=1 ${bookCondition})
        AND trans_flag IN (461,463)
        AND (${dateClauseIc})
        AND COALESCE(last_status, 0) = 0
      GROUP BY item_code, doc_date, doc_time, doc_no, remark, trans_flag

      UNION ALL

      SELECT
        2 AS doc_sort,
        item_code AS book_no,
        TO_CHAR(doc_date, 'YYYY-MM-DD') AS doc_date,
        COALESCE(doc_time, '') AS doc_time,
        doc_no,
        remark,
        0 AS amount_in,
        CASE WHEN trans_flag IN (422) THEN fee_amount ELSE 0 END AS amount_out,
        0 AS amount_balance,
        trans_flag AS doc_type,
        '' AS remark1
      FROM ic_trans_detail
      WHERE item_code IN (SELECT code FROM erp_pass_book WHERE 1=1 ${bookCondition})
        AND trans_flag IN (422)
        AND fee_amount > 0
        AND (${dateClauseIc})
        AND COALESCE(last_status, 0) = 0

      UNION ALL

      SELECT
        2 AS doc_sort,
        pass_book_code AS book_no,
        TO_CHAR(doc_date, 'YYYY-MM-DD') AS doc_date,
        COALESCE(doc_time, '') AS doc_time,
        doc_no,
        remark,
        CASE WHEN trans_flag IN (604) THEN total_amount ELSE 0 END AS amount_in,
        0 AS amount_out,
        0 AS amount_balance,
        trans_flag AS doc_type,
        '' AS remark1
      FROM ic_trans
      WHERE pass_book_code IN (SELECT code FROM erp_pass_book WHERE 1=1 ${bookCondition})
        AND trans_flag IN (604)
        AND (${dateClauseIc})
        AND COALESCE(last_status, 0) = 0
    `;
  }

  async getBankOpeningBalances(
    database: string,
    dateStart: string,
    bankCode?: string,
    bookNo?: string,
  ): Promise<BankBalance[]> {
    const params: (string | number)[] = [dateStart];
    let bookCondition = '';
    if (bookNo && bookNo !== 'all') {
      params.push(bookNo);
      bookCondition = `AND code = $${params.length}`;
    } else if (bankCode && bankCode !== 'all') {
      params.push(bankCode);
      bookCondition = `AND bank_code = $${params.length}`;
    }

    const dateClauseCb = `CASE WHEN doc_type = 1 THEN chq_due_date < date($1) ELSE doc_date < date($1) END`;
    const dateClauseIc = `doc_date < date($1)`;

    const union = this.buildBankUnionSql(
      dateClauseCb,
      dateClauseIc,
      bookCondition,
      false,
    );

    const sql = `
      SELECT book_no, SUM(amount_in - amount_out)::float8 AS amount_balance
      FROM (${union}) AS opening
      GROUP BY book_no
    `;

    const result = await this.pool.query<BankBalance>(database, sql, params, {
      isReport: true,
    });
    return result.rows;
  }

  async getBankTransactions(
    database: string,
    fromDate: string,
    toDate: string,
    bankCode?: string,
    bookNo?: string,
    transactionType?: 'all' | 'deposit' | 'withdraw',
  ): Promise<BankTransaction[]> {
    const params: (string | number)[] = [fromDate, toDate];
    let bookCondition = '';
    if (bookNo && bookNo !== 'all') {
      params.push(bookNo);
      bookCondition = `AND code = $${params.length}`;
    } else if (bankCode && bankCode !== 'all') {
      params.push(bankCode);
      bookCondition = `AND bank_code = $${params.length}`;
    }

    const dateClauseCb = `CASE WHEN doc_type = 1 THEN chq_due_date BETWEEN date($1) AND date($2) ELSE doc_date BETWEEN date($1) AND date($2) END`;
    const dateClauseIc = `doc_date BETWEEN date($1) AND date($2)`;

    const union = this.buildBankUnionSql(
      dateClauseCb,
      dateClauseIc,
      bookCondition,
      true,
    );

    let txnFilter = '';
    if (transactionType === 'deposit') txnFilter = 'WHERE amount_in > 0';
    else if (transactionType === 'withdraw') txnFilter = 'WHERE amount_out > 0';

    const sql = `
      SELECT * FROM (${union}) AS transactions
      ${txnFilter}
      ORDER BY book_no, doc_date, doc_time, doc_sort
    `;

    const result = await this.pool.query<BankTransaction>(
      database,
      sql,
      params,
      { isReport: true },
    );
    return result.rows;
  }

  // ──────────────────────────── Bank Books / Bank / Branches ────────────────────────────

  async getBankBooks(database: string): Promise<BankBookRawRow[]> {
    const sql = `
      SELECT
        code,
        COALESCE(name_1, '') AS name,
        COALESCE(book_number, '') AS book_number,
        COALESCE(bank_code, '') AS bank_code,
        COALESCE(bank_branch, '') AS bank_branch
      FROM erp_pass_book
      ORDER BY code
    `;
    const result = await this.pool.query<BankBookRawRow>(database, sql, [], {
      isReport: true,
    });
    return result.rows;
  }

  async getBanksByCodes(
    database: string,
    codes: string[],
  ): Promise<BankRefRow[]> {
    if (codes.length === 0) return [];
    const placeholders = codes.map((_, i) => `$${i + 1}`).join(',');
    const sql = `
      SELECT code, COALESCE(name_1, code) AS name
      FROM erp_bank
      WHERE code IN (${placeholders})
      ORDER BY code
    `;
    const result = await this.pool.query<BankRefRow>(database, sql, codes, {
      isReport: true,
    });
    return result.rows;
  }

  async getBankBranches(database: string): Promise<BankBranchRawRow[]> {
    const sql = `
      SELECT code, COALESCE(name_1, code) AS name, COALESCE(bank_code, '') AS bank_code
      FROM erp_bank_branch
      ORDER BY bank_code, code
    `;
    const result = await this.pool.query<BankBranchRawRow>(database, sql, [], {
      isReport: true,
    });
    return result.rows;
  }

  // ──────────────────────────── AR Movement ────────────────────────────

  /**
   * AR Movement — รวมเอกสารฝั่งลูกหนี้ ic_trans + ap_ar_trans + as_trans
   * Source SQL: nextstep_dashboard ar-movement/route.ts (port + parameterize customerCodes)
   */
  async getArMovement(
    database: string,
    dateFrom: string,
    dateTo: string,
    customerCodes?: string,
  ): Promise<Omit<ArMovementRow, 'trans_type_name'>[]> {
    const params: (string | number)[] = [dateFrom, dateTo];
    let customerFilter = '';

    if (customerCodes) {
      const codes = customerCodes
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      if (codes.length > 0) {
        const placeholders = codes
          .map((_, i) => `$${params.length + 1 + i}`)
          .join(',');
        customerFilter = `AND cust_code IN (${placeholders})`;
        params.push(...codes);
      }
    }

    const sql = `
      SELECT
        roworder,
        1 AS doc_sort,
        cust_code,
        (SELECT name_1 FROM ar_customer WHERE ar_customer.code = cust_code) AS cust_name,
        trans_flag AS doc_type,
        TO_CHAR(doc_date, 'YYYY-MM-DD') AS doc_date,
        doc_no,
        tax_doc_no,
        doc_ref,
        credit_day,
        total_amount::float8 AS amount
      FROM ic_trans
      WHERE last_status = 0
        AND doc_date >= $1 AND doc_date <= $2
        AND cust_code IS NOT NULL AND cust_code != ''
        AND ((trans_flag = 44 OR trans_flag = 250) AND inquiry_type IN (0, 2))
        ${customerFilter}

      UNION ALL

      SELECT
        roworder, 2, cust_code,
        (SELECT name_1 FROM ar_customer WHERE ar_customer.code = cust_code),
        trans_flag, TO_CHAR(doc_date, 'YYYY-MM-DD'), doc_no, tax_doc_no, doc_ref, credit_day,
        total_amount::float8
      FROM ic_trans
      WHERE last_status = 0
        AND doc_date >= $1 AND doc_date <= $2
        AND cust_code IS NOT NULL AND cust_code != ''
        AND (trans_flag = 48 AND inquiry_type IN (0, 2, 4))
        ${customerFilter}

      UNION ALL

      SELECT
        roworder, 1, cust_code,
        (SELECT name_1 FROM ar_customer WHERE ar_customer.code = cust_code),
        trans_flag, TO_CHAR(doc_date, 'YYYY-MM-DD'), doc_no, tax_doc_no, doc_ref, credit_day,
        total_amount::float8
      FROM ic_trans
      WHERE last_status = 0
        AND doc_date >= $1 AND doc_date <= $2
        AND cust_code IS NOT NULL AND cust_code != ''
        AND trans_flag IN (46)
        ${customerFilter}

      UNION ALL

      SELECT
        roworder, 1, cust_code,
        (SELECT name_1 FROM ar_customer WHERE ar_customer.code = cust_code),
        trans_flag, TO_CHAR(doc_date, 'YYYY-MM-DD'), doc_no, tax_doc_no, doc_ref, credit_day,
        total_amount::float8
      FROM ic_trans
      WHERE last_status = 0
        AND doc_date >= $1 AND doc_date <= $2
        AND cust_code IS NOT NULL AND cust_code != ''
        AND trans_flag IN (93, 99, 95, 101, 254, 418)
        ${customerFilter}

      UNION ALL

      SELECT
        roworder, 2, cust_code,
        (SELECT name_1 FROM ar_customer WHERE ar_customer.code = cust_code),
        trans_flag, TO_CHAR(doc_date, 'YYYY-MM-DD'), doc_no, tax_doc_no, doc_ref, credit_day,
        total_amount::float8
      FROM ic_trans
      WHERE last_status = 0
        AND doc_date >= $1 AND doc_date <= $2
        AND cust_code IS NOT NULL AND cust_code != ''
        AND (trans_flag IN (97, 103) OR (trans_flag = 262 AND inquiry_type NOT IN (1, 3)))
        ${customerFilter}

      UNION ALL

      SELECT
        roworder, 3, cust_code,
        (SELECT name_1 FROM ar_customer WHERE ar_customer.code = cust_code),
        trans_flag, TO_CHAR(doc_date, 'YYYY-MM-DD'), doc_no, NULL::varchar AS tax_doc_no, doc_ref, 0,
        total_net_value::float8
      FROM ap_ar_trans
      WHERE last_status = 0
        AND doc_date >= $1 AND doc_date <= $2
        AND cust_code IS NOT NULL AND cust_code != ''
        AND trans_flag = 239
        ${customerFilter}

      UNION ALL

      SELECT
        roworder, 3, cust_code,
        (SELECT name_1 FROM ar_customer WHERE ar_customer.code = cust_code),
        trans_flag, TO_CHAR(doc_date, 'YYYY-MM-DD'), doc_no, NULL::varchar AS tax_doc_no, doc_ref, 0,
        total_amount::float8
      FROM as_trans
      WHERE last_status = 0
        AND doc_date >= $1 AND doc_date <= $2
        AND cust_code IS NOT NULL AND cust_code != ''
        AND trans_flag = 1802
        ${customerFilter}

      ORDER BY cust_code, doc_date, doc_sort, doc_no
    `;

    const result = await this.pool.query<
      Omit<ArMovementRow, 'trans_type_name'>
    >(database, sql, params, { isReport: true });
    return result.rows;
  }

  // ──────────────────────────── AR Open Invoices (used by overdue + aging) ────────────────────────────

  /**
   * เอกสาร AR ที่ยังเปิดอยู่ (balance != 0) ณ asOfDate
   * Source SQL: nextstep_dashboard receivable-overdue/route.ts + ar-aging/route.ts
   * (ใช้ร่วมกัน — share single repo method)
   */
  async getArOpenInvoices(
    database: string,
    asOfDate: string,
  ): Promise<ArOpenInvoiceRow[]> {
    const sql = `
      SELECT
        cust_code AS cust_code,
        (SELECT name_1 FROM ar_customer WHERE ar_customer.code = xx.cust_code) AS cust_name,
        doc_no,
        TO_CHAR(doc_date, 'YYYY-MM-DD') AS doc_date,
        TO_CHAR(due_date, 'YYYY-MM-DD') AS due_date,
        doc_type,
        ref_doc_no,
        TO_CHAR(ref_doc_date, 'YYYY-MM-DD') AS ref_doc_date,
        amount::float8 AS total_amount,
        balance_amount::float8 AS balance_amount
      FROM (
        SELECT
          cust_code, doc_date, credit_date AS due_date, doc_no,
          trans_flag AS doc_type, used_status,
          COALESCE(doc_ref, '') AS ref_doc_no, doc_ref_date AS ref_doc_date,
          COALESCE(total_amount, 0) AS amount,
          COALESCE(total_amount, 0) - (
            SELECT COALESCE(SUM(COALESCE(sum_pay_money, 0)), 0)
            FROM ap_ar_trans_detail
            WHERE COALESCE(last_status, 0) = 0
              AND trans_flag IN (239)
              AND ic_trans.doc_no = ap_ar_trans_detail.billing_no
              AND ic_trans.doc_date = ap_ar_trans_detail.billing_date
              AND doc_date <= $1
          ) AS balance_amount
        FROM ic_trans
        WHERE COALESCE(last_status, 0) = 0
          AND trans_flag = 44
          AND (inquiry_type = 0 OR inquiry_type = 2)
          AND is_doc_copy = 0
          AND doc_date <= $1

        UNION ALL

        SELECT
          cust_code, doc_date, credit_date, doc_no,
          trans_flag, used_status,
          COALESCE(doc_ref, ''), doc_ref_date AS ref_doc_date,
          COALESCE(total_amount, 0),
          COALESCE(total_amount, 0) - (
            SELECT COALESCE(SUM(COALESCE(sum_pay_money, 0)), 0)
            FROM ap_ar_trans_detail
            WHERE COALESCE(last_status, 0) = 0
              AND trans_flag IN (239)
              AND ic_trans.doc_no = ap_ar_trans_detail.billing_no
              AND ic_trans.doc_date = ap_ar_trans_detail.billing_date
              AND doc_date <= $1
          )
        FROM ic_trans
        WHERE COALESCE(last_status, 0) = 0
          AND (trans_flag = 46 OR trans_flag = 93 OR trans_flag = 99 OR trans_flag = 95 OR trans_flag = 101 OR (trans_flag = 250 AND inquiry_type IN (0, 2)))
          AND is_doc_copy = 0
          AND doc_date <= $1

        UNION ALL

        SELECT
          cust_code, doc_date, credit_date, doc_no,
          trans_flag, used_status,
          ''::varchar, NULL::date AS ref_doc_date,
          -1 * COALESCE(total_amount, 0),
          -1 * (COALESCE(total_amount, 0) + (
            SELECT COALESCE(SUM(COALESCE(sum_pay_money, 0)), 0)
            FROM ap_ar_trans_detail
            WHERE COALESCE(last_status, 0) = 0
              AND trans_flag IN (239)
              AND ic_trans.doc_no = ap_ar_trans_detail.billing_no
              AND ic_trans.doc_date = ap_ar_trans_detail.billing_date
              AND doc_date <= $1
          ))
        FROM ic_trans
        WHERE COALESCE(last_status, 0) = 0
          AND ((trans_flag = 48 AND inquiry_type IN (0, 2, 4)) OR trans_flag = 97 OR trans_flag = 103)
          AND is_doc_copy = 0
          AND doc_date <= $1
      ) AS xx
      WHERE balance_amount <> 0
      ORDER BY cust_code, doc_date, doc_no
    `;

    const result = await this.pool.query<ArOpenInvoiceRow>(
      database,
      sql,
      [asOfDate],
      { isReport: true },
    );
    return result.rows;
  }

  // ──────────────────────────── AP Movement ────────────────────────────

  /**
   * AP Movement — รวมเอกสารฝั่งเจ้าหนี้ (purchase/CR/payment)
   *
   * NOTE: DB ใหม่ใช้ `cust_code` สำหรับทั้ง customer และ supplier — แยกด้วย trans_flag
   * (source code Dashboard ใช้ vend_code ที่ไม่มีในจริง — verify ผ่าน MCP แล้ว)
   */
  async getApMovement(
    database: string,
    dateFrom: string,
    dateTo: string,
    supplierCodes?: string,
  ): Promise<Array<Omit<ApMovementRow, 'trans_type_name'>>> {
    const params: (string | number)[] = [dateFrom, dateTo];
    let supplierFilter = '';

    if (supplierCodes) {
      const codes = supplierCodes
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      if (codes.length > 0) {
        const placeholders = codes
          .map((_, i) => `$${params.length + 1 + i}`)
          .join(',');
        supplierFilter = `AND cust_code IN (${placeholders})`;
        params.push(...codes);
      }
    }

    const sql = `
      SELECT
        roworder, 1 AS doc_sort,
        cust_code AS vend_code,
        (SELECT name_1 FROM ap_supplier WHERE ap_supplier.code = cust_code) AS vend_name,
        trans_flag AS doc_type,
        TO_CHAR(doc_date, 'YYYY-MM-DD') AS doc_date,
        doc_no, tax_doc_no, doc_ref, credit_day,
        total_amount::float8 AS amount
      FROM ic_trans
      WHERE last_status = 0
        AND doc_date >= $1 AND doc_date <= $2
        AND cust_code IS NOT NULL AND cust_code != ''
        AND (trans_flag = 12 AND inquiry_type IN (0, 2))
        ${supplierFilter}

      UNION ALL

      SELECT
        roworder, 2, cust_code,
        (SELECT name_1 FROM ap_supplier WHERE ap_supplier.code = cust_code),
        trans_flag, TO_CHAR(doc_date, 'YYYY-MM-DD'), doc_no, tax_doc_no, doc_ref, credit_day,
        total_amount::float8
      FROM ic_trans
      WHERE last_status = 0
        AND doc_date >= $1 AND doc_date <= $2
        AND cust_code IS NOT NULL AND cust_code != ''
        AND (trans_flag = 16 AND inquiry_type IN (0, 2, 4))
        ${supplierFilter}

      UNION ALL

      SELECT
        roworder, 1, cust_code,
        (SELECT name_1 FROM ap_supplier WHERE ap_supplier.code = cust_code),
        trans_flag, TO_CHAR(doc_date, 'YYYY-MM-DD'), doc_no, tax_doc_no, doc_ref, credit_day,
        total_amount::float8
      FROM ic_trans
      WHERE last_status = 0
        AND doc_date >= $1 AND doc_date <= $2
        AND cust_code IS NOT NULL AND cust_code != ''
        AND trans_flag IN (260)
        ${supplierFilter}

      UNION ALL

      SELECT
        roworder, 1, cust_code,
        (SELECT name_1 FROM ap_supplier WHERE ap_supplier.code = cust_code),
        trans_flag, TO_CHAR(doc_date, 'YYYY-MM-DD'), doc_no, tax_doc_no, doc_ref, credit_day,
        total_amount::float8
      FROM ic_trans
      WHERE last_status = 0
        AND doc_date >= $1 AND doc_date <= $2
        AND cust_code IS NOT NULL AND cust_code != ''
        AND trans_flag IN (81, 87, 89)
        ${supplierFilter}

      UNION ALL

      SELECT
        roworder, 2, cust_code,
        (SELECT name_1 FROM ap_supplier WHERE ap_supplier.code = cust_code),
        trans_flag, TO_CHAR(doc_date, 'YYYY-MM-DD'), doc_no, tax_doc_no, doc_ref, credit_day,
        total_amount::float8
      FROM ic_trans
      WHERE last_status = 0
        AND doc_date >= $1 AND doc_date <= $2
        AND cust_code IS NOT NULL AND cust_code != ''
        AND (trans_flag IN (91) OR (trans_flag = 262 AND inquiry_type NOT IN (1, 3)))
        ${supplierFilter}

      UNION ALL

      SELECT
        roworder, 3, cust_code,
        (SELECT name_1 FROM ap_supplier WHERE ap_supplier.code = cust_code),
        trans_flag, TO_CHAR(doc_date, 'YYYY-MM-DD'), doc_no, NULL::varchar AS tax_doc_no, doc_ref, 0,
        total_net_value::float8
      FROM ap_ar_trans
      WHERE last_status = 0
        AND doc_date >= $1 AND doc_date <= $2
        AND cust_code IS NOT NULL AND cust_code != ''
        AND trans_flag = 240
        ${supplierFilter}

      ORDER BY vend_code, doc_date, doc_sort, doc_no
    `;

    const result = await this.pool.query<
      Omit<ApMovementRow, 'trans_type_name'>
    >(database, sql, params, { isReport: true });
    return result.rows;
  }

  // ──────────────────────────── AP Open Invoices ────────────────────────────

  /**
   * เอกสาร AP ที่ยังเปิดอยู่ ณ asOfDate — ใช้ร่วม overdue + aging
   */
  async getApOpenInvoices(
    database: string,
    asOfDate: string,
  ): Promise<ApOpenInvoiceRow[]> {
    const sql = `
      SELECT
        cust_code AS vend_code,
        (SELECT name_1 FROM ap_supplier WHERE ap_supplier.code = xx.cust_code) AS vend_name,
        doc_no,
        TO_CHAR(doc_date, 'YYYY-MM-DD') AS doc_date,
        TO_CHAR(due_date, 'YYYY-MM-DD') AS due_date,
        doc_type,
        ref_doc_no,
        TO_CHAR(ref_doc_date, 'YYYY-MM-DD') AS ref_doc_date,
        amount::float8 AS total_amount,
        balance_amount::float8 AS balance_amount
      FROM (
        SELECT
          cust_code, doc_date, credit_date AS due_date, doc_no,
          trans_flag AS doc_type, used_status,
          COALESCE(doc_ref, '') AS ref_doc_no, doc_ref_date AS ref_doc_date,
          COALESCE(total_amount, 0) AS amount,
          COALESCE(total_amount, 0) - (
            SELECT COALESCE(SUM(COALESCE(sum_pay_money, 0)), 0)
            FROM ap_ar_trans_detail
            WHERE COALESCE(last_status, 0) = 0
              AND trans_flag IN (240)
              AND ic_trans.doc_no = ap_ar_trans_detail.billing_no
              AND ic_trans.doc_date = ap_ar_trans_detail.billing_date
              AND doc_date <= $1
          ) AS balance_amount
        FROM ic_trans
        WHERE COALESCE(last_status, 0) = 0
          AND trans_flag = 12
          AND (inquiry_type = 0 OR inquiry_type = 2)
          AND is_doc_copy = 0
          AND doc_date <= $1

        UNION ALL

        SELECT
          cust_code, doc_date, credit_date, doc_no,
          trans_flag, used_status,
          COALESCE(doc_ref, ''), doc_ref_date AS ref_doc_date,
          COALESCE(total_amount, 0),
          COALESCE(total_amount, 0) - (
            SELECT COALESCE(SUM(COALESCE(sum_pay_money, 0)), 0)
            FROM ap_ar_trans_detail
            WHERE COALESCE(last_status, 0) = 0
              AND trans_flag IN (240)
              AND ic_trans.doc_no = ap_ar_trans_detail.billing_no
              AND ic_trans.doc_date = ap_ar_trans_detail.billing_date
              AND doc_date <= $1
          )
        FROM ic_trans
        WHERE COALESCE(last_status, 0) = 0
          AND (trans_flag = 81 OR trans_flag = 87 OR trans_flag = 89 OR (trans_flag = 260 AND inquiry_type IN (0, 2)))
          AND is_doc_copy = 0
          AND doc_date <= $1

        UNION ALL

        SELECT
          cust_code, doc_date, credit_date, doc_no,
          trans_flag, used_status,
          ''::varchar, NULL::date AS ref_doc_date,
          -1 * COALESCE(total_amount, 0),
          -1 * (COALESCE(total_amount, 0) + (
            SELECT COALESCE(SUM(COALESCE(sum_pay_money, 0)), 0)
            FROM ap_ar_trans_detail
            WHERE COALESCE(last_status, 0) = 0
              AND trans_flag IN (240)
              AND ic_trans.doc_no = ap_ar_trans_detail.billing_no
              AND ic_trans.doc_date = ap_ar_trans_detail.billing_date
              AND doc_date <= $1
          ))
        FROM ic_trans
        WHERE COALESCE(last_status, 0) = 0
          AND ((trans_flag = 16 AND inquiry_type IN (0, 2, 4)) OR trans_flag = 91)
          AND is_doc_copy = 0
          AND doc_date <= $1
      ) AS xx
      WHERE balance_amount <> 0
      ORDER BY vend_code, doc_date, doc_no
    `;

    const result = await this.pool.query<ApOpenInvoiceRow>(
      database,
      sql,
      [asOfDate],
      { isReport: true },
    );
    return result.rows;
  }

  // ──────────────────────────── Daily Sales Chart ────────────────────────────

  async getDailySalesChart(
    database: string,
    startDate: string,
    endDate: string,
    groupBy: 'daily' | 'monthly',
  ): Promise<DailySalesAggregateRow[]> {
    const periodExpr =
      groupBy === 'monthly'
        ? `TO_CHAR(doc_date, 'YYYY-MM')`
        : `TO_CHAR(doc_date::date, 'YYYY-MM-DD')`;

    const sql = `
      SELECT
        ${periodExpr} AS period,
        (COALESCE(SUM(CASE WHEN trans_flag IN (44, 46) THEN sum_amount_exclude_vat ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN trans_flag = 48 THEN sum_amount_exclude_vat ELSE 0 END), 0))::float8 AS net_sales,
        (COALESCE(SUM(CASE WHEN trans_flag IN (44, 46) THEN sum_of_cost ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN trans_flag = 48 THEN sum_of_cost ELSE 0 END), 0))::float8 AS net_cost
      FROM ic_trans_detail
      WHERE doc_date BETWEEN $1 AND $2
        AND item_type <> 5
        AND item_type <> 3
        AND last_status = 0
        AND trans_flag IN (44, 46, 48)
      GROUP BY ${periodExpr}
      ORDER BY period
    `;

    const res = await this.pool.query<DailySalesAggregateRow>(
      database,
      sql,
      [startDate, endDate],
      { isReport: true },
    );
    return res.rows;
  }
}
