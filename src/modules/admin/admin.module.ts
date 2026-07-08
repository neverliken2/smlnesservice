/**
 * Admin Module — ops endpoints ของ connection registry (Model B)
 *
 * Dependencies:
 *   - DbModule (@Global) → ConnectionRegistryService + PoolManagerService
 */
import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminTokenGuard } from './admin-token.guard';

@Module({
  controllers: [AdminController],
  providers: [AdminTokenGuard],
})
export class AdminModule {}
