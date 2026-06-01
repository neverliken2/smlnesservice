import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import type { TenantContext } from '../tenant/tenant.types';

/**
 * Audit Interceptor — log ทุก request ที่เข้ามา
 *
 * Format: METHOD /path STATUS DURATIONms provider=... user=...
 *
 * Phase 0: log → stdout เท่านั้น
 * Phase 1+: เพิ่ม persist ลง audit_log table
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Audit');

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const start = Date.now();
    const req = context.switchToHttp().getRequest<Request>();
    const tenant = req.user as TenantContext | undefined;

    const ctx = tenant
      ? ` provider=${tenant.provider} user=${tenant.userCode}`
      : '';

    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Date.now() - start;
          this.logger.log(`${req.method} ${req.url} ${ms}ms OK${ctx}`);
        },
        error: (err: Error) => {
          const ms = Date.now() - start;
          this.logger.warn(
            `${req.method} ${req.url} ${ms}ms ERROR=${err.message}${ctx}`,
          );
        },
      }),
    );
  }
}
