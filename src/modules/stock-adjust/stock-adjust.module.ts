import { Module } from '@nestjs/common';
import { StockAdjustController } from './stock-adjust.controller';
import { StockAdjustRepository } from './stock-adjust.repository';
import { StockAdjustService } from './stock-adjust.service';

/**
 * Stock-Adjust Module — IA (Inventory Adjust) endpoints
 *
 * Depend ผ่าน @Global() ของ core:
 *   - DbModule        → PoolManagerService
 *   - DocNoModule     → DocNoService (gen doc_no, รับ transFlag=66 + formatCode='IA')
 *   - ErpOptionModule → ErpOptionService (vat_rate / decimal)
 *   - AuthModule      → JwtStrategy + global JwtAuthGuard
 *
 * Skeleton (Part 3): scaffold พร้อมเติม endpoint ใน Part 4-5
 *
 * Endpoints จะเพิ่มดังนี้ (prefix /api/v1/stock-adjust):
 *   Part 4 — Read:
 *     GET  /items                      — search + paginate
 *     GET  /items/:itemCode            — item defaults + stock + cost (per warehouse)
 *     GET  /warehouses                 — search warehouses
 *     GET  /shelves                    — search shelves (filter by wh)
 *     GET  /purchase-history/:itemCode — purchase history (trans_flag=12)
 *   Part 5 — Write:
 *     POST /validate-import            — validate Excel import rows
 *     POST /                           — save IA (transaction)
 */
@Module({
  controllers: [StockAdjustController],
  providers: [StockAdjustService, StockAdjustRepository],
})
export class StockAdjustModule {}
