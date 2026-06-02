import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ClientAuthGuard } from './client-auth.guard';
import { ClientRegistryService } from './client-registry.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtStrategy } from './jwt.strategy';

/**
 * Core Auth Module — JWT + Client Registry infrastructure
 *
 * - JwtModule + JwtStrategy + JwtAuthGuard → user identity (session)
 * - ClientRegistryService + ClientAuthGuard → machine identity (allowed clients)
 * - Global เพราะ JwtAuthGuard ติด global ใน app.module.ts
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
          // default expiresIn — AuthService override อยู่แล้วทุกครั้ง
          expiresIn: (config.get<string>('SESSION_EXPIRES_IN') ?? '8h') as
            | `${number}${'s' | 'm' | 'h' | 'd'}`
            | number,
        },
      }),
    }),
  ],
  providers: [
    JwtStrategy,
    JwtAuthGuard,
    ClientRegistryService,
    ClientAuthGuard,
  ],
  exports: [
    JwtModule,
    PassportModule,
    JwtAuthGuard,
    ClientRegistryService,
    ClientAuthGuard,
  ],
})
export class AuthModule {}
