import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { TenantContext } from '../tenant/tenant.types';
import { ClientRegistryService } from './client-registry.service';
import type { JwtPayload } from './jwt.types';

/**
 * JWT Strategy — verify session token + populate request.user
 *
 * - รับเฉพาะ tokenType === 'session' (pre-select ใช้ผ่าน PreSelectAuthGuard)
 * - เช็คว่า clientCode ใน payload ยังอยู่ใน ClientRegistry
 *   → กัน JWT เก่าหลัง admin rotate client token
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly registry: ClientRegistryService,
  ) {
    const secret = config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error(
        'JWT_SECRET is required — ตั้งใน .env ก่อน start service',
      );
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  validate(payload: JwtPayload): TenantContext {
    if (payload.tokenType !== 'session') {
      throw new UnauthorizedException(
        'ต้องใช้ session token — pre-select ใช้ผ่าน /auth/select-database เท่านั้น',
      );
    }
    if (!payload.provider || !payload.database || !payload.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }
    if (
      !payload.clientCode ||
      !this.registry.isClientAllowed(payload.clientCode)
    ) {
      throw new UnauthorizedException(
        'Client ไม่ allowed แล้ว — กรุณา login ใหม่',
      );
    }
    return {
      provider: payload.provider,
      database: payload.database,
      userCode: payload.sub,
      userLevel: payload.userLevel ?? 0,
    };
  }
}
