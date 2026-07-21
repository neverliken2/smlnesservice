import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PoolManagerService } from '../../core/db/pool-manager.service';
import type { TenantRef } from '../../core/db/db.types';
import {
  APP_CREATOR_CODE,
  IA_FORMAT_CODE,
  IA_INQUIRY_TYPE,
  IA_TRANS_FLAG,
  IA_TRANS_TYPE,
  RMB_FORMAT_CODE,
  RMB_INQUIRY_TYPE,
  RMB_TRANS_FLAG,
  RMB_TRANS_TYPE,
} from './stock-adjust.constants';

/**
 * Stock-Adjust Repository — raw SQL queries สำหรับ IA module
 *
 * Port จาก NextStep_Stock_Adjust/src/actions/stock-adjust.ts (pre-migration v1.2.0)
 * - SQL block ของ getStockAndCost copy ตรงๆ (mirror SMLERP `_stkStockInfoAndBalanceQuery` costMode=ปกติ)
 * - ห้ามแก้ trans_flag groups (เข้า/ออก) เพราะ logic mirror C# ของ SMLERP22
 */

// ──────────────────────────── Row types ────────────────────────────

export interface ItemRow {
  code: string;
  name_1: string | null;
  unit_standard: string | null;
  average_cost: string | number | null;
}

export interface UnitRow {
  code: string | null;
  stand_value: string | number | null;
  divide_value: string | number | null;
  ratio: string | number | null;
}

export interface WarehouseRow {
  code: string;
  name_1: string | null;
}

export interface ShelfRow {
  code: string;
  name_1: string | null;
  whcode: string | null;
}

export interface ItemLocationDbRow {
  wh_code: string;
  wh_name: string | null;
  shelf_code: string;
  shelf_name: string | null;
}

export interface PurchaseHistoryDbRow {
  doc_no: string;
  doc_date: string; // TO_CHAR → 'YYYY-MM-DD'
  cust_code: string | null;
  vendor_name: string | null;
  qty: string | number | null;
  price: string | number | null;
  unit_code: string | null;
  vat_type: number | null;
}

export interface StockAndCostRow {
  balance_qty_display: string | number | null;
  average_cost_end: string | number | null;
}

@Injectable()
export class StockAdjustRepository {
  constructor(private readonly pool: PoolManagerService) {}

  // ──────────────────────────── Items ────────────────────────────

