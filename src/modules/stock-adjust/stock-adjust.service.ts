import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DocNoService } from '../../core/doc-no/doc-no.service';
import { ErpOptionService } from '../../core/erp-option/erp-option.service';
import { ErrorCode } from '../../core/error/error-codes';
import {
  IA_FORMAT_CODE,
  IA_TRANS_FLAG,
} from './stock-adjust.constants';
import {
  StockAdjustRepository,
  type ItemRow,
  type PurchaseHistoryDbRow,
  type ShelfRow,
  type UnitRow,
  type WarehouseRow,
} from './stock-adjust.repository';
import {
  expandDocNo,
  nullIfEmpty,
  round2,
  round5,
} from './stock-adjust.util';
import type {
  ItemOption,
  SearchItemsResponse,
} from './dto/search-items.dto';
import type {
  GetItemDefaultsResponse,
  UnitOption,
} from './dto/get-item-defaults.dto';
import type { WarehouseOption } from './dto/search-warehouses.dto';
import type { ShelfOption } from './dto/search-shelves.dto';
import type {
  GetPurchaseHistoryResponse,
  PurchaseHistoryRow,
} from './dto/get-purchase-history.dto';
import type {
  ValidateImportBody,
  ValidateImportResponse,
  ValidatedImportRow,
} from './dto/validate-import.dto';
import type {
  SaveStockAdjustBody,
  SaveStockAdjustResponse,
} from './dto/save-stock-adjust.dto';

/**
 * Stock-Adjust Service — business logic ของ IA module
 *
 * Dependency:
 *   - StockAdjustRepository (local) — raw SQL
 *   - DocNoService          (core)  — gen doc_no (จะใช้ใน Part 5: save IA)
 *   - ErpOptionService      (core)  — vat_rate / decimal (จะใช้ใน Part 5)
 *
 * Mapping ทุก method มาจาก source pre-migration
 * (NextStep_Stock_Adjust/src/actions/stock-adjust.ts @ commit 720e989)
 */
@Injectable()
export class StockAdjustService {
  private readonly logger = new Logger(StockAdjustService.name);

  constructor(
    private readonly repo: StockAdjustRepository,
    private readonly docNo: DocNoService,
    private readonly erpOption: ErpOptionService,
  ) {}

  // ──────────────────────────── Items ────────────────────────────

