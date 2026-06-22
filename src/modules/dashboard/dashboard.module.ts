import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardRepository } from './dashboard.repository';
import { DashboardService } from './dashboard.service';

/**
 * Dashboard Module — Read-only reports สำหรับ NextStep Dashboard (Next.js)
 *
 * Depend ผ่าน @Global() ของ core:
 *   - DbModule   → PoolManagerService
 *   - AuthModule → JwtStrategy + global JwtAuthGuard
 *
 * Phase 1: skeleton พร้อม endpoint /ping
 * Phase 3+: เพิ่ม read endpoint ทีละรายงาน (prefix /api/v1/dashboard/*)
 */
@Module({
  controllers: [DashboardController],
  providers: [DashboardService, DashboardRepository],
})
export class DashboardModule {}
