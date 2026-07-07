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
import { Tenant } from '../../core/tenant/tenant.decorator';
import type { TenantContext } from '../../core/tenant/tenant.types';
import { ErrorCode } from '../../core/error/error-codes';
import { CreditNoteService } from './credit-note.service';
import { DocNoService } from './doc-no.service';
import {
  CustomerSearchQuerySchema,
  type CustomerOption,
} from './dto/customer.dto';
import {
  ListSalesInvoicesQuerySchema,
  FullyUsedStatusBodySchema,
  type SalesInvoiceOption,
  type FullyUsedStatusResponse,
} from './dto/sales-invoice.dto';
import type { InvoiceDetailResponse } from './dto/invoice-detail.dto';
import { NextDocNoQuerySchema, type NextDocNoResponse } from './dto/doc-no.dto';
import {
  ListWebCouponsQuerySchema,
  type CouponListItem,
} from './dto/coupon.dto';
import {
  PriceDiffQuerySchema,
  type PriceDiffReportResponse,
} from './dto/price-diff.dto';
import {
  CreditNotePayloadSchema,
  type SaveCreditNoteResult,
} from './dto/save-credit-note.dto';

@ApiTags('credit-note')
@ApiBearerAuth('sessionJwt')
@Controller()
export class CreditNoteController {
  constructor(
    private readonly creditNote: CreditNoteService,
    private readonly docNo: DocNoService,
  ) {}

  // ──────────────────────────── doc-no ────────────────────────────

  @Get('doc-no/next')
  @ApiOperation({
    summary: 'Generate next CN doc_no',
    description:
      'Parse erp_doc_format.format → expand @YYYY/MM/DD + # running ใหม่',
  })
  @ApiQuery({ name: 'formatCode', required: false, example: 'CN' })
  @ApiQuery({ name: 'docDate', required: true, example: '2026-06-02' })
  async getNextDocNo(
    @Tenant() tenant: TenantContext,
    @Query() query: unknown,
  ): Promise<NextDocNoResponse> {
    const parsed = this.parse(NextDocNoQuerySchema, query);
    return this.docNo.getNextDocNo(
      tenant.database,
      parsed.formatCode,
      parsed.docDate,
    );
  }

  // ──────────────────────────── customers ────────────────────────────

  @Get('customers')
  @ApiOperation({
    summary: 'Search customers (autocomplete)',
    description: 'ILIKE บน code + name_1; status=0 เท่านั้น (active); LIMIT 50',
  })
  @ApiQuery({ name: 'query', required: false, example: 'ABC' })
  async searchCustomers(
    @Tenant() tenant: TenantContext,
    @Query() query: unknown,
  ): Promise<CustomerOption[]> {
    const parsed = this.parse(CustomerSearchQuerySchema, query);
    return this.creditNote.searchCustomers(tenant.database, parsed.query ?? '');
  }

  // ──────────────────────────── sales invoices ────────────────────────────

  @Get('sales-invoices')
  @ApiOperation({
    summary: 'List sales invoices (trans_flag=44) — paginated',
    description:
      'Default limit=30. is_fully_used = false ทุก row — เรียก POST /sales-invoices/fully-used-status เพื่อ batch fetch สถานะ',
  })
  @ApiQuery({ name: 'custCode', required: false })
  @ApiQuery({
    name: 'query',
    required: false,
    description: 'ค้นหาจาก doc_no / cust_code / ชื่อลูกค้า (ILIKE)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'default 30, max 100',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    description: 'pagination offset',
  })
  async listSalesInvoices(
    @Tenant() tenant: TenantContext,
    @Query() query: unknown,
  ): Promise<SalesInvoiceOption[]> {
    const parsed = this.parse(ListSalesInvoicesQuerySchema, query);
    return this.creditNote.listSalesInvoices(
      tenant.database,
      parsed.custCode,
      parsed.query,
      parsed.limit,
      parsed.offset,
    );
  }