  /**
   * Search ic_inventory + pagination (query limit+1 → has_more)
   * - query ว่าง → คืนทั้งหมด (เรียงตาม code)
   * - query มี → substring match บน code และ name_1
   */
  async searchItems(
    tenant: TenantRef,
    query: string,
    offset: number,
    limit: number,
  ): Promise<ItemRow[]> {
    const params: (string | number)[] = [];
    let whereClause = '';
    if (query) {
      const like = `%${query}%`;
      params.push(like);
      whereClause = `WHERE code ILIKE $1 OR name_1 ILIKE $1`;
    }
    params.push(limit, offset);
    const limitIdx = params.length - 1;
    const offsetIdx = params.length;

    const result = await this.pool.query<ItemRow>(
      tenant,
      `SELECT code, name_1, unit_standard, average_cost
         FROM ic_inventory
         ${whereClause}
        ORDER BY code
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
      { timeout: 10_000 },
    );
    return result.rows;
  }

  async findItemByCode(
    tenant: TenantRef,
    code: string,
  ): Promise<ItemRow | null> {
    const result = await this.pool.query<ItemRow>(
      tenant,
      `SELECT code, name_1, unit_standard, average_cost
         FROM ic_inventory
        WHERE code = $1
        LIMIT 1`,
      [code],
      { timeout: 5_000 },
    );
    return result.rows[0] ?? null;
  }

  /**
   * ดึงหน่วยนับของ item จาก ic_unit_use
   * - filter status=1 (active) — COALESCE(status, 1) เพื่อรองรับ NULL ของ row เก่า
   * - order by row_order, line_number ตาม SMLERP convention
   */
  async findUnitsByItemCode(
    tenant: TenantRef,
    code: string,
  ): Promise<UnitRow[]> {
    const result = await this.pool.query<UnitRow>(
      tenant,
      `SELECT code, stand_value, divide_value, ratio
         FROM ic_unit_use
        WHERE ic_code = $1 AND COALESCE(status, 1) = 1
        ORDER BY row_order, line_number`,
      [code],
      { timeout: 5_000 },
    );
    return result.rows;
  }

  // ──────────────────────────── Warehouses / Shelves ────────────────────────────

  async searchWarehouses(
    tenant: TenantRef,
    query: string,
  ): Promise<WarehouseRow[]> {
    const like = `%${query}%`;
    const result = await this.pool.query<WarehouseRow>(
      tenant,
      `SELECT code, name_1
         FROM ic_warehouse
        WHERE code ILIKE $1 OR name_1 ILIKE $1
        ORDER BY code
        LIMIT 100`,
      [like],
      { timeout: 5_000 },
    );
    return result.rows;
  }

  async searchShelves(
    tenant: TenantRef,
    query: string,
    whCode: string,
  ): Promise<ShelfRow[]> {
    const like = `%${query}%`;
    const params: (string | number)[] = [like];
    let whClause = '';
    if (whCode) {
      params.push(whCode);
      whClause = ` AND whcode = $${params.length}`;
    }

    const result = await this.pool.query<ShelfRow>(
      tenant,
      `SELECT code, name_1, whcode
         FROM ic_shelf
        WHERE (code ILIKE $1 OR name_1 ILIKE $1)${whClause}
        ORDER BY code
        LIMIT 100`,
      params,
      { timeout: 5_000 },
    );
    return result.rows;
  }

  // ──────────────────────────── Item Locations (Bulk IA by Location) ────────────────────────────

  /**
   * คืนทุก (wh, shelf) ที่สินค้านี้ **เคยมี transaction** ใน ic_trans_detail
   * — source-of-truth ให้ตรงกับเมนู "ปรับปรุงสินค้า" (getStockAndCost) ซึ่งคำนวณจาก trans_detail เหมือนกัน
   *
   * เดิมเคย query จาก ic_wh_shelf (ตาราง register/allocation) — แต่ลูกค้าจำนวนหนึ่ง
   * (เช่น WAWACRM) ไม่ได้ register ล่วงหน้า → ic_wh_shelf ว่าง แม้จะมีของจริง
   * ทำให้ bulk เมนูขึ้น "ไม่มีที่เก็บ" ทั้งที่เมนู single เจอปกติ
   *
   * FE filter stock_qty > 0 ทิ้งอยู่แล้ว → shelf ที่ยกออกจนหมดจะไม่โผล่บน UI
   */
  async findItemLocations(
    tenant: TenantRef,
    itemCode: string,
  ): Promise<ItemLocationDbRow[]> {
    const result = await this.pool.query<ItemLocationDbRow>(
      tenant,
      `SELECT DISTINCT
              d.wh_code,
              w.name_1 AS wh_name,
              d.shelf_code,
              s.name_1 AS shelf_name
         FROM ic_trans_detail d
         LEFT JOIN ic_warehouse w ON w.code = d.wh_code
         LEFT JOIN ic_shelf s ON s.code = d.shelf_code AND s.whcode = d.wh_code
        WHERE d.item_code = $1
          AND d.last_status = 0
          AND d.is_doc_copy = 0
          AND d.wh_code <> ''
          AND d.shelf_code <> ''
        ORDER BY d.wh_code, d.shelf_code`,
      [itemCode],
      { timeout: 15_000 },
    );
    return result.rows;
  }

  // ──────────────────────────── Purchase History ────────────────────────────

  /**
   * trans_flag=12 (PO), last_status=0 (active)
   * TO_CHAR(doc_date, 'YYYY-MM-DD') → กัน timezone bug
   */
  async findPurchaseHistory(
    tenant: TenantRef,
    itemCode: string,
    offset: number,
    limit: number,
  ): Promise<PurchaseHistoryDbRow[]> {
    const result = await this.pool.query<PurchaseHistoryDbRow>(
      tenant,
      `SELECT t.doc_no,
              TO_CHAR(t.doc_date, 'YYYY-MM-DD') AS doc_date,
              t.cust_code,
              s.name_1 AS vendor_name,
              d.qty, d.price, d.unit_code, d.vat_type
         FROM ic_trans t
         JOIN ic_trans_detail d ON d.trans_flag = t.trans_flag AND d.doc_no = t.doc_no
         LEFT JOIN ap_supplier s ON s.code = t.cust_code
        WHERE t.trans_flag = 12
          AND t.last_status = 0
          AND d.item_code = $1
        ORDER BY t.doc_date DESC, t.doc_no DESC
        LIMIT $2 OFFSET $3`,
      [itemCode, limit, offset],
      { timeout: 15_000 },
    );
    return result.rows;
  }

  // ──────────────────────────── Stock + Cost (mirror SMLERP "ปกติ" mode) ────────────────────────────

  /**
   * Mirror SMLERPControl._icInfoProcess._stkStockInfoAndBalanceQuery (costMode=ปกติ)
   *
   * shelfCode:
   *   - undefined → balanceType=ยอดคงเหลือตามคลัง (GROUP BY item, wh)
   *   - provided  → balanceType=ยอดคงเหลือตามที่เก็บ (GROUP BY item, wh, shelf)
   *   balance_qty + avgCostEnd (subquery ทุนล่าสุด) filter shelf ทั้งคู่
   *
   * Trans flag groups:
   *   เข้า: 70,54,60,58,310,12 ; 66(qty>0) ; 14(inq=0) ; 48(inq<2)
   *   ออก: 56,68,72,44        ; 66(qty<0) ; 46(inq IN 0,2) ; 16(inq IN 0,2) ; 311(inq=0)
   *   Exclude: doc_ref<>'' AND is_pos=1
   *
   * Returns:
   *   balance_qty_display = balance_qty ÷ unit_standard_ratio (qty ในหน่วย unit_standard)
   *   average_cost_end    = average_cost ของ trans active ล่าสุด × unit_ratio
   */
  async getStockAndCost(
    tenant: TenantRef,
    itemCode: string,
    whCode: string,
    asOfDate: string,
    shelfCode?: string,
  ): Promise<{ stockQty: number; avgCostEnd: number }> {
    if (!itemCode || !whCode) return { stockQty: 0, avgCostEnd: 0 };

    const shelf = (shelfCode || '').trim();
    const shelfFilterOuter = shelf ? ` AND shelf_code = $4` : '';
    // เดิม subquery ทุนล่าสุด filter แค่ item_code (mirror SMLERP22 pattern)
    // ถ้า caller ส่ง shelf → tighten subquery ให้ตรง (wh, shelf) ที่ user เลือก
    const whShelfFilterInner = shelf
      ? ` AND d.wh_code = $2 AND d.shelf_code = $4`
      : '';
    const groupByCols = shelf
      ? `item_code, wh_code, shelf_code`
      : `item_code, wh_code`;

    const sql = `
WITH t1 AS (
  SELECT
    item_code AS ic_code,
    wh_code   AS warehouse,
    COALESCE(SUM(calc_flag * (
      CASE WHEN (
        (trans_flag IN (70,54,60,58,310,12)
         OR (trans_flag=66 AND qty>0)
         OR (trans_flag=14 AND inquiry_type=0)
         OR (trans_flag=48 AND inquiry_type<2))
        OR (
          (trans_flag IN (56,68,72,44)
           OR (trans_flag=66 AND qty<0)
           OR (trans_flag=46 AND inquiry_type IN (0,2))
           OR (trans_flag=16 AND inquiry_type IN (0,2))
           OR (trans_flag=311 AND inquiry_type=0))
          AND NOT (ic_trans_detail.doc_ref <> '' AND ic_trans_detail.is_pos = 1)
        )
      ) THEN ROUND((qty*stand_value)::numeric / NULLIF(divide_value,0), 3)
        ELSE 0 END
    )),0) AS balance_qty,
    COALESCE(SUM(calc_flag * (
      CASE WHEN (
        (trans_flag IN (70,54,60,58,310,12)
         OR (trans_flag=66 AND (qty>0 OR sum_of_cost>0))
         OR (trans_flag=14)
         OR (trans_flag=48 AND inquiry_type<2))
        OR (
          (trans_flag IN (56,68,72,44)
           OR (trans_flag=66 AND (qty<0 OR sum_of_cost<0))
           OR (trans_flag=46)
           OR (trans_flag=16)
           OR (trans_flag=311))
          AND NOT (ic_trans_detail.doc_ref <> '' AND ic_trans_detail.is_pos = 1)
        )
      ) THEN CASE WHEN trans_flag=66 AND qty<0
                  THEN (-1 * sum_of_cost) + COALESCE(profit_lost_cost_amount,0)
                  ELSE sum_of_cost + COALESCE(profit_lost_cost_amount,0) END
        ELSE 0 END
    )),0) AS balance_amount
  FROM ic_trans_detail
  WHERE ic_trans_detail.last_status=0
    AND ic_trans_detail.item_type <> 5
    AND ic_trans_detail.is_doc_copy = 0
    AND (SELECT item_type FROM ic_inventory WHERE code = ic_trans_detail.item_code) NOT IN (1,3)
    AND doc_date_calc <= $3
    AND item_code = $1
    AND wh_code = $2${shelfFilterOuter}
  GROUP BY ${groupByCols}
),
t2 AS (
  SELECT
    t1.*,
    (SELECT NULLIF(unit_standard_stand_value,0)::numeric / NULLIF(unit_standard_divide_value,0)
       FROM ic_inventory WHERE code = t1.ic_code) AS unit_ratio,
    (SELECT NULLIF(stand_value,0)::numeric / NULLIF(divide_value,0)
       FROM ic_unit_use
       WHERE ic_unit_use.ic_code = t1.ic_code
         AND ic_unit_use.code = (SELECT unit_standard FROM ic_inventory WHERE code = t1.ic_code)
       LIMIT 1) AS unit_standard_ratio
  FROM t1
)
SELECT
  COALESCE(balance_qty / NULLIF(COALESCE(unit_standard_ratio,1),0), 0) AS balance_qty_display,
  COALESCE((
    (SELECT average_cost
       FROM ic_trans_detail d
       WHERE d.last_status=0
         AND d.item_code = t2.ic_code${whShelfFilterInner}
         AND d.doc_date_calc <= $3
         AND (
           (d.trans_flag IN (70,54,60,58,310,12)
            OR (d.trans_flag=66 AND (d.qty>0 OR d.sum_of_cost>0))
            OR (d.trans_flag=14)
            OR (d.trans_flag=48 AND d.inquiry_type<2))
           OR (
             (d.trans_flag IN (56,68,72,44)
              OR (d.trans_flag=66 AND (d.qty<0 OR d.sum_of_cost<0))
              OR (d.trans_flag=46)
              OR (d.trans_flag=16)
              OR (d.trans_flag=311))
             AND NOT (d.doc_ref <> '' AND d.is_pos = 1)
           )
         )
       ORDER BY d.doc_date_calc DESC, d.doc_time DESC, d.line_number DESC
       LIMIT 1
    ) * COALESCE(unit_ratio,1)
  ), 0) AS average_cost_end
FROM t2`;

    const params: (string | number)[] = shelf
      ? [itemCode, whCode, asOfDate, shelf]
      : [itemCode, whCode, asOfDate];

    const res = await this.pool.query<StockAndCostRow>(tenant, sql, params, {
      timeout: 30_000,
      isReport: true,
    });

    if (res.rows.length === 0) return { stockQty: 0, avgCostEnd: 0 };
    return {
      stockQty: Number(res.rows[0].balance_qty_display) || 0,
      avgCostEnd: Number(res.rows[0].average_cost_end) || 0,
    };
  }

  // ──────────────────────────── Batch lookups (validate-import) ────────────────────────────

  /**
   * ดึง item master หลาย code ใน query เดียว — ใช้ใน validate-import
   * ส่ง itemCodes ผ่าน `code = ANY($1::text[])`
   */
  async findItemsByCodes(
    tenant: TenantRef,
    itemCodes: string[],
  ): Promise<ItemRow[]> {
    if (itemCodes.length === 0) return [];
    const result = await this.pool.query<ItemRow>(
      tenant,
      `SELECT code, name_1, unit_standard
         FROM ic_inventory
        WHERE code = ANY($1::text[])`,
      [itemCodes],
      { timeout: 10_000 },
    );
    return result.rows;
  }

  /**
   * ดึง unit_use ของ items หลาย code — group ตาม ic_code ที่ฝั่ง service
   */
  async findUnitsByItemCodes(
    tenant: TenantRef,
    itemCodes: string[],
  ): Promise<Array<UnitRow & { ic_code: string }>> {
    if (itemCodes.length === 0) return [];
    const result = await this.pool.query<UnitRow & { ic_code: string }>(
      tenant,
      `SELECT ic_code, code, stand_value, divide_value, ratio
         FROM ic_unit_use
        WHERE ic_code = ANY($1::text[]) AND COALESCE(status, 1) = 1
        ORDER BY ic_code, row_order, line_number`,
      [itemCodes],
      { timeout: 10_000 },
    );
    return result.rows;
  }

  /**
   * ดึง warehouse หลาย code ใน query เดียว — ใช้ใน validate-import-balance
   */
  async findWarehousesByCodes(
    tenant: TenantRef,
    codes: string[],
  ): Promise<Array<{ code: string }>> {
    if (codes.length === 0) return [];
    const result = await this.pool.query<{ code: string }>(
      tenant,
      `SELECT code FROM ic_warehouse WHERE code = ANY($1::text[])`,
      [codes],
      { timeout: 10_000 },
    );
    return result.rows;
  }

  /**
   * ดึง shelf หลาย code ใน query เดียว (คืนคู่ code+whcode ให้ service เช็ค pair)
   */
  async findShelvesByCodes(
    tenant: TenantRef,
    codes: string[],
  ): Promise<Array<{ code: string; whcode: string | null }>> {
    if (codes.length === 0) return [];
    const result = await this.pool.query<{
      code: string;
      whcode: string | null;
    }>(
      tenant,
      `SELECT code, whcode FROM ic_shelf WHERE code = ANY($1::text[])`,
      [codes],
      { timeout: 10_000 },
    );
    return result.rows;
  }

  // ──────────────────────────── Transaction helpers (save IA) ────────────────────────────

  /**
   * Wrapper รอบ PoolManagerService.transaction — caller pass callback
   * คืน T ที่ callback return
   *
   * NOTE: ภายใน callback ใช้ `client.query()` ตรงๆ (ตาม pattern ของ PoolManagerService)
   */
  async runInTransaction<T>(
    tenant: TenantRef,
    cb: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.pool.transaction(tenant, cb);
  }

  /**
   * Lock + read doc_format (IA) ใน transaction — กัน race condition
   */
  async lockDocFormat(
    client: PoolClient,
    formatCode: string,
  ): Promise<{ format: string } | null> {
    const res = await client.query<{ format: string }>(
      `SELECT format FROM erp_doc_format WHERE code = $1 LIMIT 1 FOR UPDATE`,
      [formatCode],
    );
    return res.rows[0] ?? null;
  }

  /**
   * หา doc_no ล่าสุดที่ตรง pattern → คำนวณ running ถัดไป
   * ใช้ pgPattern ที่ build จาก format ของ erp_doc_format
   */
  async findLastDocNoInTx(
    client: PoolClient,
    transFlag: number,
    formatCode: string,
    pgPattern: string,
  ): Promise<{ doc_no: string } | null> {
    const res = await client.query<{ doc_no: string }>(
      `SELECT doc_no
         FROM ic_trans
        WHERE trans_flag = $1
          AND doc_format_code = $2
          AND doc_no ~ $3
        ORDER BY doc_no DESC
        LIMIT 1`,
      [transFlag, formatCode, pgPattern],
    );
    return res.rows[0] ?? null;
  }

  /**
   * เช็ค doc_no ซ้ำ — เรียกหลัง gen เลขใหม่ ก่อน INSERT
   */
  async isDocNoExists(
    client: PoolClient,
    transFlag: number,
    docNo: string,
  ): Promise<boolean> {
    const res = await client.query(
      `SELECT 1 FROM ic_trans WHERE trans_flag = $1 AND doc_no = $2 LIMIT 1`,
      [transFlag, docNo],
    );
    return res.rows.length > 0;
  }

  /**
   * INSERT ic_trans (header) สำหรับเอกสาร IA
   *   - status, last_status, used_status, used_status_2, doc_success = 0
   *   - branch_code = '' (ว่าง — ตรงกับที่ desktop บันทึกเอกสาร IA/RMB)
   *   - creator_code = last_editor_code = APP_CREATOR_CODE
   *   - inquiry_type = 0 (1.ปรับปรุงสินค้า)
   */
  async insertHeader(
    client: PoolClient,
    params: {
      docDate: string;
      docNo: string;
      docTime: string;
      docRef: string | null;
      docRefDate: string | null;
      totalAmount: number;
      whFrom: string;
      locationFrom: string;
      remark: string | null;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO ic_trans (
         trans_type, trans_flag,
         doc_date, doc_no, doc_format_code, doc_time,
         doc_ref, doc_ref_date,
         inquiry_type,
         total_amount,
         wh_from, location_from,
         branch_code,
         remark,
         status, last_status, used_status, used_status_2, doc_success,
         creator_code, last_editor_code,
         create_datetime, create_date_time_now
       ) VALUES (
         $1, $2,
         $3, $4, $5, $6,
         $7, $8,
         $9,
         $10,
         $11, $12,
         $13,
         $14,
         0, 0, 0, 0, 0,
         $15, $15,
         NOW(), NOW()
       )`,
      [
        IA_TRANS_TYPE, // $1
        IA_TRANS_FLAG, // $2
        params.docDate, // $3
        params.docNo, // $4
        IA_FORMAT_CODE, // $5
        params.docTime, // $6
        params.docRef, // $7
        params.docRefDate, // $8
        IA_INQUIRY_TYPE, // $9
        params.totalAmount, // $10
        params.whFrom.slice(0, 25), // $11
        params.locationFrom.slice(0, 25), // $12
        '', // $13 branch_code (desktop RMB/IA ใช้ค่าว่าง)
        params.remark, // $14
        APP_CREATOR_CODE, // $15
      ],
    );
  }

