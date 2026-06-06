import { Injectable } from '@nestjs/common';
import { PoolManagerService } from '../../core/db/pool-manager.service';

export interface UserRow {
  user_code: string;
  user_name: string;
  user_password: string;
  user_level: number | null;
}

export interface DatabaseRow {
  data_code: string;
  data_database_name: string;
  data_name: string;
}

/**
 * AuthRepository — raw SQL access ไป auth DB (smlerpmain<provider>)
 *
 * Schema rules (จาก work/CLAUDE.md):
 * - sml_user_list.user_password เป็น varchar(25) plaintext — เทียบตรง ๆ ตาม legacy SML
 * - sml_database_list มี data_group; default 'SML' ตาม NextStep CN Coupon
 */
@Injectable()
export class AuthRepository {
  constructor(private readonly pool: PoolManagerService) {}

  private authDbName(provider: string): string {
    const prefix = process.env.DB_NAME_PREFIX ?? 'smlerpmain';
    return `${prefix}${provider.toLowerCase()}`;
  }

  async findUserByCode(
    provider: string,
    userCode: string,
  ): Promise<UserRow | null> {
    // ไม่กรอง active_status — ตาม pattern ของ smlerp22_new (_myFrameWork._checkUserAndPassword)
    // และ NextStep CN Coupon ตัวเก่า; superadmin ใน demo มี active_status=0 ก็ต้อง login ได้
    const result = await this.pool.query<UserRow>(
      this.authDbName(provider),
      `SELECT user_code, user_name, user_password, user_level
         FROM sml_user_list
        WHERE UPPER(user_code) = UPPER($1)`,
      [userCode],
      { timeout: 10_000 },
    );
    return result.rows[0] ?? null;
  }

  async listDatabasesForUser(
    provider: string,
    userCode: string,
    dataGroup: string,
  ): Promise<DatabaseRow[]> {
    // หมายเหตุ: ไม่ filter user_or_group_status — ตาม pattern NextStep CN Coupon
    // (ฟิลด์นี้ใน SML ใช้บอก sync state, ไม่ใช่ active flag — 0 = ปกติ)
    const result = await this.pool.query<DatabaseRow>(
      this.authDbName(provider),
      `SELECT data_code, data_database_name, data_name
         FROM sml_database_list
        WHERE UPPER(data_group) = UPPER($1)
          AND UPPER(data_code) IN (
            SELECT UPPER(data_code)
              FROM sml_database_list_user_and_group
             WHERE UPPER(user_or_group_code) = UPPER($2)
          )
        ORDER BY data_code`,
      [dataGroup, userCode],
      { timeout: 10_000 },
    );
    return result.rows;
  }

  async findDatabaseByCode(
    provider: string,
    userCode: string,
    dataCode: string,
  ): Promise<DatabaseRow | null> {
    const result = await this.pool.query<DatabaseRow>(
      this.authDbName(provider),
      `SELECT data_code, data_database_name, data_name
         FROM sml_database_list
        WHERE UPPER(data_code) = UPPER($1)
          AND UPPER(data_code) IN (
            SELECT UPPER(data_code)
              FROM sml_database_list_user_and_group
             WHERE UPPER(user_or_group_code) = UPPER($2)
          )
        LIMIT 1`,
      [dataCode, userCode],
      { timeout: 10_000 },
    );
    return result.rows[0] ?? null;
  }
}
