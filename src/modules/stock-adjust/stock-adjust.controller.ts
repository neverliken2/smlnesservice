import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ZodSchema, ZodError } from 'zod';
import { Tenant } from '../../core/tenant/tenant.decorator';
import type { TenantContext } from '../../core/tenant/tenant.types';
import { ErrorCode } from '../../core/error/error-codes';
import { StockAdjustService } from './stock-adjust.service';
import {
  SearchItemsQuerySchema,
  type SearchItemsResponse,
} from './dto/search-items.dto';
import {
  GetItemDefaultsQuerySchema,
  type GetItemDefaultsResponse,
} from './dto/get-item-defaults.dto';
import {
  SearchWarehousesQuerySchema,
  type WarehouseOption,
} from './dto/search-warehouses.dto';
import {
  SearchShelvesQuerySchema,
  type ShelfOption,
} from './dto/search-shelves.dto';
import {
  GetPurchaseHistoryQuerySchema,
  type GetPurchaseHistoryResponse,
} from './dto/get-purchase-history.dto';
import type { GetItemLocationsResponse } from './dto/get-item-locations.dto';
import {
  ValidateImportBodySchema,
  type ValidateImportResponse,
} from './dto/validate-import.dto';
import {
  SaveStockAdjustBodySchema,
  type SaveStockAdjustResponse,
} from './dto/save-stock-adjust.dto';

/**
 * Stock-Adjust Controller — REST endpoints ของ IA module
 *
 * Prefix: /api/v1/stock-adjust
 * Auth: ทุก endpoint ผ่าน global JwtAuthGuard (session JWT)
 *
 * Part 4 — read endpoints (5):
 *   GET  /items
 *   GET  /items/:itemCode
 *   GET  /warehouses
 *   GET  /shelves
 *   GET  /purchase-history/:itemCode
 *
 * Part 5 (จะเพิ่มทีหลัง) — write endpoints (validate-import, save IA)
 */
@ApiTags('stock-adjust')
@ApiBearerAuth('sessionJwt')
@Controller('stock-adjust')
export class StockAdjustController {
  constructor(private readonly svc: StockAdjustService) {}

  // ──────────────────────────── /items ────────────────────────────

  @Get('items')
  @ApiOperation({
    summary: 'Search items (paginated)',
    description:
      'Substring match บน code + name_1 (ic_inventory). Query ว่าง = list ทั้งหมด. Default limit=30, max=100. has_more จาก limit+1 trick.',
  })
  @ApiQuery({ name: 'query', required: false, example: '02-' })
  @ApiQuery({ name: 'offset', required: false, example: 0 })
  @ApiQuery({ name: 'limit', required: false, example: 30 })
  async searchItems(
    @Tenant() tenant: TenantContext,
    @Query() query: unknown,
  ): Promise<SearchItemsResponse> {
    const parsed = this.parse(SearchItemsQuerySchema, query);
    return this.svc.searchItems(
      tenant,
      parsed.query,
      parsed.offset,
      parsed.limit,
    );
  }

  @Get('items/:itemCode')
  @ApiOperation({
    summary: 'Get item defaults (info + units + stock + cost)',
    description:
      'ดึงข้อมูล item + รายการหน่วยจาก ic_unit_use (status=1). ถ้าระบุ whCode → query stock+cost (mirror SMLERP `_stkStockInfoAndBalanceQuery` ปกติ) แล้ว override average_cost = avgCostEnd. ถ้าระบุ shelfCode ด้วย → คำนวณ per (wh, shelf) แทน per wh',
  })
  @ApiParam({ name: 'itemCode', example: '02-0006' })
  @ApiQuery({ name: 'whCode', required: false, example: 'MMA01' })
  @ApiQuery({ name: 'shelfCode', required: false, example: 'SH101' })
  async getItemDefaults(
    @Tenant() tenant: TenantContext,
    @Param('itemCode') itemCode: string,
    @Query() query: unknown,
  ): Promise<GetItemDefaultsResponse> {
    const parsed = this.parse(GetItemDefaultsQuerySchema, query);
    return this.svc.getItemDefaults(
      tenant,
      itemCode,
      parsed.whCode,
      parsed.shelfCode,
    );
  }

  // ──────────────────────────── /warehouses ────────────────────────────

  @Get('warehouses')
  @ApiOperation({
    summary: 'Search warehouses',
    description: 'Substring match บน code + name_1 (ic_warehouse). LIMIT 100.',
  })
  @ApiQuery({ name: 'query', required: false, example: 'MMA' })
  async searchWarehouses(
    @Tenant() tenant: TenantContext,
    @Query() query: unknown,
  ): Promise<WarehouseOption[]> {
    const parsed = this.parse(SearchWarehousesQuerySchema, query);
    return this.svc.searchWarehouses(tenant, parsed.query);
  }

