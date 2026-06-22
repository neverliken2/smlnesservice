import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ZodError, ZodSchema } from 'zod';
import { Tenant } from '../../core/tenant/tenant.decorator';
import type { TenantContext } from '../../core/tenant/tenant.types';
import { ErrorCode } from '../../core/error/error-codes';
import { DashboardService, type PingResponse } from './dashboard.service';
import {
  SalesOverviewQuerySchema,
  type SalesOverviewResponse,
} from './dto/sales-overview.dto';
import {
  StockBalanceQuerySchema,
  type StockBalanceResponse,
} from './dto/stock-balance.dto';
import {
  ProductTransactionsParamSchema,
  type ProductTransactionsResponse,
} from './dto/product-transactions.dto';
import {
  StockMovementQuerySchema,
  type StockMovementResponse,
} from './dto/stock-movement.dto';
import {
  ReorderPointQuerySchema,
  type ReorderPointResponse,
} from './dto/reorder-point.dto';
import {
  ProfitProductQuerySchema,
  type ProfitProductResponse,
} from './dto/profit-product.dto';
import {
  DailySalesChartQuerySchema,
  type DailySalesChartResponse,
} from './dto/daily-sales-chart.dto';
import {
  BankStatementQuerySchema,
  type BankStatementResponse,
  type BankBooksResponse,
} from './dto/bank-statement.dto';
import {
  ArMovementQuerySchema,
  type ArMovementResponse,
} from './dto/ar-movement.dto';
import {
  ReceivableOverdueQuerySchema,
  type ReceivableOverdueResponse,
} from './dto/receivable-overdue.dto';
import {
  ArAgingQuerySchema,
  type ArAgingResponse,
} from './dto/ar-aging.dto';
import {
  ApMovementQuerySchema,
  type ApMovementResponse,
} from './dto/ap-movement.dto';
import {
  PayableOverdueQuerySchema,
  type PayableOverdueResponse,
} from './dto/payable-overdue.dto';
import {
  ApAgingQuerySchema,
  type ApAgingResponse,
} from './dto/ap-aging.dto';

/**
 * Dashboard Controller — REST endpoints สำหรับ NextStep Dashboard
 *
 * Prefix: /api/v1/dashboard
 * Auth: ทุก endpoint ผ่าน global JwtAuthGuard (session JWT)
 *
 * Endpoints:
 *   GET /ping                              — verify module loaded
 *   GET /sales-overview                    — รวมยอดขาย/รับคืน
 *   GET /stock-balance                     — ยอดคงเหลือสินค้า + qty in/out
 *   GET /product-transactions/:productCode — ซื้อล่าสุด + ขายล่าสุด (10 each)
 *   GET /stock-movement                    — รายการเคลื่อนไหวสต๊อก + running balance
 */
