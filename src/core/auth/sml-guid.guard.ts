import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SmlGuidRepository } from './sml-guid.repository';
import { ErrorCode } from '../error/error-codes';
import type { TenantContext } from '../tenant/tenant.types';
import { PUBLIC_KEY } from './public.decorator';

/**
 * SmlGuidGuard — global guard verify session token (= guid_code)
 *
 * Header format:
 *   Authorization: SmlGuid <provider>:<guid_code>
 *   ตัวอย่าง       SmlGuid demo:SMLWebService.RandomGUID@6ef56511
 *
 * Flow:
 *   1. parse → ได้ provider + guidCode
 *   2. cache hit (30s) → ผ่าน
 *   3. cache miss → SELECT sml_guid
 *   4. ถ้าไม่เจอ → 401
 *   5. ถ้า last_access_time เกิน TTL (default 8h) → DELETE row + 401 (lazy cleanup)
 *   6. ถ้า valid → UPDATE last_access_time, cache, populate req.tenant
 *
 * Skip ถ้า handler ติด @Public()
 */

declare module 'express' {
  interface Request {
    tenant?: TenantContext;
    /** raw guid_code ที่ใช้ใน Authorization header — ให้ /auth/logout ใช้ DELETE */
    guidCode?: string;
  }
}

interface CacheEntry {
  tenant: TenantContext;
  /** เวลาที่ row จะ expire จริง ๆ ใน DB (ไม่ใช่อายุ cache) */
  rowExpiresAt: number;
  /** เวลาที่ cache entry จะ stale → ต้อง refresh */
  cacheExpiresAt: number;
}

const CACHE_TTL_MS = 30 * 1000;
const SCHEME_PREFIX = 'SmlGuid ';
const PROVIDER_PATTERN = /^[a-zA-Z0-9]{1,20}$/;

@Injectable()
export class SmlGuidGuard implements CanActivate {
  private readonly logger = new Logger(SmlGuidGuard.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly reflector: Reflector,
    private readonly repo: SmlGuidRepository,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const parsed = this.parseAuthHeader(req.headers['authorization']);
    if (!parsed) {
      throw new UnauthorizedException({
        code: ErrorCode.UNAUTHORIZED,
        message:
          'Authorization SmlGuid header จำเป็น — format: "SmlGuid <provider>:<guid_code>"',
      });
    }
    const { provider, guidCode } = parsed;

    const cacheKey = `${provider}|${guidCode}`;
    const ttlMs = this.sessionTtlMs();
    const cached = this.cache.get(cacheKey);
    if (
      cached &&
      cached.cacheExpiresAt > Date.now() &&
      cached.rowExpiresAt > Date.now()
    ) {
      req.tenant = cached.tenant;
      req.guidCode = guidCode;
      return true;
    }

    let row;
    try {
      row = await this.repo.findByCode(provider, guidCode);
    } catch (err) {
      const dbErr = err as { code?: string };
      if (dbErr.code === '3D000' || dbErr.code === '42P01') {
        this.logger.warn(
          `Provider ${provider}: auth DB หรือ sml_guid ไม่พบ (${dbErr.code})`,
        );
        throw new UnauthorizedException({
          code: ErrorCode.UNAUTHORIZED,
          message: 'Session ไม่ถูกต้อง',
        });
      }
      throw err;
    }

    if (!row) {
      this.cache.delete(cacheKey);
      throw new UnauthorizedException({
        code: ErrorCode.UNAUTHORIZED,
        message: 'Session ไม่ถูกต้องหรือถูก logout ไปแล้ว',
      });
    }

    const lastAccessMs = new Date(row.last_access_time).getTime();
    const rowExpiresAt = lastAccessMs + ttlMs;
    if (rowExpiresAt <= Date.now()) {
      // lazy cleanup — ลบ row ที่ตัวเองเจอ expired
      try {
        await this.repo.delete(provider, guidCode);
      } catch (err) {
        this.logger.warn(
          `Lazy cleanup ล้มเหลว provider=${provider} guid=${guidCode}: ${
            (err as Error).message
          }`,
        );
      }
      this.cache.delete(cacheKey);
      throw new UnauthorizedException({
        code: ErrorCode.TOKEN_EXPIRED,
        message: 'Session หมดอายุ — กรุณา login ใหม่',
      });
    }

    // update last_access_time + cache
    // fire-and-forget เพื่อไม่หน่วง response — error log แต่ไม่ throw
    void this.repo
      .touchLastAccess(provider, guidCode)
      .catch((err) =>
        this.logger.warn(
          `touchLastAccess ล้มเหลว provider=${provider} guid=${guidCode}: ${
            (err as Error).message
          }`,
        ),
      );

    const tenant: TenantContext = {
      provider,
      database: row.database_code,
      userCode: row.user_code,
      userLevel: 0,
    };
    this.cache.set(cacheKey, {
      tenant,
      rowExpiresAt: Date.now() + ttlMs, // ตอนนี้เพิ่ง touch → reset timer
      cacheExpiresAt: Date.now() + CACHE_TTL_MS,
    });
    req.tenant = tenant;
    req.guidCode = guidCode;
    return true;
  }

  private parseAuthHeader(
    raw: string | string[] | undefined,
  ): { provider: string; guidCode: string } | null {
    if (!raw) return null;
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value?.startsWith(SCHEME_PREFIX)) return null;

    const credentials = value.slice(SCHEME_PREFIX.length).trim();
    const sepIdx = credentials.indexOf(':');
    if (sepIdx <= 0 || sepIdx === credentials.length - 1) return null;

    const provider = credentials.slice(0, sepIdx).trim().toLowerCase();
    const guidCode = credentials.slice(sepIdx + 1).trim();
    if (!PROVIDER_PATTERN.test(provider) || !guidCode) return null;
    return { provider, guidCode };
  }

  private sessionTtlMs(): number {
    const hours = parseInt(process.env.SESSION_TTL_HOURS ?? '8', 10);
    if (!Number.isFinite(hours) || hours <= 0) return 8 * 3600 * 1000;
    return hours * 3600 * 1000;
  }
}
