import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ErrorCode } from '../error/error-codes';
import { ClientRegistryService } from './client-registry.service';

/**
 * ClientAuthGuard — ใช้กับ /auth/login เท่านั้น
 *
 * Header: `Authorization: Bearer <CLIENT_TOKEN>`
 *   (CLIENT_TOKEN คือ raw token ที่เก็บใน env ของ web client เช่น NextStep CN Coupon)
 *
 * Flow:
 *   1. parse Bearer token
 *   2. ClientRegistry.verifyToken (bcrypt.compare loop, cache 5m)
 *   3. ถ้า match → populate req.clientCode → ผ่าน
 *   4. ถ้าไม่ → 401 INVALID_API_KEY
 *
 * หลัง login: client จะใช้ Bearer <sessionJWT> แทน (JwtAuthGuard verify เอง)
 */

declare module 'express' {
  interface Request {
    /** clientCode ที่ ClientAuthGuard ระบุ (เฉพาะ /auth/login) */
    clientCode?: string;
  }
}

const SCHEME = 'Bearer ';

@Injectable()
export class ClientAuthGuard implements CanActivate {
  constructor(private readonly registry: ClientRegistryService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const rawAuth: string | string[] | undefined = req.headers['authorization'];
    if (!rawAuth) {
      throw new UnauthorizedException({
        code: ErrorCode.INVALID_API_KEY,
        message: 'Authorization Bearer header จำเป็น',
      });
    }
    const value: string = (
      Array.isArray(rawAuth) ? rawAuth[0] : rawAuth
    ) as string;
    if (!value.startsWith(SCHEME)) {
      throw new UnauthorizedException({
        code: ErrorCode.INVALID_API_KEY,
        message: 'Authorization ต้องเป็น scheme "Bearer"',
      });
    }
    const token: string = value.slice(SCHEME.length).trim();
    if (!token) {
      throw new UnauthorizedException({
        code: ErrorCode.INVALID_API_KEY,
        message: 'Bearer token ว่าง',
      });
    }

    const clientCode = await this.registry.verifyToken(token);
    if (!clientCode) {
      throw new UnauthorizedException({
        code: ErrorCode.INVALID_API_KEY,
        message: 'Client token ไม่ถูกต้อง',
      });
    }
    req.clientCode = clientCode;
    return true;
  }
}
