import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { Tenant } from '../../core/tenant/tenant.decorator';
import type { TenantContext } from '../../core/tenant/tenant.types';
import { ErrorCode } from '../../core/error/error-codes';
import { AuthService } from './auth.service';
import { LoginSchema, SelectDatabaseSchema } from './dto/login.dto';
import type {
  LoginResponse,
  SessionTokenResponse,
} from './dto/login-response.dto';
import { PreSelectAuthGuard } from './pre-select.guard';

@ApiTags('auth')
@ApiSecurity('apiKey')
@ApiSecurity('provider')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * POST /api/v1/auth/login
   * Headers: X-API-Key, X-Provider
   * Body: { username, password, dataGroup? }
   *
   * → { preSelectToken, preSelectExpiresIn, user, databases }
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login ด้วย username/password',
    description:
      'Step 1 ของ 2-step login. หาก user ตรง → ออก pre-select token (อายุสั้น) + list databases',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['username', 'password'],
      properties: {
        username: { type: 'string', example: 'admin' },
        password: { type: 'string', example: 'admin' },
        dataGroup: {
          type: 'string',
          example: 'SML',
          description: 'default = SML',
        },
      },
    },
  })
  async login(
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<LoginResponse> {
    const parsed = this.parse(LoginSchema, body);
    const provider = req.tenantProvider;
    if (!provider) {
      // ApiKeyGuard ควรการันตี populate แล้ว — guard fail safe
      throw new BadRequestException({
        code: ErrorCode.PROVIDER_NOT_FOUND,
        message: 'X-Provider header จำเป็น',
      });
    }
    return this.auth.login(
      provider,
      parsed.username,
      parsed.password,
      parsed.dataGroup,
    );
  }

  /**
   * POST /api/v1/auth/select-database
   * Headers: X-API-Key, X-Provider, Authorization: Bearer <preSelectToken>
   * Body: { dataCode }
   *
   * → { accessToken, expiresIn, user, database }
   */
  @Post('select-database')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PreSelectAuthGuard)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'เลือก data DB ที่จะใช้งาน',
    description:
      'Step 2 ของ login. ส่ง pre-select token (Authorization Bearer) + dataCode → ออก session token',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['dataCode'],
      properties: { dataCode: { type: 'string', example: 'DEMO' } },
    },
  })
  async selectDatabase(
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<SessionTokenResponse> {
    const parsed = this.parse(SelectDatabaseSchema, body);
    const ctx = req.preSelect!;
    return this.auth.selectDatabase(
      ctx.provider,
      ctx.userCode,
      ctx.userLevel,
      parsed.dataCode,
    );
  }

  /**
   * POST /api/v1/auth/refresh
   * Headers: X-API-Key, X-Provider, Authorization: Bearer <accessToken>
   *
   * → { accessToken, expiresIn, user, database } — payload เหมือนเดิม, exp ใหม่
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'ต่ออายุ session token',
    description: 'รับ session token ที่ยังไม่หมดอายุ → ออกใบใหม่ (sliding TTL)',
  })
  async refresh(
    @Tenant() tenant: TenantContext,
  ): Promise<SessionTokenResponse> {
    return this.auth.refresh(
      tenant.provider,
      tenant.userCode,
      tenant.userLevel,
      tenant.database,
    );
  }

  private parse<T>(
    schema: {
      safeParse: (v: unknown) => {
        success: boolean;
        data?: T;
        error?: unknown;
      };
    },
    value: unknown,
  ): T {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        details: result.error,
      });
    }
    return result.data as T;
  }
}
