import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { DatabaseConnectionError, QueryTimeoutError } from '../db/db.errors';
import { ErrorCode } from './error-codes';

/**
 * Global Exception Filter — แปลง error ทุกประเภทเป็น response format มาตรฐาน
 * {
 *   success: false,
 *   data: null,
 *   error: { code, message, details? },
 *   requestId, timestamp
 * }
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId =
      (request.headers['x-request-id'] as string) ?? randomUUID();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCode.INTERNAL_ERROR;
    let message = 'Internal server error';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'string') {
        message = resp;
        code = this.mapStatusToCode(status);
      } else if (typeof resp === 'object' && resp !== null) {
        const r = resp as Record<string, unknown>;
        message = (r.message as string) ?? exception.message;
        code = (r.code as string) ?? this.mapStatusToCode(status);
        details = r.details;
      }
    } else if (exception instanceof QueryTimeoutError) {
      status = HttpStatus.REQUEST_TIMEOUT;
      code = ErrorCode.QUERY_TIMEOUT;
      message = exception.message;
    } else if (exception instanceof DatabaseConnectionError) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      code = ErrorCode.DB_CONNECTION_ERROR;
      message = exception.message;
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(exception.stack ?? exception.message);
    }

    response.status(status).json({
      success: false,
      data: null,
      error: { code, message, details },
      requestId,
      timestamp: new Date().toISOString(),
    });
  }

  private mapStatusToCode(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.VALIDATION_ERROR;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.CONFLICT;
      case HttpStatus.REQUEST_TIMEOUT:
        return ErrorCode.QUERY_TIMEOUT;
      default:
        return ErrorCode.INTERNAL_ERROR;
    }
  }
}
