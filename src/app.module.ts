import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { DbModule } from './core/db';
import { AuthModule } from './core/auth';
import { AuditInterceptor } from './core/audit';
import { GlobalExceptionFilter } from './core/error';
import { ResponseInterceptor } from './core/response';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    DbModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Order ของ APP_INTERCEPTOR สำคัญ:
    // request → ResponseInterceptor → AuditInterceptor → handler → response
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
