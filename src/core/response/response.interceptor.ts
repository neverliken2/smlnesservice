import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { Observable, map } from 'rxjs';
import type { ApiSuccessResponse } from './response.types';

/**
 * Response Interceptor — wrap controller return value เป็น ApiSuccessResponse
 *
 * ตัวอย่าง:
 *   controller returns: { docNo: 'CN2606001' }
 *   client receives:    { success: true, data: { docNo: 'CN2606001' }, error: null, requestId, timestamp }
 *
 * Error path ไม่ผ่าน interceptor นี้ — GlobalExceptionFilter จัดการแยก
 */
@Injectable()
export class ResponseInterceptor<T = unknown> implements NestInterceptor<
  T,
  ApiSuccessResponse<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<T>> {
    const req = context.switchToHttp().getRequest<Request>();
    const requestId = (req.headers['x-request-id'] as string) ?? randomUUID();

    return next.handle().pipe(
      map((data) => ({
        success: true as const,
        data,
        error: null,
        requestId,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
