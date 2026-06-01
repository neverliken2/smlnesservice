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
 * NOTE: ต้องมี SmlGuidGuard (global) วาง upstream ก่อน
 * ไม่งั้น request.tenant จะเป็น undefined
 */
export const Tenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.tenant as TenantContext;
  },
);
