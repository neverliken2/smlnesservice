import { Injectable } from '@nestjs/common';
import { PoolManagerService } from '../db/pool-manager.service';
import { ErpOptionRow } from './erp-option.types';

@Injectable()
export class ErpOptionRepository {
  constructor(private readonly pool: PoolManagerService) {}

  async findErpOption(database: string): Promise<ErpOptionRow | null> {
    const result = await this.pool.query<ErpOptionRow>(
      database,
      `SELECT vat_rate, item_amount_decimal, item_qty_decimal, item_price_decimal
         FROM erp_option
        LIMIT 1`,
      [],
      { timeout: 5_000 },
    );
    return result.rows[0] ?? null;
  }
}