  // ──────────────────────────── /shelves ────────────────────────────

  @Get('shelves')
  @ApiOperation({
    summary: 'Search shelves (filter by warehouse)',
    description:
      'Substring match บน code + name_1 (ic_shelf). ถ้าระบุ whCode → filter ตามคลัง. LIMIT 100.',
  })
  @ApiQuery({ name: 'query', required: false })
  @ApiQuery({ name: 'whCode', required: false, example: 'MMA01' })
  async searchShelves(
    @Tenant() tenant: TenantContext,
    @Query() query: unknown,
  ): Promise<ShelfOption[]> {
    const parsed = this.parse(SearchShelvesQuerySchema, query);
    return this.svc.searchShelves(tenant, parsed.query, parsed.whCode);
  }

  // ──────────────────────────── /item-locations/:itemCode ────────────────────────────

  @Get('item-locations/:itemCode')
  @ApiOperation({
    summary: 'Get item locations + stock + cost (Bulk IA by Location)',
    description:
      'คืนทุก (wh, shelf) ที่สินค้านี้เคยมี transaction ใน ic_trans_detail พร้อม stock_qty + old_cost ' +
      'ต่อ wh (cache ต่อ wh — query getStockAndCost ครั้งเดียวต่อ wh). ' +
      'ใช้กับหน้า "ปรับต้นทุนทุกที่เก็บ" — 1 ใบเอกสารต่อแถวที่ user เลือก.',
  })
  @ApiParam({ name: 'itemCode', example: '02-0006' })
  async getItemLocations(
    @Tenant() tenant: TenantContext,
    @Param('itemCode') itemCode: string,
  ): Promise<GetItemLocationsResponse> {
    return this.svc.getItemLocations(tenant, itemCode);
  }

  // ──────────────────────────── /purchase-history/:itemCode ────────────────────────────

  @Get('purchase-history/:itemCode')
  @ApiOperation({
    summary: 'Purchase history of an item (trans_flag=12, last_status=0)',
    description:
      'ประวัติการซื้อของ item, paginate ด้วย limit+1. doc_date เป็น ISO YYYY-MM-DD (TO_CHAR — กัน timezone bug). Default limit=10, max=100.',
  })
  @ApiParam({ name: 'itemCode', example: '12-0869' })
  @ApiQuery({ name: 'offset', required: false, example: 0 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  async getPurchaseHistory(
    @Tenant() tenant: TenantContext,
    @Param('itemCode') itemCode: string,
    @Query() query: unknown,
  ): Promise<GetPurchaseHistoryResponse> {
    const parsed = this.parse(GetPurchaseHistoryQuerySchema, query);
    return this.svc.getPurchaseHistory(
      tenant,
      itemCode,
      parsed.offset,
      parsed.limit,
    );
  }

  // ──────────────────────────── POST /validate-import ────────────────────────────

  @Post('validate-import')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Validate Excel import rows (batch ≤ 1000)',
    description:
      'Batch query items + units (กัน N+1) แล้ว validate ทีละ row. ' +
      'Concurrent (batch 10) ดึง stock+cost. Response 200 ทุก case — error อยู่ใน row.error',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['rows', 'wh_code'],
      properties: {
        rows: {
          type: 'array',
          maxItems: 1000,
          items: {
            type: 'object',
            properties: {
              row_index: { type: 'number' },
              item_code: { type: 'string' },
              unit_code: { type: 'string' },
              new_cost: { type: 'number' },
            },
          },
        },
        wh_code: { type: 'string' },
        shelf_code: { type: 'string' },
      },
    },
  })
  async validateImport(
    @Tenant() tenant: TenantContext,
    @Body() body: unknown,
  ): Promise<ValidateImportResponse> {
    const parsed = this.parse(ValidateImportBodySchema, body);
    return this.svc.validateImport(tenant, parsed);
  }

  // ──────────────────────────── POST / (save IA) ────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Save IA document (transaction)',
    description:
      'lock erp_doc_format (FOR UPDATE) → gen doc_no in-tx → check duplicate → ' +
      'INSERT ic_trans + ic_trans_detail (qty=0, price=0, value-only adjust)',
  })
  async saveStockAdjust(
    @Tenant() tenant: TenantContext,
    @Body() body: unknown,
  ): Promise<SaveStockAdjustResponse> {
    const parsed = this.parse(SaveStockAdjustBodySchema, body);
    return this.svc.saveStockAdjust(tenant, parsed);
  }

  // ──────────────────────────── Zod parse helper ────────────────────────────

  private parse<T>(schema: ZodSchema<T>, input: unknown): T {
    try {
      return schema.parse(input);
    } catch (err) {
      if (err instanceof ZodError) {
        const first = err.issues[0];
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_ERROR,
          message: first?.message || 'invalid input',
          path: first?.path?.join('.') ?? '',
        });
      }
      throw err;
    }
  }
}