@ApiTags('dashboard')
@ApiBearerAuth('sessionJwt')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}

  // ──────────────────────────── /ping ────────────────────────────

  @Get('ping')
  @ApiOperation({
    summary: 'Ping (verify dashboard module loaded)',
  })
  ping(@Tenant() tenant: TenantContext): PingResponse {
    return this.svc.ping(tenant);
  }

  // ──────────────────────────── /sales-overview ────────────────────────────

  @Get('sales-overview')
  @ApiOperation({
    summary: 'Sales overview (รวมขาย/รับคืน ตามช่วงวันที่)',
    description:
      'Aggregate ic_trans_detail trans_flag=44/46/48. Default = ตั้งแต่ต้นปีจนถึงวันนี้. ' +
      'Optional filter branch/warehouse. Timeout = 60s.',
  })
  @ApiQuery({ name: 'startDate', required: false, example: '2026-01-01' })
  @ApiQuery({ name: 'endDate', required: false, example: '2026-06-18' })
  @ApiQuery({ name: 'branch', required: false })
  @ApiQuery({ name: 'warehouse', required: false })
  async salesOverview(
    @Tenant() tenant: TenantContext,
    @Query() query: unknown,
  ): Promise<SalesOverviewResponse> {
    const parsed = this.parse(SalesOverviewQuerySchema, query);
    return this.svc.salesOverview(tenant, parsed);
  }

  // ──────────────────────────── /stock-balance ────────────────────────────

  @Get('stock-balance')
  @ApiOperation({
    summary: 'Stock balance — รวมเคลื่อนไหวต่อสินค้า + ราคาซื้อล่าสุด',
    description:
      'Start จาก ic_inventory + correlated subquery 4 ตัว (qty_in/amount_in/qty_out/amount_out). ' +
      'item_type NOT IN (1, 3, 5). LIMIT 2000 rows.',
  })
  @ApiQuery({ name: 'fromDate', required: false, example: '2026-01-01' })
  @ApiQuery({ name: 'toDate', required: false, example: '2026-06-18' })
  @ApiQuery({
    name: 'icCodeList',
    required: false,
    description: 'CSV ของ item codes',
    example: '02-0001,02-0002',
  })
  @ApiQuery({
    name: 'icCodeRanges',
    required: false,
    description: 'CSV ของ ranges "from:to,from:to"',
    example: '02-0001:02-9999',
  })
  @ApiQuery({ name: 'mainGroup', required: false })
  @ApiQuery({ name: 'subGroup', required: false })
  async stockBalance(
    @Tenant() tenant: TenantContext,
    @Query() query: unknown,
  ): Promise<StockBalanceResponse> {
    const parsed = this.parse(StockBalanceQuerySchema, query);
    return this.svc.stockBalance(tenant, parsed);
  }

  // ──────────────────────────── /product-transactions/:productCode ────────────────────────────

  @Get('product-transactions/:productCode')
  @ApiOperation({
    summary: 'Product transactions — ซื้อล่าสุด 10 + ขายล่าสุด 10',
    description:
      'ซื้อ: trans_flag IN (12, 310) join ap_supplier. ขาย: trans_flag=44 join ar_customer.',
  })
  @ApiParam({ name: 'productCode', example: '02-0001' })
  async productTransactions(
    @Tenant() tenant: TenantContext,
    @Param() param: unknown,
  ): Promise<ProductTransactionsResponse> {
    const parsed = this.parse(ProductTransactionsParamSchema, param);
    return this.svc.productTransactions(tenant, parsed.productCode);
  }

  // ──────────────────────────── /stock-movement ────────────────────────────

  @Get('stock-movement')
  @ApiOperation({
    summary: 'Stock movement detail — เคลื่อนไหวรายเอกสาร + running balance',
    description:
      'ic_trans_detail ของ item ตัวเดียว เรียง doc_date/doc_time/doc_no. ' +
      'มี beginning balance ก่อน fromDate ถ้าระบุ. LIMIT 500 rows.',
  })
  @ApiQuery({ name: 'productCode', required: true, example: '02-0001' })
  @ApiQuery({ name: 'fromDate', required: false, example: '2026-01-01' })
  @ApiQuery({ name: 'toDate', required: false, example: '2026-06-18' })
  async stockMovement(
    @Tenant() tenant: TenantContext,
    @Query() query: unknown,
  ): Promise<StockMovementResponse> {
    const parsed = this.parse(StockMovementQuerySchema, query);
    return this.svc.stockMovement(tenant, parsed);
  }

  // ──────────────────────────── /reorder-point ────────────────────────────

  @Get('reorder-point')
  @ApiOperation({
    summary: 'Reorder point — สินค้าที่ balance_qty < purchase_point',
    description:
      'ใช้ stored function sml_ic_function_stock_balance + subquery หา purchase/min/max + last purchase + sale ratio.',
  })
  @ApiQuery({ name: 'fromDate', required: false })
  @ApiQuery({ name: 'toDate', required: false })
  @ApiQuery({ name: 'icCodeList', required: false })
  @ApiQuery({ name: 'icCodeRanges', required: false })
  async reorderPoint(
    @Tenant() tenant: TenantContext,
    @Query() query: unknown,
  ): Promise<ReorderPointResponse> {
    const parsed = this.parse(ReorderPointQuerySchema, query);
    return this.svc.reorderPoint(tenant, parsed);
  }

  // ──────────────────────────── /profit-product ────────────────────────────

  @Get('profit-product')
  @ApiOperation({
    summary: 'Profit per product — sale/cost/profit% ต่อสินค้า + paginate',
    description:
      'Aggregate ic_trans_detail (trans_flag 44/46/48) ต่อสินค้า. ' +
      'Default page=1 pageSize=20. Filter ทั้ง code, brand, class, size, color, grade, model, category, group_main/sub/sub2.',
  })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  async profitProduct(
    @Tenant() tenant: TenantContext,
    @Query() query: unknown,
  ): Promise<ProfitProductResponse> {
    const parsed = this.parse(ProfitProductQuerySchema, query);
    return this.svc.profitProduct(tenant, parsed);
  }

  // ──────────────────────────── /daily-sales-chart ────────────────────────────

  @Get('daily-sales-chart')
  @ApiOperation({
    summary: 'Daily/monthly sales chart',
    description:
      'รวมยอดขาย net (trans_flag 44/46 - 48) แยกตามวัน หรือ groupBy=monthly แยกตามเดือน.',
  })
  @ApiQuery({ name: 'startDate', required: true, example: '2026-01-01' })
  @ApiQuery({ name: 'endDate', required: true, example: '2026-06-18' })
  @ApiQuery({
    name: 'groupBy',
    required: false,
    enum: ['daily', 'monthly'],
    example: 'daily',
  })
  async dailySalesChart(
    @Tenant() tenant: TenantContext,
    @Query() query: unknown,
  ): Promise<DailySalesChartResponse> {
    const parsed = this.parse(DailySalesChartQuerySchema, query);
    return this.svc.dailySalesChart(tenant, parsed);
  }

  // ──────────────────────────── /bank-statement ────────────────────────────

  @Get('bank-statement')
  @ApiOperation({
    summary: 'Bank statement — opening balance + transactions + summary',
    description:
      'รวม cb_trans_detail + ic_trans_detail (461/463/422/420 ฯลฯ) + ic_trans (604). ' +
      'Filter ด้วย bookNo (เฉพาะ book) หรือ bankCode (ทุก book ของ bank). ' +
      'transactionType: all/deposit/withdraw.',
  })
  @ApiQuery({ name: 'fromDate', required: false })
  @ApiQuery({ name: 'toDate', required: false })
  @ApiQuery({ name: 'bankCode', required: false })
  @ApiQuery({ name: 'bookNo', required: false })
  @ApiQuery({
    name: 'transactionType',
    required: false,
    enum: ['all', 'deposit', 'withdraw'],
  })
  async bankStatement(
    @Tenant() tenant: TenantContext,
    @Query() query: unknown,
  ): Promise<BankStatementResponse> {
    const parsed = this.parse(BankStatementQuerySchema, query);
    return this.svc.bankStatement(tenant, parsed);
  }

  // ──────────────────────────── /bank-books ────────────────────────────

  @Get('bank-books')
  @ApiOperation({
    summary: 'Bank books / banks / branches reference data',
    description:
      'List pass books จาก erp_pass_book + เติม bank name (erp_bank) และ branches (erp_bank_branch). ' +
      'ใช้ populate dropdown filters ของหน้า Bank Statement.',
  })
  async bankBooks(
    @Tenant() tenant: TenantContext,
  ): Promise<BankBooksResponse> {
    return this.svc.bankBooks(tenant);
  }

  // ──────────────────────────── /ar-movement ────────────────────────────

  @Get('ar-movement')
  @ApiOperation({
    summary: 'AR movement — เคลื่อนไหวลูกหนี้ตามช่วงวันที่',
    description:
      'UNION ALL จาก ic_trans (sale/CR), ap_ar_trans (รับชำระ), as_trans (1802). ' +
      'Optional filter customerCodes (CSV).',
  })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'customerCodes', required: false })
  async arMovement(
    @Tenant() tenant: TenantContext,
    @Query() query: unknown,
  ): Promise<ArMovementResponse> {
    const parsed = this.parse(ArMovementQuerySchema, query);
    return this.svc.arMovement(tenant, parsed);
  }

  // ──────────────────────────── /receivable-overdue ────────────────────────────

  @Get('receivable-overdue')
  @ApiOperation({
    summary: 'Receivable overdue — ใบหนี้เกินกำหนด ณ asOfDate',
    description:
      'ใบหนี้ที่ due_date < asOfDate และ balance > 0. Optional customer filter.',
  })
  @ApiQuery({ name: 'asOfDate', required: false })
  @ApiQuery({ name: 'customerCodes', required: false })
  async receivableOverdue(
    @Tenant() tenant: TenantContext,
    @Query() query: unknown,
  ): Promise<ReceivableOverdueResponse> {
    const parsed = this.parse(ReceivableOverdueQuerySchema, query);
    return this.svc.receivableOverdue(tenant, parsed);
  }

  // ──────────────────────────── /ar-aging ────────────────────────────

  @Get('ar-aging')
  @ApiOperation({
    summary: 'AR aging — จัด bucket อายุหนี้ต่อลูกหนี้',
    description:
      'Bucket 5 ชั้น: current (ยังไม่ถึงกำหนด), 1-30, 31-60, 61-90, > 90 วัน. Group by customer.',
  })
  @ApiQuery({ name: 'asOfDate', required: false })
  @ApiQuery({ name: 'customerCodes', required: false })
  async arAging(
    @Tenant() tenant: TenantContext,
    @Query() query: unknown,
  ): Promise<ArAgingResponse> {
    const parsed = this.parse(ArAgingQuerySchema, query);
    return this.svc.arAging(tenant, parsed);
  }

  // ──────────────────────────── /ap-movement ────────────────────────────

  @Get('ap-movement')
  @ApiOperation({
    summary: 'AP movement — เคลื่อนไหวเจ้าหนี้ตามช่วงวันที่',
    description:
      'UNION ALL จาก ic_trans (purchase 12/16/260/81/87/89/91/262) + ap_ar_trans (240). ' +
      'Optional filter supplierCodes (CSV).',
  })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'supplierCodes', required: false })
  async apMovement(
    @Tenant() tenant: TenantContext,
    @Query() query: unknown,
  ): Promise<ApMovementResponse> {
    const parsed = this.parse(ApMovementQuerySchema, query);
    return this.svc.apMovement(tenant, parsed);
  }

  // ──────────────────────────── /payable-overdue ────────────────────────────

  @Get('payable-overdue')
  @ApiOperation({
    summary: 'Payable overdue — ใบเจ้าหนี้เกินกำหนด ณ asOfDate',
    description:
      'ใบเจ้าหนี้ที่ due_date < asOfDate และ balance > 0. Optional supplier filter.',
  })
  @ApiQuery({ name: 'asOfDate', required: false })
  @ApiQuery({ name: 'supplierCodes', required: false })
  async payableOverdue(
    @Tenant() tenant: TenantContext,
    @Query() query: unknown,
  ): Promise<PayableOverdueResponse> {
    const parsed = this.parse(PayableOverdueQuerySchema, query);
    return this.svc.payableOverdue(tenant, parsed);
  }

  // ──────────────────────────── /ap-aging ────────────────────────────

  @Get('ap-aging')
  @ApiOperation({
    summary: 'AP aging — จัด bucket อายุหนี้ต่อเจ้าหนี้',
    description:
      'Bucket 5 ชั้น: current, 1-30, 31-60, 61-90, > 90 วัน. Group by supplier.',
  })
  @ApiQuery({ name: 'asOfDate', required: false })
  @ApiQuery({ name: 'supplierCodes', required: false })
  async apAging(
    @Tenant() tenant: TenantContext,
    @Query() query: unknown,
  ): Promise<ApAgingResponse> {
    const parsed = this.parse(ApAgingQuerySchema, query);
    return this.svc.apAging(tenant, parsed);
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
