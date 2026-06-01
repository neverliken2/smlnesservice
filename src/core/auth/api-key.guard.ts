import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { PoolManagerService } from '../db/pool-manager.service';
import { ErrorCode } from '../error/error-codes';
import { SKIP_API_KEY_KEY } from './skip-api-key.decorator';

/**
 * ApiKeyGuard — global guard ตรวจ X-API-Key + X-Provider header
 *
 * - ต้องมี header ทั้งสอง (ยกเว้น handler ที่ติด @SkipApiKey เช่น /health)
 * - Verify โดย query `sml_api_clients` ของ smlerpmain<provider>, bcrypt.compare ทุก active row
 * - Cache hit สำเร็จ 5 นาที (in-memory) — กัน hit DB + bcrypt cost ทุก request
 * - เก็บ provider (lowercase) ไว้ที่ request.tenantProvider — ให้ AuthController ใช้ต่อ
 *
 * Optimization note: ตอนนี้ loop bcrypt.compare ทุก row.
 * เมื่อ client เกิน ~10 ต่อ provider ควรเพิ่ม column `key_lookup_id` (sha256 prefix ของ raw key) + index
 * เพื่อ narrow ก่อน bcrypt.
 */

interface ApiKeyRow {
  api_key_hash: string;
  client_code: string;
}

interface CacheEntry {
  clientCode: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const PROVIDER_PATTERN = /^[a-zA-Z0-9]{1,20}$/;

declare module 'express' {
  interface Request {
    tenantProvider?: string;
    apiClientCode?: string;
  }
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly reflector: Reflector,
    private readonly pool: PoolManagerService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_API_KEY_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (skip) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const apiKey = this.headerValue(req.headers['x-api-key']);
    const providerRaw = this.headerValue(req.headers['x-provider']);

    if (!apiKey || !providerRaw) {
      throw new UnauthorizedException({
        code: ErrorCode.INVALID_API_KEY,
        message: 'X-API-Key และ X-Provider headers จำเป็น',
      });
    }
    if (!PROVIDER_PATTERN.test(providerRaw)) {
      throw new UnauthorizedException({
        code: ErrorCode.INVALID_API_KEY,
        message: 'X-Provider format ไม่ถูกต้อง',
      });
    }

    const provider = providerRaw.toLowerCase();
    const cacheKey = `${provider}:${this.shortHash(apiKey)}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      req.tenantProvider = provider;
      req.apiClientCode = cached.clientCode;
      return true;
    }

    const matchedClient = await this.verifyAgainstDb(provider, apiKey);
    if (!matchedClient) {
      throw new UnauthorizedException({
        code: ErrorCode.INVALID_API_KEY,
        message: 'API key ไม่ถูกต้องหรือ provider ไม่พบ',
      });
    }

    this.cache.set(cacheKey, {
      clientCode: matchedClient,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    req.tenantProvider = provider;
    req.apiClientCode = matchedClient;
    return true;
  }

  /** Returns client_code ของ row ที่ match, หรือ null */
  private async verifyAgainstDb(
    provider: string,
    rawKey: string,
  ): Promise<string | null> {
    const authDb = this.pool.getAuthPool(provider).options.database;
    if (!authDb) return null;

    let rows: ApiKeyRow[];
    try {
      const result = await this.pool.query<ApiKeyRow>(
        authDb,
        `SELECT client_code, api_key_hash
           FROM sml_api_clients
          WHERE active_status = 1`,
        [],
        { timeout: 5_000 },
      );
      rows = result.rows;
    } catch (err) {
      const dbErr = err as { code?: string };
      // 3D000 = database does not exist; 42P01 = relation does not exist
      if (dbErr.code === '3D000' || dbErr.code === '42P01') {
        this.logger.warn(
          `Provider ${provider}: auth DB หรือ sml_api_clients ไม่พบ (${dbErr.code})`,
        );
        return null;
      }
      throw err;
    }

    for (const row of rows) {
      if (await bcrypt.compare(rawKey, row.api_key_hash)) {
        return row.client_code;
      }
    }
    return null;
  }

  private headerValue(raw: string | string[] | undefined): string | null {
    if (!raw) return null;
    const v = Array.isArray(raw) ? raw[0] : raw;
    return v?.trim() || null;
  }

  private shortHash(input: string): string {
    return createHash('sha256').update(input).digest('hex').slice(0, 32);
  }
}