  @Post('sales-invoices/fully-used-status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Batch check is_fully_used สำหรับ doc_no list',
    description:
      'รับ docNos list → return { [docNo]: is_fully_used } — ใช้ lazy load หลัง list invoice ขึ้นมาแล้ว',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['docNos'],
      properties: {
        docNos: { type: 'array', items: { type: 'string' }, maxItems: 200 },
      },
    },
  })
  async getFullyUsedStatus(
    @Tenant() tenant: TenantContext,
    @Body() body: unknown,
  ): Promise<FullyUsedStatusResponse> {
    const parsed = this.parse(FullyUsedStatusBodySchema, body);
    return this.creditNote.getFullyUsedStatus(tenant.database, parsed.docNos);
  }

  @Get('sales-invoices/:docNo')
  @ApiOperation({
    summary: 'Get invoice detail (header + lines พร้อม available_qty)',
    description:
      'available_qty = qty ที่ยังส่งคืนได้ (หัก CN เก่าแล้ว ตาม SMLERP22 _qtyRemainQuery)',
  })
  @ApiParam({ name: 'docNo', example: 'SO260601001' })
  async getInvoiceDetail(
    @Tenant() tenant: TenantContext,
    @Param('docNo') docNo: string,
  ): Promise<InvoiceDetailResponse> {
    return this.creditNote.getInvoiceDetail(tenant.database, docNo);
  }

  // ──────────────────────────── web coupons ────────────────────────────

  @Get('web-coupons')
  @ApiOperation({
    summary: 'List coupons ที่ออกจาก web (creator_code = nextstep_cn_coupon)',
    description:
      'Filter: query (ILIKE doc_no/cust_code/cust_name/ref), fromDate, toDate, limit ≤ 500',
  })
  @ApiQuery({ name: 'query', required: false })
  @ApiQuery({ name: 'fromDate', required: false, example: '2026-01-01' })
  @ApiQuery({ name: 'toDate', required: false, example: '2026-12-31' })
  @ApiQuery({ name: 'limit', required: false, example: 200 })
  async listWebCoupons(
    @Tenant() tenant: TenantContext,
    @Query() query: unknown,
  ): Promise<CouponListItem[]> {
    const parsed = this.parse(ListWebCouponsQuerySchema, query);
    return this.creditNote.listWebCoupons(tenant.database, parsed);
  }

  // ──────────────────────────── reports ────────────────────────────

  @Get('reports/cn-price-diff')
  @ApiOperation({
    summary: 'CN price diff vs source invoice',
    description: 'รายการ CN ที่ price ต่างจาก invoice ต้นทาง (LIMIT 500)',
  })
  @ApiQuery({ name: 'fromDate', required: true, example: '2026-01-01' })
  @ApiQuery({ name: 'toDate', required: true, example: '2026-12-31' })
  async getCnPriceDiffReport(
    @Tenant() tenant: TenantContext,
    @Query() query: unknown,
  ): Promise<PriceDiffReportResponse> {
    const parsed = this.parse(PriceDiffQuerySchema, query);
    return this.creditNote.getCnPriceDiffReport(
      tenant.database,
      parsed.fromDate,
      parsed.toDate,
    );
  }

  // ──────────────────────────── save (POST) ────────────────────────────

  @Post('credit-notes')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Save Credit Note',
    description:
      'สร้าง CN ใหม่ (trans_flag=48): pro-rata จาก source invoice + ออก coupon ถ้า ' +
      'inquiry_type เป็น cash (1/3/5). ' +
      'INSERT 4 tables ใน 1 transaction (ic_trans, ic_trans_detail, cb_trans, ap_ar_trans_detail) ' +
      '+ coupon_list ถ้าออกคูปอง',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: [
        'doc_no',
        'doc_date',
        'cust_code',
        'ref_doc_no',
        'inquiry_type',
        'lines',
      ],
      properties: {
        doc_no: { type: 'string', example: 'CN-2606-0001' },
        doc_date: { type: 'string', example: '2026-06-02' },
        cust_code: { type: 'string', example: 'AR00001' },
        ref_doc_no: { type: 'string', example: 'SI260101001' },
        ref_doc_date: { type: 'string', example: '2026-01-15' },
        inquiry_type: { type: 'number', example: 1 },
        remark: { type: 'string' },
        coupon_expire_date: { type: 'string', example: '2026-07-02' },
        coupon_single_use: { type: 'boolean', example: true },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            required: ['line_number', 'item_code', 'price', 'qty_cn'],
            properties: {
              line_number: { type: 'number', example: 0 },
              item_code: { type: 'string' },
              qty: { type: 'number' },
              price: { type: 'number' },
              qty_cn: { type: 'number', example: 1 },
            },
          },
        },
      },
    },
  })
  async saveCreditNote(
    @Tenant() tenant: TenantContext,
    @Body() body: unknown,
  ): Promise<SaveCreditNoteResult> {
    const parsed = this.parse(CreditNotePayloadSchema, body);
    return this.creditNote.saveCreditNote(tenant.database, parsed);
  }

  // ──────────────────────────── helper ────────────────────────────

  private parse<T>(
    schema: {
      safeParse: (v: unknown) => {
        success: boolean;
        data?: T;
        error?: unknown;
      };
    },
    value: unknown,
  ): T {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        details: result.error,
      });
    }
    return result.data as T;
  }
}
