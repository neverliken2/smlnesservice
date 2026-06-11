import { Injectable } from '@nestjs/common';
import { ERP_OPTION_DEFAULTS } from './erp-option.constants';
import { ErpOptionRepository } from './erp-option.repository';
import { ErpOptionResponse } from './erp-option.types';

/**
 * ดึง config row เดียวจาก erp_option (SML ใช้ row เดียวทั่วระบบ)
 *
 * Fallback strategy:
 *   - ไม่มีแถว → ใช้ default ทุก column
 *   - มีแถว แต่ column เป็น NULL/NaN → fallback เฉพาะตัวที่ตกหล่น
 *
 * Response shape คงที่เสมอ — client ไม่ต้องเช็ค undefined
 */
@Injectable()
export class ErpOptionService {
  constructor(private readonly repo: ErpOptionRepository) {}

  async getErpOption(database: string): Promise<ErpOptionResponse> {
    const row = await this.repo.findErpOption(database);
    return {
      vat_rate: this.normalize(row?.vat_rate, ERP_OPTION_DEFAULTS.VAT_RATE),
      item_amount_decimal: this.normalize(
        row?.item_amount_decimal,
        ERP_OPTION_DEFAULTS.ITEM_AMOUNT_DECIMAL,
      ),
      item_qty_decimal: this.normalize(
        row?.item_qty_decimal,
        ERP_OPTION_DEFAULTS.ITEM_QTY_DECIMAL,
      ),
      item_price_decimal: this.normalize(
        row?.item_price_decimal,
        ERP_OPTION_DEFAULTS.ITEM_PRICE_DECIMAL,
      ),
    };
  }

  private normalize(
    value: string | number | null | undefined,
    fallback: number,
  ): number {
    if (value === null || value === undefined) return fallback;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
}
