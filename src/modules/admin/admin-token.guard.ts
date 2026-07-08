import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { ErrorCode } from '../../core/error/error-codes';

/**
 * AdminTokenGuard — ป้องกัน /admin/* ด้วย ADMIN_TOKEN (คนละชุดกับ client token)
 *
 * - ไม่ตั้ง ADMIN_TOKEN = ปิด feature ทั้งชุด → ตอบ 404 (ไม่บอกใบ้ว่ามี endpoint)
 * - เทียบ token แบบ timing-safe (hash ก่อนเทียบ — กันทั้ง timing attack และ
 *   ข้อจำกัด timingSafeEqual ที่ buffer ต้องยาวเท่ากัน)
 * - ใช้คู่กับ @Public() เพื่อข้าม global JWT guard (admin ไม่มี session JWT)
 */
@Injectable()
export class AdminTokenGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) {
      throw new NotFoundException();
    }

    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';

    if (!token || !safeEqual(token, adminToken)) {
      throw new UnauthorizedException({
        code: ErrorCode.INVALID_ADMIN_TOKEN,
        message: 'admin token ไม่ถูกต้อง',
      });
    }
    return true;
  }
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}
