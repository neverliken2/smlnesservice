/**
 * ErpOption module — @Global() เพื่อให้ feature module อื่นๆ inject ErpOptionService
 * ได้โดยไม่ต้อง import ซ้ำ
 *
 * Endpoint: GET /api/v1/erp-option
 */

import { Global, Module } from '@nestjs/common';
import { ErpOptionController } from './erp-option.controller';
import { ErpOptionRepository } from './erp-option.repository';
import { ErpOptionService } from './erp-option.service';

@Global()
@Module({
  controllers: [ErpOptionController],
  providers: [ErpOptionService, ErpOptionRepository],
  exports: [ErpOptionService],
})
export class ErpOptionModule {}
