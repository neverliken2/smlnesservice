import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { JwtPayload } from '../../core/auth/jwt.types';
import { ErrorCode } from '../../core/error/error-codes';

/**
 * PreSelectAuthGuard — verify JWT แบบ pre-select (ออกจาก /auth/login)
 * ใช้ที่ /auth/select-database; ติดบน handler โดยตรง
 *
 * Populate request.preSelect = {provider, userCode, userLevel}
 * — แยกจาก request.user เพราะ pre-select ไม่ใช่ TenantContext เต็มรูปแบบ
 */

export interface PreSelectContext {
  provider: string;
  userCode: string;
  userLevel: number;
}

declare module 'express' {
  interface Request {
    preSelect?: PreSelectContext;
  }
}

@Injectable()
export class PreSelectAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        code: ErrorCode.UNAUTHORIZED,
        message: 'Authorization Bearer header จำเป็น',
      });
    }

    const token = auth.slice('Bearer '.length).trim();
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException({
        code: ErrorCode.TOKEN_EXPIRED,
        message: 'Token ไม่ถูกต้องหรือหมดอายุ',
      });
    }

    if (payload.tokenType !== 'pre-select') {
      throw new UnauthorizedException({
        code: ErrorCode.UNAUTHORIZED,
        message: 'ต้องใช้ pre-select token จาก /auth/login',
      });
    }
    if (!payload.provider || !payload.sub) {
      throw new UnauthorizedException({
        code: ErrorCode.UNAUTHORIZED,
        message: 'Token payload ไม่ครบ',
      });
    }

    req.preSelect = {
      provider: payload.provider,
      userCode: payload.sub,
      userLevel: payload.userLevel ?? 0,
    };
    return true;
  }
}