  /**
   * INSERT ic_trans_detail (1 line) สำหรับเอกสาร IA
   *   - qty = 0, price = 0 (value-only adjust)
   *   - sum_amount = sum_of_cost = sum_amount_exclude_vat = sum_of_cost_1 = rounded
   *   - ratio = 0 (smlerp ตั้งใจ set 0)
   *   - is_get_price = 1, ref_row = -1
   *   - price_type, price_mode = NULL
   *   - branch_code = '' (ว่าง — ตรงกับ desktop), calc_flag = 1
   */
  async insertDetail(
    client: PoolClient,
    params: {
      docDate: string;
      docNo: string;
      docTime: string;
      lineNumber: number;
      itemCode: string;
      itemName: string;
      unitCode: string;
      sumAmountRounded: number;
      whCode: string;
      shelfCode: string;
      standValue: number;
      divideValue: number;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO ic_trans_detail (
         trans_type, trans_flag,
         doc_date, doc_no, doc_time,
         line_number,
         item_code, item_name, unit_code,
         qty, price,
         sum_amount, sum_of_cost, sum_amount_exclude_vat,
         sum_of_cost_1, average_cost, average_cost_1,
         wh_code, shelf_code, branch_code,
         stand_value, divide_value, ratio,
         calc_flag, vat_type, item_type, inquiry_type,
         is_get_price, ref_row,
         price_type, price_mode,
         status, last_status,
         doc_date_calc, doc_time_calc,
         creator_code, last_editor_code,
         create_date_time_now
       ) VALUES (
         $1, $2,
         $3, $4, $5,
         $6,
         $7, $8, $9,
         $10, $11,
         $12, $12, $12,
         $12, $11, $11,
         $13, $14, $15,
         $16, $17, 0,
         1, 0, 0, $18,
         1, -1,
         NULL, NULL,
         0, 0,
         $3, $5,
         $19, $19,
         NOW()
       )`,
      [
        IA_TRANS_TYPE, // $1
        IA_TRANS_FLAG, // $2
        params.docDate, // $3
        params.docNo, // $4
        params.docTime, // $5
        params.lineNumber, // $6
        params.itemCode, // $7
        params.itemName.slice(0, 200), // $8
        params.unitCode, // $9
        0, // $10 qty = 0 (value-only)
        0, // $11 price = 0
        params.sumAmountRounded, // $12 sum_amount + sum_of_cost + ...
        params.whCode.slice(0, 25), // $13
        params.shelfCode.slice(0, 25), // $14
        '', // $15 branch_code (desktop RMB/IA ใช้ค่าว่าง)
        params.standValue, // $16
        params.divideValue, // $17
        IA_INQUIRY_TYPE, // $18
        APP_CREATOR_CODE, // $19
      ],
    );
  }

  // ──────────────────────────── Transaction helpers (save RMB — คงเหลือยกมา) ────────────────────────────

  /**
   * INSERT ic_trans (header) สำหรับเอกสาร RMB (คงเหลือยกมา, trans_flag=54)
   * โครงเดียวกับ insertHeader ของ IA ต่างแค่ trans_flag/format
   */
  async insertBalanceHeader(
    client: PoolClient,
    params: {
      docDate: string;
      docNo: string;
      docTime: string;
      docRef: string | null;
      docRefDate: string | null;
      totalAmount: number;
      whFrom: string;
      locationFrom: string;
      remark: string | null;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO ic_trans (
         trans_type, trans_flag,
         doc_date, doc_no, doc_format_code, doc_time,
         doc_ref, doc_ref_date,
         inquiry_type,
         total_amount,
         wh_from, location_from,
         branch_code,
         remark,
         status, last_status, used_status, used_status_2, doc_success,
         creator_code, last_editor_code,
         create_datetime, create_date_time_now
       ) VALUES (
         $1, $2,
         $3, $4, $5, $6,
         $7, $8,
         $9,
         $10,
         $11, $12,
         $13,
         $14,
         0, 0, 0, 0, 0,
         $15, $15,
         NOW(), NOW()
       )`,
      [
        RMB_TRANS_TYPE, // $1
        RMB_TRANS_FLAG, // $2
        params.docDate, // $3
        params.docNo, // $4
        RMB_FORMAT_CODE, // $5
        params.docTime, // $6
        params.docRef, // $7
        params.docRefDate, // $8
        RMB_INQUIRY_TYPE, // $9
        params.totalAmount, // $10
        params.whFrom.slice(0, 25), // $11
        params.locationFrom.slice(0, 25), // $12
        '', // $13 branch_code (desktop RMB/IA ใช้ค่าว่าง)
        params.remark, // $14
        APP_CREATOR_CODE, // $15
      ],
    );
  }

