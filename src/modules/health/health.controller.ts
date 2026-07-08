import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../../core/auth';
import { PoolManagerService } from '../../core/db/pool-manager.service';
import { APP_VERSION } from '../../core/version';

interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  uptimeSeconds: number;
  version: string;
  timestamp: string;
  db?: {
    database: string;
    healthy: boolean;
    latencyMs: number;
    error?: string;
  };
}

/**
 * GET /health (no global prefix, no auth)
 * - Liveness check: process ตอบ → status=ok
 * - Optional: ?provider=demo → ลอง connect smlerpmaindemo + return latency
 */
@ApiTags('health')
@Controller('health')
@Public()
export class HealthController {
  private readonly bootTime = Date.now();

  constructor(private readonly pool: PoolManagerService) {}

  @Get()
  @ApiOperation({
    summary: 'Health check',
    description:
      'Liveness + optional readiness check ของ auth DB ตาม provider ที่ระบุ',
  })
  @ApiQuery({
    name: 'provider',
    required: false,
    description: 'provider code — ถ้าระบุ จะ ping auth DB และ return latency',
  })
  async check(@Query('provider') provider?: string): Promise<HealthResponse> {
    const base: HealthResponse = {
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - this.bootTime) / 1000),
      version: APP_VERSION,
      timestamp: new Date().toISOString(),
    };

    if (provider && /^[a-zA-Z0-9]{1,20}$/.test(provider)) {
      try {
        const dbName = this.pool.authDbName(provider);
        const result = await this.pool.checkHealth({
          provider,
          database: dbName,
        });
        base.db = {
          database: dbName,
          healthy: result.healthy,
          latencyMs: result.latencyMs,
          error: result.error,
        };
        if (!result.healthy) base.status = 'degraded';
      } catch (error) {
        // provider ไม่อยู่ใน registry และไม่มี env fallback — ตอบ degraded ไม่ใช่ 500
        base.db = {
          database: `(unresolved: ${provider})`,
          healthy: false,
          latencyMs: 0,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
        base.status = 'degraded';
      }
    }

    return base;
  }
}
