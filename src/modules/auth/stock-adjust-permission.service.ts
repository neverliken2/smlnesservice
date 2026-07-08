import { Injectable, Logger } from '@nestjs/common';
import { PoolManagerService } from '../../core/db/pool-manager.service';
import type { TenantRef } from '../../core/db/db.types';

/**
 * Menu code ที่ NextStep Stock Adjust ใช้เป็น single gate ตอน login
 * ตรงกับเมนู "ปรับปรุงสต๊อก (IA)" ในฟอร์ม "กำหนดผู้มีสิทธิเข้าใช้ข้อมูล" ของ SMLERP22
 */
const GATE_MENU_CODE = 'menu_ic_stk_adjust';

export interface StockAdjustPermissionResult {
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
 * Permission check ตอน login สำหรับ NextStep Stock Adjust
 *
 * Pattern mirror จาก SMLERP22 `_isAccessMenuPermision` (เหมือน CnPermissionService):
 * - superadmin → ผ่านเสมอ
 * - ไม่มี blob ทั้ง user และ group → fail-open
 * - มี blob — OR flags ระหว่าง user + ทุก group ที่ user เป็นสมาชิก
 * - ถ้าไม่เจอ GATE_MENU_CODE ใน blob เลย → reject (strict)
 *
 * เกณฑ์ผ่าน: isRead AND isAdd
 */
@Injectable()
export class StockAdjustPermissionService {
  private readonly logger = new Logger(StockAdjustPermissionService.name);

  constructor(private readonly pool: PoolManagerService) {}

  private authTenant(provider: string): TenantRef {
    return { provider, database: this.pool.authDbName(provider) };
  }

  async checkStockAdjustAccess(
    provider: string,
    usercode: string,
  ): Promise<StockAdjustPermissionResult> {
    if (usercode.toLowerCase() === 'superadmin') {
      return {
        allowed: true,
        isRead: true,
        isAdd: true,
        reason: 'superadmin',
      };
    }

    const tenant = this.authTenant(provider);

    const userBlob = await this.loadUserBlob(tenant, usercode);
    const groupBlobs = await this.loadGroupBlobs(tenant, usercode);

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
    tenant: TenantRef,
    usercode: string,
  ): Promise<Buffer | null> {
    const result = await this.pool.query<{ image_file: Buffer | null }>(
      tenant,
      `SELECT image_file FROM sml_permissions_user
        WHERE UPPER(usercode) = UPPER($1)
        LIMIT 1`,
      [usercode],
      { timeout: 10_000 },
    );
    return result.rows[0]?.image_file ?? null;
  }

  private async loadGroupBlobs(
    tenant: TenantRef,
    usercode: string,
  ): Promise<Buffer[]> {
    const result = await this.pool.query<{ image_file: Buffer | null }>(
      tenant,
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
   * Format: <_MenusubList _submeid="menu_ic_stk_adjust" _isRead="true" _isAdd="true" ... />
   */
  private parseMenuFlags(
    blob: Buffer,
    menuCode: string,
  ): PermissionFlags | null {
    try {
      const xml = blob.toString('latin1');
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
