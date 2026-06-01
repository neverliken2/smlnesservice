import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtStrategy } from './jwt.strategy';
import { SmlGuidGuard } from './sml-guid.guard';
import { SmlGuidRepository } from './sml-guid.repository';

/**
 * Core Auth Module — JWT + sml_guid infrastructure
 *
 * - JWT ใช้แค่กับ pre-select token (อายุสั้น) — ระหว่าง login ↔ select-database
 * - หลัง select-database จะออก guid_code (= row ใน sml_guid) เป็น session ของจริง
 * - Global เพราะ SmlGuidGuard ติด global ใน app.module.ts
 */
@Global()
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: {
          // ใช้กับ pre-select token เท่านั้น — ค่า default ตรงนี้แทบไม่มีคนเรียก
          expiresIn: (config.get<string>('PRE_SELECT_EXPIRES_IN') ?? '2m') as
            | `${number}${'s' | 'm' | 'h' | 'd'}`
            | number,
        },
      }),
    }),
  ],
  providers: [JwtStrategy, JwtAuthGuard, SmlGuidGuard, SmlGuidRepository],
  exports: [
    JwtModule,
    PassportModule,
    JwtAuthGuard,
    SmlGuidGuard,
    SmlGuidRepository,
  ],
})
export class AuthModule {}
