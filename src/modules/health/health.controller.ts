import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../../core/auth';
import { PoolManagerService } from '../../core/db/pool-manager.service';

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
      version: process.env.npm_package_version ?? '0.0.0',
      timestamp: new Date().toISOString(),
    };

    if (provider && /^[a-zA-Z0-9]{1,20}$/.test(provider)) {
      const prefix = process.env.DB_NAME_PREFIX ?? 'smlerpmain';
      const dbName = `${prefix}${provider.toLowerCase()}`;
      const result = await this.pool.checkHealth(dbName);
      base.db = {
        database: dbName,
        healthy: result.healthy,
        latencyMs: result.latencyMs,
        error: result.error,
      };
      if (!result.healthy) base.status = 'degraded';
    }

    return base;
  }
}
