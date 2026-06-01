import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { TenantContext } from '../tenant/tenant.types';
import type { JwtPayload } from './jwt.types';

/**
 * JWT Strategy — verify token + populate request.user เป็น TenantContext
 *
 * NestJS Passport pattern: คำสั่งที่ return จาก validate() จะถูกใส่ใน request.user
 * → @Tenant() decorator อ่านจาก request.user ได้ตรงๆ
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
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
    if (!payload.provider || !payload.database || !payload.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }
    return {
      provider: payload.provider,
      database: payload.database,
      userCode: payload.sub,
      userLevel: payload.userLevel ?? 0,
    };
  }
}
