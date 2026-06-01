import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { PreSelectAuthGuard } from './pre-select.guard';

/**
 * Feature Auth Module — /auth/login, /auth/select-database, /auth/refresh
 *
 * Depend ผ่าน global:
 * - DbModule         → PoolManagerService
 * - core AuthModule  → JwtService (sign/verify), JwtAuthGuard
 */
@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, PreSelectAuthGuard],
})
export class AuthFeatureModule {}
