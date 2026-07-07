import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Tenant } from '../tenant/tenant.decorator';
import type { TenantContext } from '../tenant/tenant.types';
import { ErpOptionService } from './erp-option.service';
import type { ErpOptionResponse } from './erp-option.types';

@ApiTags('erp-option')
@ApiBearerAuth('sessionJwt')
@Controller('erp-option')
export class ErpOptionController {
  constructor(private readonly svc: ErpOptionService) {}

  @Get()
  @ApiOperation({
    summary: 'Get erp_option config (row เดียวของ tenant)',
    description:
      'ดึง vat_rate + item_*_decimal — มี fallback ทุก column (vat_rate=7, amount=2, qty=3, price=5) ถ้าไม่มี row หรือ NULL',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        vat_rate: { type: 'number', example: 7 },
        item_amount_decimal: { type: 'number', example: 2 },
        item_qty_decimal: { type: 'number', example: 3 },
        item_price_decimal: { type: 'number', example: 5 },
      },
    },
  })
  async getErpOption(
    @Tenant() tenant: TenantContext,
  ): Promise<ErpOptionResponse> {
    return this.svc.getErpOption(tenant.database);
  }
}
