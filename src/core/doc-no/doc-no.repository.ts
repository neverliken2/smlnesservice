import { Injectable } from '@nestjs/common';
import { PoolManagerService } from '../db/pool-manager.service';
import type { TenantRef } from '../db/db.types';
import { DocFormatRow, LastDocNoRow } from './doc-no.types';

@Injectable()
export class DocNoRepository {
  constructor(private readonly pool: PoolManagerService) {}

  async findDocFormat(
    tenant: TenantRef,
    code: string,
  ): Promise<DocFormatRow | null> {
    const result = await this.pool.query<DocFormatRow>(
      tenant,
      `SELECT format FROM erp_doc_format WHERE code = $1 LIMIT 1`,
      [code],
      { timeout: 5_000 },
    );
    return result.rows[0] ?? null;
  }

  async findLastDocNo(
    tenant: TenantRef,
    transFlag: number,
    formatCode: string,
    pgPattern: string,
  ): Promise<LastDocNoRow | null> {
    const result = await this.pool.query<LastDocNoRow>(
      tenant,
      `SELECT doc_no
         FROM ic_trans
        WHERE trans_flag = $1
          AND doc_format_code = $2
          AND doc_no ~ $3
        ORDER BY doc_no DESC
        LIMIT 1`,
      [transFlag, formatCode, pgPattern],
      { timeout: 10_000 },
    );
    return result.rows[0] ?? null;
  }
}
