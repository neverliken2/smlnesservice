/**
 * Connection Registry Service
 *
 * แหล่งความจริงว่า provider ไหนต่อ PG server ไหน — รองรับ 2 โหมดพร้อมกัน:
 *
 * 1. **File mode** — env `CONNECTIONS_FILE` ชี้ไฟล์ connections.json
 *    (mount เข้า container) แต่ละ entry = 1 provider → 1 PG server
 * 2. **Env fallback** — provider ที่ไม่อยู่ในไฟล์ ใช้ `DB_HOST/DB_USER/...`
 *    เหมือนพฤติกรรมเดิมก่อนมี registry (backward compatible กับ
 *    deployment model A ทุกตัว — ไม่ตั้ง CONNECTIONS_FILE ก็วิ่ง env ล้วน)
 *
 * กติกา:
 * - ตั้ง CONNECTIONS_FILE แล้วไฟล์หาย/parse ไม่ผ่าน/provider ซ้ำ → fail fast ตอน start
 * - ห้าม log password เด็ดขาด (log แค่ provider + host)
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'fs';
import { z } from 'zod';

const connectionEntrySchema = z.object({
  /** provider code เช่น "demo", "kungg" — ตัวเดียวกับที่ user กรอกตอน login */
  provider: z.string().regex(/^[a-zA-Z0-9]{1,20}$/),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(5432),
  user: z.string().min(1),
  password: z.string().min(1),
  ssl: z.boolean().default(false),
  sslRejectUnauthorized: z.boolean().default(true),
  poolMax: z.number().int().min(1).max(100).default(20),
  dbNamePrefix: z.string().min(1).default('smlerpmain'),
});

const connectionsFileSchema = z.object({
  connections: z.array(connectionEntrySchema),
});

export interface ConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  ssl: boolean;
  sslRejectUnauthorized: boolean;
  poolMax: number;
  dbNamePrefix: string;
  /** ที่มาของ config — ใช้ log/debug เท่านั้น */
  source: 'file' | 'env';
}

@Injectable()
export class ConnectionRegistryService implements OnModuleInit {
  private readonly logger = new Logger(ConnectionRegistryService.name);
  /** key = provider (lowercase) */
  private fileEntries = new Map<string, ConnectionConfig>();

  onModuleInit() {
    this.loadFile();
    const envMode = process.env.DB_HOST
      ? `env fallback → ${process.env.DB_HOST}`
      : 'no env fallback (DB_HOST unset)';
    this.logger.log(
      `Registry ready: ${this.fileEntries.size} provider(s) from file, ${envMode}`,
    );
  }

  /**
   * หา connection config ของ provider — ไฟล์ก่อน, ไม่เจอ fallback env
   * ไม่มีทั้งคู่ = config ผิดตั้งแต่ deployment → โยน error ชัดๆ
   */
  resolve(provider: string): ConnectionConfig {
    const entry = this.fileEntries.get(provider.toLowerCase());
    if (entry) return entry;

    if (!process.env.DB_HOST) {
      throw new Error(
        `No connection config for provider "${provider}" — ` +
          `เพิ่ม entry ใน CONNECTIONS_FILE หรือตั้ง DB_HOST fallback`,
      );
    }

    return {
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT ?? '5432', 10),
      user: process.env.DB_USER ?? '',
      password: process.env.DB_PASSWORD ?? '',
      ssl: process.env.DB_SSL === 'true',
      sslRejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
      poolMax: parseInt(process.env.DB_POOL_MAX ?? '20', 10),
      dbNamePrefix: process.env.DB_NAME_PREFIX ?? 'smlerpmain',
      source: 'env',
    };
  }

  /** ชื่อ auth DB ของ provider เช่น demo → smlerpmaindemo (prefix per-connection) */
  authDbName(provider: string): string {
    return `${this.resolve(provider).dbNamePrefix}${provider.toLowerCase()}`;
  }

  /** provider ทั้งหมดที่ประกาศในไฟล์ (ไม่รวม env fallback) — ใช้กับ status/monitoring */
  listFileProviders(): string[] {
    return Array.from(this.fileEntries.keys());
  }

  private loadFile() {
    const filePath = process.env.CONNECTIONS_FILE;
    if (!filePath) {
      this.logger.log('CONNECTIONS_FILE unset — env fallback mode only');
      return;
    }

    // fail fast ทั้ง 3 เคส (อ่านไม่ได้ / JSON พัง / schema ไม่ผ่าน) —
    // ดีกว่าปล่อย service ขึ้นแล้ว route ผิดฐาน
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch (error) {
      throw new Error(
        `CONNECTIONS_FILE not readable: ${filePath} — ${error instanceof Error ? error.message : error}`,
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `CONNECTIONS_FILE invalid JSON: ${filePath} — ${error instanceof Error ? error.message : error}`,
      );
    }

    const parsed = connectionsFileSchema.safeParse(json);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new Error(`CONNECTIONS_FILE schema invalid: ${detail}`);
    }

    const entries = new Map<string, ConnectionConfig>();
    for (const { provider, ...config } of parsed.data.connections) {
      const key = provider.toLowerCase();
      if (entries.has(key)) {
        throw new Error(`CONNECTIONS_FILE duplicate provider: "${provider}"`);
      }
      entries.set(key, { ...config, source: 'file' });
      this.logger.log(
        `Registered provider "${key}" → ${config.host}:${config.port} (ssl=${config.ssl})`,
      );
    }
    this.fileEntries = entries;
  }
}