  /**
   * INSERT ic_trans_detail (1 line) สำหรับเอกสาร RMB (คงเหลือยกมา)
   * Mirror แถวที่ desktop บันทึก (ยืนยันจาก DB demo doc RMB-2606-0001):
   *   - qty = จำนวนจริง, price = ต้นทุน/หน่วย
   *   - sum_amount = sum_of_cost = sum_amount_exclude_vat = sum_of_cost_1 = qty × price
   *   - average_cost = average_cost_1 = price
   *   - ratio = 0, calc_flag = 1, is_get_price = 1, ref_row = -1
   */
  async insertBalanceDetail(
    client: PoolClient,
    params: {
      docDate: string;
      docNo: string;
      docTime: string;
      lineNumber: number;
      itemCode: string;
      itemName: string;
      unitCode: string;
      qty: number;
      price: number;
      sumAmountRounded: number;
      whCode: string;
      shelfCode: string;
      standValue: number;
      divideValue: number;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO ic_trans_detail (
         trans_type, trans_flag,
         doc_date, doc_no, doc_time,
         line_number,
         item_code, item_name, unit_code,
         qty, price,
         sum_amount, sum_of_cost, sum_amount_exclude_vat,
         sum_of_cost_1, average_cost, average_cost_1,
         wh_code, shelf_code, branch_code,
         stand_value, divide_value, ratio,
         calc_flag, vat_type, item_type, inquiry_type,
         is_get_price, ref_row,
         price_type, price_mode,
         status, last_status,
         doc_date_calc, doc_time_calc,
         creator_code, last_editor_code,
         create_date_time_now
       ) VALUES (
         $1, $2,
         $3, $4, $5,
         $6,
         $7, $8, $9,
         $10, $11,
         $12, $12, $12,
         $12, $11, $11,
         $13, $14, $15,
         $16, $17, 0,
         1, 0, 0, $18,
         1, -1,
         NULL, NULL,
         0, 0,
         $3, $5,
         $19, $19,
         NOW()
       )`,
      [
        RMB_TRANS_TYPE, // $1
        RMB_TRANS_FLAG, // $2
        params.docDate, // $3
        params.docNo, // $4
        params.docTime, // $5
        params.lineNumber, // $6
        params.itemCode, // $7
        params.itemName.slice(0, 200), // $8
        params.unitCode, // $9
        params.qty, // $10 จำนวนจริง
        params.price, // $11 ต้นทุน/หน่วย → average_cost ด้วย
        params.sumAmountRounded, // $12 sum_amount + sum_of_cost + ...
        params.whCode.slice(0, 25), // $13
        params.shelfCode.slice(0, 25), // $14
        '', // $15 branch_code (desktop RMB/IA ใช้ค่าว่าง)
        params.standValue, // $16
        params.divideValue, // $17
        RMB_INQUIRY_TYPE, // $18
        APP_CREATOR_CODE, // $19
      ],
    );
  }
}
