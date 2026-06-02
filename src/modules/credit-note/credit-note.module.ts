import { Module } from '@nestjs/common';
import { CreditNoteController } from './credit-note.controller';
import { CreditNoteRepository } from './credit-note.repository';
import { CreditNoteService } from './credit-note.service';
import { DocNoService } from './doc-no.service';

/**
 * Credit Note Module — port จาก NextStep_CN_Coupon
 *
 * Phase 3a (read endpoints):
 *   GET  /api/v1/doc-no/next?formatCode&docDate
 *   GET  /api/v1/customers?query
 *   GET  /api/v1/sales-invoices?custCode
 *   GET  /api/v1/sales-invoices/:docNo
 *   GET  /api/v1/web-coupons?query&fromDate&toDate&limit
 *   GET  /api/v1/reports/cn-price-diff?fromDate&toDate
 *
 * Phase 3b (เพิ่มภายหลัง):
 *   POST /api/v1/credit-notes  — saveCreditNote (transaction หลาย table + coupon)
 */
@Module({
  controllers: [CreditNoteController],
  providers: [CreditNoteService, DocNoService, CreditNoteRepository],
})
export class CreditNoteModule {}
