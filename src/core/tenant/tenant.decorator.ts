import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { TenantContext } from './tenant.types';

/**
 * @Tenant() decorator — inject TenantContext จาก request
 *
 * ใช้:
 *   @Get()
 *   foo(@Tenant() tenant: TenantContext) { ... }
 *
 * NOTE: ต้องมี JwtAuthGuard (global หรือ explicit) วาง upstream ก่อน
 * เพราะ Passport JwtStrategy ตั้ง request.user
 */
export const Tenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.user as TenantContext;
  },
);
