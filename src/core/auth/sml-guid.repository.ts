import { Injectable } from '@nestjs/common';
import { PoolManagerService } from '../db/pool-manager.service';

/**
 * Row shape ของ sml_guid (auth DB)
 *
 * Schema มาจาก SML ERP smlmaindatabase.xml — เรา reuse ไม่ได้สร้างใหม่
 */
export interface SmlGuidRow {
  guid_code: string;
  login_time: Date;
  last_access_time: Date;
  user_code: string;
  computer_name: string;
  database_code: string;
}

@Injectable()
export class SmlGuidRepository {
  constructor(private readonly pool: PoolManagerService) {}

  private authDbName(provider: string): string {
    const prefix = process.env.DB_NAME_PREFIX ?? 'smlerpmain';
    return `${prefix}${provider.toLowerCase()}`;
  }

  async insert(
    provider: string,
    row: {
      guidCode: string;
      userCode: string;
      databaseCode: string;
      computerName: string;
    },
  ): Promise<void> {
    await this.pool.query(
      this.authDbName(provider),
      `INSERT INTO sml_guid
         (guid_code, login_time, last_access_time, user_code,
          computer_name, database_code,
          ignore_sync, is_lock_record, roworder, create_date_time_now)
       VALUES ($1, now(), now(), $2, $3, $4, 0, 0, 0, now())`,
      [row.guidCode, row.userCode, row.computerName, row.databaseCode],
      { timeout: 10_000 },
    );
  }

  async findByCode(
    provider: string,
    guidCode: string,
  ): Promise<SmlGuidRow | null> {
    const result = await this.pool.query<SmlGuidRow>(
      this.authDbName(provider),
      `SELECT guid_code, login_time, last_access_time, user_code,
              computer_name, database_code
         FROM sml_guid
        WHERE guid_code = $1
        LIMIT 1`,
      [guidCode],
      { timeout: 5_000 },
    );
    return result.rows[0] ?? null;
  }

  async touchLastAccess(provider: string, guidCode: string): Promise<void> {
    await this.pool.query(
      this.authDbName(provider),
      `UPDATE sml_guid SET last_access_time = now() WHERE guid_code = $1`,
      [guidCode],
      { timeout: 5_000 },
    );
  }

  async delete(provider: string, guidCode: string): Promise<number> {
    const result = await this.pool.query(
      this.authDbName(provider),
      `DELETE FROM sml_guid WHERE guid_code = $1`,
      [guidCode],
      { timeout: 5_000 },
    );
    return result.rowCount;
  }
}