  async searchItems(
    database: string,
    query: string,
    offset: number,
    limit: number,
  ): Promise<SearchItemsResponse> {
    const q = (query || '').trim().slice(0, 50);
    const safeLimit = clampInt(limit, 1, 100, 30);
    const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));

    // query limit+1 → has_more
    const rows = await this.repo.searchItems(
      database,
      q,
      safeOffset,
      safeLimit + 1,
    );
    const has_more = rows.length > safeLimit;
    const mapped: ItemOption[] = rows
      .slice(0, safeLimit)
      .map((r) => this.mapItem(r));

    return { rows: mapped, has_more };
  }

  async getItemDefaults(
    database: string,
    itemCode: string,
    whCode: string,
  ): Promise<GetItemDefaultsResponse> {
    const code = (itemCode || '').trim();
    if (!code) return { item: null, units: [], stock_qty: 0 };

    const itemRow = await this.repo.findItemByCode(database, code);
    if (!itemRow) return { item: null, units: [], stock_qty: 0 };

    const item = this.mapItem(itemRow);

    const unitRows = await this.repo.findUnitsByItemCode(database, code);
    const units: UnitOption[] = unitRows.map((u) => this.mapUnit(u));
    // ถ้าไม่มี unit แต่มี unit_standard → push default 1:1:1
    if (units.length === 0 && item.unit_standard) {
      units.push({
        code: item.unit_standard,
        stand_value: 1,
        divide_value: 1,
        ratio: 1,
      });
    }

    // ถ้ามี whCode → query stock + cost + override average_cost
    let stockQty = 0;
    const wh = (whCode || '').trim();
    if (wh) {
      const today = new Date().toISOString().slice(0, 10);
      const { stockQty: q, avgCostEnd } = await this.repo.getStockAndCost(
        database,
        code,
        wh,
        today,
      );
      stockQty = q;
      item.average_cost = avgCostEnd; // override ด้วยทุนจริงในคลัง
    }

    return { item, units, stock_qty: stockQty };
  }

  // ──────────────────────────── Warehouses / Shelves ────────────────────────────

  async searchWarehouses(
    database: string,
    query: string,
  ): Promise<WarehouseOption[]> {
    const q = (query || '').trim().slice(0, 50);
    const rows = await this.repo.searchWarehouses(database, q);
    return rows.map((r) => this.mapWarehouse(r));
  }

  async searchShelves(
    database: string,
    query: string,
    whCode: string,
  ): Promise<ShelfOption[]> {
    const q = (query || '').trim().slice(0, 50);
    const wh = (whCode || '').trim();
    const rows = await this.repo.searchShelves(database, q, wh);
    return rows.map((r) => this.mapShelf(r));
  }

  // ──────────────────────────── Purchase History ────────────────────────────

  async getPurchaseHistory(
    database: string,
    itemCode: string,
    offset: number,
    limit: number,
  ): Promise<GetPurchaseHistoryResponse> {
    const code = (itemCode || '').trim();
    if (!code) return { rows: [], has_more: false };

    const safeLimit = clampInt(limit, 1, 100, 10);
    const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));

    const rows = await this.repo.findPurchaseHistory(
      database,
      code,
      safeOffset,
      safeLimit + 1,
    );
    const has_more = rows.length > safeLimit;
    const mapped: PurchaseHistoryRow[] = rows
      .slice(0, safeLimit)
      .map((r) => this.mapPurchaseHistory(r));

    return { rows: mapped, has_more };
  }

  // ──────────────────────────── Validate Import ────────────────────────────

  /**
   * Validate Excel import rows
   * - Batch query items + units ก่อน (กัน N+1)
   * - Per-row sync validation
   * - Concurrent (batch 10) stock+cost
   * - Response 200 ทุก case (error per-row, ไม่ throw)
   */
  async validateImport(
    database: string,
    body: ValidateImportBody,
  ): Promise<ValidateImportResponse> {
    const { rows, wh_code } = body;
    if (rows.length === 0) {
      return { rows: [], total: 0, ok_count: 0, error_count: 0 };
    }

    // unique item codes
    const itemCodes = Array.from(
      new Set(rows.map((r) => (r.item_code || '').trim()).filter(Boolean)),
    );

    // batch 1: items
    const itemRows = await this.repo.findItemsByCodes(database, itemCodes);
    const itemMap = new Map<string, { name: string; unit_standard: string }>();
    for (const r of itemRows) {
      itemMap.set(r.code, {
        name: (r.name_1 ?? '').trim(),
        unit_standard: r.unit_standard ?? '',
      });
    }

    // batch 2: units (group ตาม ic_code)
    const unitRows = await this.repo.findUnitsByItemCodes(database, itemCodes);
    const unitMap = new Map<
      string,
      { code: string; stand_value: number; divide_value: number; ratio: number }[]
    >();
    for (const u of unitRows) {
      const list = unitMap.get(u.ic_code) || [];
      list.push({
        code: u.code ?? '',
        stand_value: toNumber(u.stand_value, 1),
        divide_value: toNumber(u.divide_value, 1),
        ratio: toNumber(u.ratio, 1),
      });
      unitMap.set(u.ic_code, list);
    }

    // pre-validate (sync) — collect rows ที่ผ่าน basic check → query stock+cost ทีหลัง
    type NeedQuery = { row: ValidatedImportRow; itemCode: string };
    const validated: ValidatedImportRow[] = [];
    const needs: NeedQuery[] = [];

    for (const r of rows) {
      const item_code = (r.item_code || '').trim();
      const unit_code = (r.unit_code || '').trim();
      const new_cost = Number(r.new_cost);

      const out: ValidatedImportRow = {
        row_index: r.row_index,
        item_code,
        unit_code,
        new_cost,
        valid: false,
      };

      if (!item_code) {
        out.error = 'รหัสสินค้าว่าง';
        validated.push(out);
        continue;
      }
      if (!unit_code) {
        out.error = 'หน่วยว่าง';
        validated.push(out);
        continue;
      }
      if (!Number.isFinite(new_cost)) {
        out.error = 'ทุนเฉลี่ยที่ต้องการผิด format';
        validated.push(out);
        continue;
      }
      if (new_cost < 0) {
        out.error = 'ต้นทุนติดลบ';
        validated.push(out);
        continue;
      }

      const item = itemMap.get(item_code);
      if (!item) {
        out.error = 'ไม่พบสินค้า';
        validated.push(out);
        continue;
      }

      const units = unitMap.get(item_code) || [];
      const unit = units.find((u) => u.code === unit_code);
      if (!unit) {
        out.error = `หน่วย "${unit_code}" ไม่ตรงกับสินค้า ${item_code}`;
        out.item_name = item.name;
        out.unit_standard = item.unit_standard;
        out.units = units;
        validated.push(out);
        continue;
      }

      // basic OK → ค่อย query cost/stock
      out.item_name = item.name;
      out.unit_standard = item.unit_standard;
      out.units = units;
      out.stand_value = unit.stand_value;
      out.divide_value = unit.divide_value;
      validated.push(out);
      needs.push({ row: out, itemCode: item_code });
    }

    // concurrent batch 10 — กัน DB overload
    const asOfDate = new Date().toISOString().slice(0, 10);
    const BATCH = 10;
    for (let i = 0; i < needs.length; i += BATCH) {
      const slice = needs.slice(i, i + BATCH);
      await Promise.all(
        slice.map(async ({ row, itemCode }) => {
          try {
            const { stockQty, avgCostEnd } = await this.repo.getStockAndCost(
              database,
              itemCode,
              wh_code,
              asOfDate,
            );
            row.old_cost = avgCostEnd;
            row.stock_qty = stockQty;
            row.valid = true;
          } catch (e: unknown) {
            row.error = `query stock ผิดพลาด: ${
              e instanceof Error ? e.message : 'unknown'
            }`;
          }
        }),
      );
    }

    const ok_count = validated.filter((v) => v.valid).length;
    return {
      rows: validated,
      total: validated.length,
      ok_count,
      error_count: validated.length - ok_count,
    };
  }

  // ──────────────────────────── Save Stock Adjust ────────────────────────────

  /**
   * Save IA — transaction หลาย table
   *   1. Lock erp_doc_format → gen doc_no in-tx (FOR UPDATE)
   *   2. Check duplicate doc_no
   *   3. round5 sum_amount per line → round2 total
   *   4. INSERT ic_trans (header) + ic_trans_detail (each line)
   *
   * NOTE: ไม่เรียก core/DocNoService เพราะไม่ transaction-aware
   *       (port logic inline เพื่อกัน race condition)
   */
  async saveStockAdjust(
    database: string,
    body: SaveStockAdjustBody,
  ): Promise<SaveStockAdjustResponse> {
    // กรอง line ที่ sum_amount = 0 ออก (no-op)
    const validLines = body.lines.filter(
      (l) => l.item_code && Number(l.sum_amount) !== 0,
    );
    if (validLines.length === 0) {
      throw new BadRequestException({
        code: ErrorCode.EMPTY_LINES,
        message: 'กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ',
      });
    }

    // ตรวจ sum_amount + unit_code อีกรอบ
    for (const l of validLines) {
      if (!Number.isFinite(Number(l.sum_amount))) {
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_ERROR,
          message: `มูลค่าไม่ถูกต้อง: ${l.item_code}`,
        });
      }
      if (!l.unit_code) {
        throw new BadRequestException({
          code: ErrorCode.UNIT_NOT_FOUND,
          message: `กรุณาเลือกหน่วยของสินค้า: ${l.item_code}`,
        });
      }
    }

    const docTime = this.resolveDocTime(body.doc_time);

    const result = await this.repo.runInTransaction(database, async (client) => {
      // 1. lock + gen doc_no
      const fmt = await this.repo.lockDocFormat(client, IA_FORMAT_CODE);
      if (!fmt) {
        throw new NotFoundException({
          code: ErrorCode.DOC_FORMAT_NOT_FOUND,
          message: `ไม่พบ doc_format "${IA_FORMAT_CODE}" ใน erp_doc_format`,
        });
      }
      const format = fmt.format || '';
      if (!format) {
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_ERROR,
          message: 'format ของ doc_format ว่าง',
        });
      }

      const docNoStr = await expandDocNo({
        format,
        docDate: body.doc_date,
        formatCode: IA_FORMAT_CODE,
        findLast: async (pgPattern) => {
          const last = await this.repo.findLastDocNoInTx(
            client,
            IA_TRANS_FLAG,
            IA_FORMAT_CODE,
            pgPattern,
          );
          return last?.doc_no;
        },
      });

      // 2. check duplicate
      const exists = await this.repo.isDocNoExists(
        client,
        IA_TRANS_FLAG,
        docNoStr,
      );
      if (exists) {
        throw new ConflictException({
          code: ErrorCode.DUPLICATE_DOC_NO,
          message: `เลขที่เอกสาร ${docNoStr} ซ้ำ — กรุณาลองใหม่`,
        });
      }

      // 3. round + compute total
      type ComputedLine = (typeof validLines)[number] & {
        sum_amount_rounded: number;
        wh_code_final: string;
        shelf_code_final: string;
      };
      const computed: ComputedLine[] = validLines.map((l) => ({
        ...l,
        wh_code_final: (l.wh_code || body.wh_from) ?? '',
        shelf_code_final: (l.shelf_code || body.location_from) ?? '',
        sum_amount_rounded: round5(Number(l.sum_amount)),
      }));
      const totalAmount = round2(
        computed.reduce((s, l) => s + l.sum_amount_rounded, 0),
      );

      // 4. INSERT header
      await this.repo.insertHeader(client, {
        docDate: body.doc_date,
        docNo: docNoStr,
        docTime,
        docRef: nullIfEmpty(body.doc_ref?.slice(0, 255)),
        docRefDate: body.doc_ref_date || null,
        totalAmount,
        whFrom: body.wh_from || '',
        locationFrom: body.location_from || '',
        remark: nullIfEmpty(body.remark?.slice(0, 255)),
      });

      // 5. INSERT details
      let lineNumber = 0;
      for (const ln of computed) {
        await this.repo.insertDetail(client, {
          docDate: body.doc_date,
          docNo: docNoStr,
          docTime,
          lineNumber,
          itemCode: ln.item_code,
          itemName: ln.item_name || '',
          unitCode: ln.unit_code,
          sumAmountRounded: ln.sum_amount_rounded,
          whCode: ln.wh_code_final,
          shelfCode: ln.shelf_code_final,
          standValue: ln.stand_value,
          divideValue: ln.divide_value,
        });
        lineNumber++;
      }

      return { doc_no: docNoStr, total_amount: totalAmount };
    });

    this.logger.log(
      `Saved IA ${result.doc_no} total=${result.total_amount} lines=${validLines.length}`,
    );
    return result;
  }

  // ──────────────────────────── Save helpers ────────────────────────────

  private resolveDocTime(input: string | undefined): string {
    if (input && /^\d{2}:\d{2}$/.test(input)) return input;
    const n = new Date();
    return `${String(n.getHours()).padStart(2, '0')}:${String(
      n.getMinutes(),
    ).padStart(2, '0')}`;
  }

  // ──────────────────────────── Mappers ────────────────────────────

  private mapItem(r: ItemRow): ItemOption {
    return {
      code: r.code,
      name: (r.name_1 ?? '').trim(),
      unit_standard: r.unit_standard ?? '',
      average_cost: toNumber(r.average_cost),
    };
  }

  private mapUnit(u: UnitRow): UnitOption {
    return {
      code: u.code ?? '',
      stand_value: toNumber(u.stand_value, 1),
      divide_value: toNumber(u.divide_value, 1),
      ratio: toNumber(u.ratio, 1),
    };
  }

  private mapWarehouse(r: WarehouseRow): WarehouseOption {
    return { code: r.code, name: (r.name_1 ?? '').trim() };
  }

  private mapShelf(r: ShelfRow): ShelfOption {
    return {
      code: r.code,
      name: (r.name_1 ?? '').trim(),
      wh_code: r.whcode ?? '',
    };
  }

  private mapPurchaseHistory(r: PurchaseHistoryDbRow): PurchaseHistoryRow {
    return {
      doc_no: r.doc_no,
      doc_date: r.doc_date ? String(r.doc_date).slice(0, 10) : '',
      vendor_code: (r.cust_code ?? '').trim(),
      vendor_name: (r.vendor_name ?? '').trim(),
      qty: toNumber(r.qty),
      price: toNumber(r.price),
      unit_code: r.unit_code ?? '',
      vat_type: Number(r.vat_type) || 0,
    };
  }
}

// ──────────────────────────── helpers ────────────────────────────

function clampInt(
  value: number | string | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(n, max));
}

function toNumber(
  value: string | number | null | undefined,
  fallback = 0,
): number {
  if (value === null || value === undefined) return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}
