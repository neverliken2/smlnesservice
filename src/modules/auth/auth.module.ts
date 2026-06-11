import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { CnPermissionService } from './cn-permission.service';
import { StockAdjustPermissionService } from './stock-adjust-permission.service';
import { PreSelectAuthGuard } from './pre-select.guard';

/**
 * Feature Auth Module — /auth/login, /auth/select-database, /auth/logout
 *
 * Depend ผ่าน global:
 * - DbModule         → PoolManagerService
 * - core AuthModule  → JwtService, SmlGuidRepository, SmlGuidGuard
 */
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    PreSelectAuthGuard,
    CnPermissionService,
    StockAdjustPermissionService,
  ],
})
export class AuthFeatureModule {}
