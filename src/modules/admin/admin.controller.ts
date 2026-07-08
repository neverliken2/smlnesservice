import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../core/auth';
import {
  ConnectionRegistryService,
  ReloadDiff,
} from '../../core/db/connection-registry.service';
import { PoolManagerService } from '../../core/db/pool-manager.service';
import { ErrorCode } from '../../core/error/error-codes';
import { AdminTokenGuard } from './admin-token.guard';

interface ProviderStatus {
  provider: string;
  host: string;
  port: number;
  ssl: boolean;
  authDb: string;
  healthy: boolean;
  latencyMs: number;
  error?: string;
  openPools: number;
}

interface ConnectionsStatusResponse {
  envFallback: { configured: boolean; host?: string };
  providers: ProviderStatus[];
  totalOpenPools: number;
}

type ReloadResponse = ReloadDiff & { drainedPools: number };

/**
 * Admin endpoints — ops ของ connection registry (Model B)
 *
 * Auth: Bearer <ADMIN_TOKEN> (env) — @Public() ข้าม global JWT guard
 * แล้วให้ AdminTokenGuard คุมแทน; ไม่ตั้ง ADMIN_TOKEN = 404 ทุก endpoint
 *
 * อยู่นอก global prefix (เหมือน /health) → path ตรงตัว /admin/...
 */
@ApiTags('admin')
@ApiBearerAuth('clientToken')
@Controller('admin')
@Public()
@UseGuards(AdminTokenGuard)
export class AdminController {
  constructor(
    private readonly registry: ConnectionRegistryService,
    private readonly pool: PoolManagerService,
  ) {}

  @Get('connections/status')
  @ApiOperation({
    summary: 'สถานะทุก provider ใน connection registry',
    description:
      'list provider จาก CONNECTIONS_FILE + ping auth DB ของแต่ละราย (ไม่โชว์ credentials) — ' +
      'provider ที่ host ล่มอาจรอ connection timeout (~30s)',
  })
  async connectionsStatus(): Promise<ConnectionsStatusResponse> {
    const providers = this.registry.listFileProviders();
    const poolKeys = this.pool.openPoolKeys();

    const rows = await Promise.all(
      providers.map(async (provider): Promise<ProviderStatus> => {
        const conn = this.registry.resolve(provider);
        const authDb = this.registry.authDbName(provider);
        const health = await this.pool.checkHealth({
          provider,
          database: authDb,
        });
        return {
          provider,
          host: conn.host,
          port: conn.port,
          ssl: conn.ssl,
          authDb,
          healthy: health.healthy,
          latencyMs: health.latencyMs,
          error: health.error,
          openPools: poolKeys.filter((k) => k.startsWith(`${provider}:`))
            .length,
        };
      }),
    );

    return {
      envFallback: this.registry.envFallback(),
      providers: rows,
      totalOpenPools: poolKeys.length,
    };
  }

  @Post('reload')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'อ่าน CONNECTIONS_FILE ใหม่โดยไม่ restart',
    description:
      'validate ก่อน swap — ไฟล์พังตอบ 400 และคง config เดิม; ' +
      'provider ที่ config เปลี่ยน/หายไป จะถูก drain pool (query ถัดไปใช้ config ใหม่)',
  })
  async reload(): Promise<ReloadResponse> {
    let diff: ReloadDiff;
    try {
      diff = this.registry.reload();
    } catch (error) {
      throw new BadRequestException({
        code: ErrorCode.RELOAD_FAILED,
        message: `reload ไม่สำเร็จ — config เดิมยังใช้งานอยู่: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      });
    }

    let drainedPools = 0;
    for (const provider of [...diff.changed, ...diff.removed]) {
      drainedPools += await this.pool.closeProviderPools(provider);
    }

    return { ...diff, drainedPools };
  }
}
