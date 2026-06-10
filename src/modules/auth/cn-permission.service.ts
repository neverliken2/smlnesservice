import { Injectable, Logger } from '@nestjs/common';
import { PoolManagerService } from '../../core/db/pool-manager.service';

/**
 * Menu code ที่ NextStep CN Coupon ใช้เป็น single gate ตอน login
 * ตรงกับเมนู "4.19.รับคืนสินค้า/ลดหนี้" ในฟอร์ม "กำหนดผู้มีสิทธิเข้าใช้ข้อมูล" ของ SMLERP22
 */
const GATE_MENU_CODE = 'menu_so_credit_note';

export interface CnPermissionResult {
  allowed: boolean;
  isRead: boolean;
  isAdd: boolean;
  reason: 'superadmin' | 'no-blob' | 'blob-checked' | 'menu-not-found';
}

interface PermissionFlags {
  isRead: boolean;
  isAdd: boolean;
  isEdit: boolean;
  isDelete: boolean;
}

/**
 * Permission check ตอน login สำหรับ NextStep CN Coupon
 *
 * Pattern mirror จาก SMLERP22 `_isAccessMenuPermision` (MyLib/_global.cs:2203):
 * - superadmin → ผ่านเสมอ
 * - ไม่มี blob ทั้ง user และ group → fail-open (ผ่าน — user เก่าที่ยังไม่ได้ตั้งสิทธิ์)
 * - มี blob — OR flags ระหว่าง user + ทุก group ที่ user เป็นสมาชิก
 * - ถ้าไม่เจอ GATE_MENU_CODE ใน blob เลย → reject (strict)
 *
 * เกณฑ์ผ่าน: isRead AND isAdd (ตามที่เจ้านายสั่ง)
 */
@Injectable()
export class CnPermissionService {
  private readonly logger = new Logger(CnPermissionService.name);

  constructor(private readonly pool: PoolManagerService) {}

  private authDbName(provider: string): string {
    const prefix = process.env.DB_NAME_PREFIX ?? 'smlerpmain';
    return `${prefix}${provider.toLowerCase()}`;
  }

  async checkCreditNoteAccess(
    provider: string,
    usercode: string,
  ): Promise<CnPermissionResult> {
    if (usercode.toLowerCase() === 'superadmin') {
      return {
        allowed: true,
        isRead: true,
        isAdd: true,
        reason: 'superadmin',
      };
    }

    const dbName = this.authDbName(provider);

    const userBlob = await this.loadUserBlob(dbName, usercode);
    const groupBlobs = await this.loadGroupBlobs(dbName, usercode);

    const allBlobs = [userBlob, ...groupBlobs].filter(
      (b): b is Buffer => b !== null && b.length > 0,
    );

    if (allBlobs.length === 0) {
      return {
        allowed: true,
        isRead: true,
        isAdd: true,
        reason: 'no-blob',
      };
    }

    let foundMenu = false;
    const merged: PermissionFlags = {
      isRead: false,
      isAdd: false,
      isEdit: false,
      isDelete: false,
    };

    for (const blob of allBlobs) {
      const flags = this.parseMenuFlags(blob, GATE_MENU_CODE);
      if (flags) {
        foundMenu = true;
        merged.isRead ||= flags.isRead;
        merged.isAdd ||= flags.isAdd;
        merged.isEdit ||= flags.isEdit;
        merged.isDelete ||= flags.isDelete;
      }
    }

    if (!foundMenu) {
      return {
        allowed: false,
        isRead: false,
        isAdd: false,
        reason: 'menu-not-found',
      };
    }

    return {
      allowed: merged.isRead && merged.isAdd,
      isRead: merged.isRead,
      isAdd: merged.isAdd,
      reason: 'blob-checked',
    };
  }

  private async loadUserBlob(
    dbName: string,
    usercode: string,
  ): Promise<Buffer | null> {
    const result = await this.pool.query<{ image_file: Buffer | null }>(
      dbName,
      `SELECT image_file FROM sml_permissions_user
        WHERE UPPER(usercode) = UPPER($1)
        LIMIT 1`,
      [usercode],
      { timeout: 10_000 },
    );
    return result.rows[0]?.image_file ?? null;
  }

  private async loadGroupBlobs(
    dbName: string,
    usercode: string,
  ): Promise<Buffer[]> {
    const result = await this.pool.query<{ image_file: Buffer | null }>(
      dbName,
      `SELECT image_file FROM sml_permissions_group
        WHERE UPPER(usercode) IN (
          SELECT UPPER(group_code)
            FROM sml_user_and_group
           WHERE UPPER(user_code) = UPPER($1)
        )`,
      [usercode],
      { timeout: 10_000 },
    );
    return result.rows
      .map((r) => r.image_file)
      .filter((b): b is Buffer => b !== null && b.length > 0);
  }

  /**
   * Parse XML blob ของ _mainMenuClass แล้วหา flags ของ menuCode
   *
   * Format (จาก C# XmlSerializer):
   *   <_MenusubList _submeid="menu_so_credit_note"
   *                 _submenuname1="..."
   *                 _isRead="true" _isAdd="true" _isEdit="true" _isDelete="true" />
   *
   * Algorithm: หา marker `_submeid="<menuCode>"` ตรง ๆ → scan จากนั้นไปจนเจอ `/>`
   * (XmlSerializer escape `>` ใน value เป็น `&gt;` แล้ว — `/>` ในช่วงนี้คือ end-of-tag แน่นอน)
   */
  private parseMenuFlags(
    blob: Buffer,
    menuCode: string,
  ): PermissionFlags | null {
    try {
      const xml = blob.toString('latin1'); // หลีกเลี่ยง UTF-8 throw ถ้ามี byte แปลก ๆ ใน Thai escape
      const marker = `_submeid="${menuCode}"`;
      const idx = xml.toLowerCase().indexOf(marker.toLowerCase());
      if (idx === -1) return null;

      const endIdx = xml.indexOf('/>', idx);
      if (endIdx === -1) return null;

      const slice = xml.substring(idx, endIdx);
      return {
        isRead: /_isRead="true"/i.test(slice),
        isAdd: /_isAdd="true"/i.test(slice),
        isEdit: /_isEdit="true"/i.test(slice),
        isDelete: /_isDelete="true"/i.test(slice),
      };
    } catch (err) {
      this.logger.warn(
        `Failed to parse permission blob for menu ${menuCode}: ${(err as Error).message}`,
      );
      return null;
    }
  }
}
