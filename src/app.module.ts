import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { DbModule } from './core/db';
import { ApiKeyGuard, AuthModule } from './core/auth';
import { AuditInterceptor } from './core/audit';
import { GlobalExceptionFilter } from './core/error';
import { ResponseInterceptor } from './core/response';
import { AuthFeatureModule } from './modules/auth';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    DbModule,
    AuthModule,
    AuthFeatureModule,
    HealthModule,
  ],
  providers: [
    // ApiKeyGuard ติด global — ทุก endpoint ต้องมี X-API-Key + X-Provider
    // ยกเว้น handler ที่ติด @SkipApiKey() (เช่น /health)
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    // Order ของ APP_INTERCEPTOR สำคัญ:
    // request → ResponseInterceptor → AuditInterceptor → handler → response
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
