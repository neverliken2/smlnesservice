/**
 * Pool Manager Service
 * Ported from NextStep_CN_Coupon/src/lib/db.ts
 *
 * - Caches one Pool per database name (multi-DB ใน 1 instance)
 * - safeQuery + transaction with timeout protection
 * - SSL support สำหรับ PG remote (ผ่าน network สาธารณะ)
 * - Auto cleanup ผ่าน NestJS lifecycle (onModuleDestroy)
 */

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Pool, PoolClient, PoolConfig } from 'pg';
import { QueryOptions, QueryResult, SqlParam, TIMEOUTS } from './db.types';
import { QueryTimeoutError } from './db.errors';

@Injectable()
export class PoolManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PoolManagerService.name);
  private readonly pools = new Map<string, Pool>();

  onModuleInit() {
    this.logger.log('PoolManagerService ready');
  }

  // ==================== Pool Management ====================

  /**
   * Get or create a connection pool for a specific database.
   * Pool ถูก cache ตามชื่อ DB (lowercase) — reuse ไม่สร้างใหม่ทุกครั้ง
   */
  getPool(databaseName: string): Pool {
    const dbName = databaseName.toLowerCase();
    let pool = this.pools.get(dbName);

    if (!pool) {
      const config: PoolConfig = {
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT ?? '5432', 10),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: dbName,
        max: 10,
        min: 1,
        idleTimeoutMillis: TIMEOUTS.IDLE,
        connectionTimeoutMillis: TIMEOUTS.CONNECTION,
        statement_timeout: TIMEOUTS.QUERY_DEFAULT,
        query_timeout: TIMEOUTS.QUERY_DEFAULT,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10_000,
        ssl: this.buildSslOption(),
      };

      pool = new Pool(config);

      pool.on('error', (err) => {
        this.logger.error(`[Pool Error] ${dbName}: ${err.message}`);
      });
      pool.on('connect', () => {
        this.logger.debug(`New connection: ${dbName}`);
      });

      this.pools.set(dbName, pool);
      this.logger.log(`Created pool: ${dbName}`);
    }

    return pool;
  }

  /**
   * Get pool for auth database (smlerpmain + provider)
   */
  getAuthPool(provider: string): Pool {
    const prefix = process.env.DB_NAME_PREFIX ?? 'smlerpmain';
    return this.getPool(`${prefix}${provider.toLowerCase()}`);
  }

  private buildSslOption(): PoolConfig['ssl'] {
    if (process.env.DB_SSL !== 'true') return false;
    return {
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
    };
  }

  // ==================== Safe Query ====================

  /**
   * Execute a query with timeout protection
   */
  async query<T = Record<string, unknown>>(
    databaseName: string,
    sql: string,
    params?: SqlParam[],
    options: QueryOptions = {},
  ): Promise<QueryResult<T>> {
    const pool = this.getPool(databaseName);

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
    databaseName: string,
    callback: (client: PoolClient) => Promise<T>,
    timeout: number = TIMEOUTS.QUERY_REPORT,
  ): Promise<T> {
    const pool = this.getPool(databaseName);
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

  async checkHealth(databaseName: string): Promise<{
    healthy: boolean;
    latencyMs: number;
    poolSize?: number;
    error?: string;
  }> {
    const start = Date.now();
    try {
      const pool = this.getPool(databaseName);
      const result = await this.query(databaseName, 'SELECT 1 as ok', [], {
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
