/**
 * Pool Manager Service
 * Ported from NextStep_CN_Coupon/src/lib/db.ts
 *
 * - Caches one Pool per (provider, database) — provider ต่างกันอาจอยู่คนละ PG server
 *   และอาจมีชื่อ DB ซ้ำกันได้ (เช่น ลูกค้าสองรายมี "demo" ทั้งคู่)
 * - Connection config (host/creds/ssl) resolve ผ่าน ConnectionRegistryService
 * - safeQuery + transaction with timeout protection
 * - Auto cleanup ผ่าน NestJS lifecycle (onModuleDestroy)
 */

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Pool, PoolClient, PoolConfig } from 'pg';
import {
  QueryOptions,
  QueryResult,
  SqlParam,
  TenantRef,
  TIMEOUTS,
} from './db.types';
import { QueryTimeoutError } from './db.errors';
import { ConnectionRegistryService } from './connection-registry.service';

@Injectable()
export class PoolManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PoolManagerService.name);
  private readonly pools = new Map<string, Pool>();

  constructor(private readonly registry: ConnectionRegistryService) {}

  onModuleInit() {
    this.logger.log('PoolManagerService ready');
  }

  // ==================== Pool Management ====================

  /**
   * Get or create a connection pool for (provider, database).
   * Pool cache key = `${provider}:${dbName}` — reuse ไม่สร้างใหม่ทุกครั้ง
   */
  getPool(provider: string, databaseName: string): Pool {
    const providerKey = provider.toLowerCase();
    const dbName = databaseName.toLowerCase();
    const poolKey = `${providerKey}:${dbName}`;
    let pool = this.pools.get(poolKey);

    if (!pool) {
      const conn = this.registry.resolve(providerKey);
      const config: PoolConfig = {
        host: conn.host,
        port: conn.port,
        user: conn.user,
        password: conn.password,
        database: dbName,
        max: conn.poolMax,
        min: 1,
        idleTimeoutMillis: TIMEOUTS.IDLE,
        connectionTimeoutMillis: TIMEOUTS.CONNECTION,
        statement_timeout: TIMEOUTS.QUERY_DEFAULT,
        query_timeout: TIMEOUTS.QUERY_DEFAULT,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10_000,
        ssl: conn.ssl
          ? { rejectUnauthorized: conn.sslRejectUnauthorized }
          : false,
      };

      pool = new Pool(config);

      pool.on('error', (err) => {
        this.logger.error(`[Pool Error] ${poolKey}: ${err.message}`);
      });
      pool.on('connect', () => {
        this.logger.debug(`New connection: ${poolKey}`);
      });

      this.pools.set(poolKey, pool);
      this.logger.log(
        `Created pool: ${poolKey} → ${conn.host} (${conn.source})`,
      );
    }

    return pool;
  }

  /**
   * Get pool for auth database (dbNamePrefix + provider เช่น smlerpmaindemo)
   */
  getAuthPool(provider: string): Pool {
    return this.getPool(provider, this.registry.authDbName(provider));
  }

  /** ชื่อ auth DB ของ provider — delegate ไป registry (prefix เป็น per-connection) */
  authDbName(provider: string): string {
    return this.registry.authDbName(provider);
  }

  /** pool key ทั้งหมดที่เปิดอยู่ (`provider:dbName`) — ใช้กับ status endpoint */
  openPoolKeys(): string[] {
    return Array.from(this.pools.keys());
  }

  /**
   * ปิดทุก pool ของ provider (ใช้หลัง reload เมื่อ connection config เปลี่ยน)
   * — query ถัดไปจะสร้าง pool ใหม่ด้วย config ล่าสุดเอง (lazy)
   */
  async closeProviderPools(provider: string): Promise<number> {
    const prefix = `${provider.toLowerCase()}:`;
    let closed = 0;
    for (const [key, pool] of Array.from(this.pools.entries())) {
      if (!key.startsWith(prefix)) continue;
      this.pools.delete(key);
      closed++;
      try {
        await pool.end();
        this.logger.log(`Pool drained: ${key}`);
      } catch (error) {
        this.logger.error(`Error draining pool ${key}:`, error);
      }
    }
    return closed;
  }

  // ==================== Safe Query ====================

  /**
   * Execute a query with timeout protection
   * `tenant` รับ TenantContext ตรงๆ ได้ (มี provider + database ครบ)
   */
  async query<T = Record<string, unknown>>(
    tenant: TenantRef,
    sql: string,
    params?: SqlParam[],
    options: QueryOptions = {},
  ): Promise<QueryResult<T>> {
    const pool = this.getPool(tenant.provider, tenant.database);

    let timeout = options.timeout ?? TIMEOUTS.QUERY_DEFAULT;
    if (options.isReport && !options.timeout) {
      timeout = TIMEOUTS.QUERY_REPORT;
    }
    timeout = Math.min(timeout, TIMEOUTS.QUERY_MAX);

    const client = await pool.connect();
    let timeoutId: NodeJS.Timeout | undefined;

    try {
      await client.query(`SET statement_timeout = ${timeout}`);

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new QueryTimeoutError(timeout));
        }, timeout + 2_000);
      });

      const queryPromise = client.query(sql, params);
      const result = await Promise.race([queryPromise, timeoutPromise]);
      if (timeoutId) clearTimeout(timeoutId);

      return {
        rows: result.rows as T[],
        rowCount: result.rowCount ?? 0,
      };
    } catch (error) {
      try {
        await client.query('SELECT pg_cancel_backend(pg_backend_pid())');
      } catch {
        // ignore cancel errors
      }
      throw error;
    } finally {
      if (typeof timeoutId !== 'undefined') clearTimeout(timeoutId);
      try {
        await client.query('RESET statement_timeout');
      } catch {
        // ignore
      }
      client.release();
    }
  }

  // ==================== Transaction ====================

  /**
   * Run callback in a transaction with timeout.
   * NOTE: ภายใน callback ใช้ `client.query()` ตรงๆ (ไม่ใช้ safeQuery)
   * เพื่อหลีกเลี่ยง gotcha ตาม CLAUDE.md ข้อ 5
   */
  async transaction<T>(
    tenant: TenantRef,
    callback: (client: PoolClient) => Promise<T>,
    timeout: number = TIMEOUTS.QUERY_REPORT,
  ): Promise<T> {
    const pool = this.getPool(tenant.provider, tenant.database);
    const client = await pool.connect();

    try {
      await client.query(
        `SET statement_timeout = ${Math.min(timeout, TIMEOUTS.QUERY_MAX)}`,
      );
      await client.query('BEGIN');

      const result = await callback(client);

      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback errors
      }
      throw error;
    } finally {
      try {
        await client.query('RESET statement_timeout');
      } catch {
        // ignore
      }
      client.release();
    }
  }

  // ==================== Health Check ====================

  async checkHealth(tenant: TenantRef): Promise<{
    healthy: boolean;
    latencyMs: number;
    poolSize?: number;
    error?: string;
  }> {
    const start = Date.now();
    try {
      const pool = this.getPool(tenant.provider, tenant.database);
      const result = await this.query(tenant, 'SELECT 1 as ok', [], {
        timeout: 5_000,
      });
      return {
        healthy: result.rows.length > 0,
        latencyMs: Date.now() - start,
        poolSize: pool.totalCount,
      };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ==================== Lifecycle ====================

  async onModuleDestroy() {
    this.logger.log('Closing all pools...');
    const closes = Array.from(this.pools.entries()).map(
      async ([name, pool]) => {
        try {
          await pool.end();
          this.logger.log(`Pool closed: ${name}`);
        } catch (error) {
          this.logger.error(`Error closing pool ${name}:`, error);
        }
      },
    );
    await Promise.all(closes);
    this.pools.clear();
    this.logger.log('All pools closed');
  }
}
