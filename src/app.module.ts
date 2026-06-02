import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Reflector } from '@nestjs/core';

import { DbModule } from './core/db';
import { AuthModule, JwtAuthGuard } from './core/auth';
import { PUBLIC_KEY } from './core/auth/public.decorator';
import { AuditInterceptor } from './core/audit';
import { GlobalExceptionFilter } from './core/error';
import { ResponseInterceptor } from './core/response';
import { AuthFeatureModule } from './modules/auth';
import { CreditNoteModule } from './modules/credit-note';
import { HealthModule } from './modules/health/health.module';
import { ExecutionContext, Injectable } from '@nestjs/common';

/**
 * GlobalJwtAuthGuard — ครอบ JwtAuthGuard ของ Passport
 * เพื่อให้ตรวจ @Public() ก่อน — ถ้า public ก็ข้าม
 */
@Injectable()
class GlobalJwtAuthGuard extends JwtAuthGuard {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(ctx: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(ctx) as boolean | Promise<boolean>;
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    DbModule,
    AuthModule,
    AuthFeatureModule,
    CreditNoteModule,
    HealthModule,
  ],
  providers: [
    // JwtAuthGuard ติด global — verify session JWT ทุก endpoint
    // ยกเว้น handler ที่ติด @Public() (/health, /auth/login, /auth/select-database)
    { provide: APP_GUARD, useClass: GlobalJwtAuthGuard },
    // Order ของ APP_INTERCEPTOR สำคัญ:
    // request → ResponseInterceptor → AuditInterceptor → handler → response
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
