import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ApiKeyGuard } from './api-key.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtStrategy } from './jwt.strategy';

/**
 * Core Auth Module — JWT issuer + verifier
 * - Global เพราะ JwtAuthGuard ถูกใช้ในทุก feature module
 * - ยังไม่มี /auth/login endpoint ที่นี่ — อยู่ใน modules/auth/ (Phase 1)
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
          // env เป็น string ปกติ — ms() parse runtime
          // cast เพราะ @nestjs/jwt expects template literal type ของ ms package
          expiresIn: (config.get<string>('JWT_EXPIRES_IN') ?? '30m') as
            | `${number}${'s' | 'm' | 'h' | 'd'}`
            | number,
        },
      }),
    }),
  ],
  providers: [JwtStrategy, JwtAuthGuard, ApiKeyGuard],
  exports: [JwtModule, PassportModule, JwtAuthGuard, ApiKeyGuard],
})
export class AuthModule {}
