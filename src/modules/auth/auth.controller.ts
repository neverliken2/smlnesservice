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
import { ApiBody, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../core/auth/public.decorator';
import { Tenant } from '../../core/tenant/tenant.decorator';
import type { TenantContext } from '../../core/tenant/tenant.types';
import { ErrorCode } from '../../core/error/error-codes';
import { AuthService } from './auth.service';
import { LoginSchema, SelectDatabaseSchema } from './dto/login.dto';
import type {
  LoginResponse,
  LogoutResponse,
  SessionTokenResponse,
} from './dto/login-response.dto';
import { PreSelectAuthGuard } from './pre-select.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * POST /api/v1/auth/login   (Public)
   * Body: {provider, username, password, dataGroup?}
   *
   * → {preSelectToken, preSelectExpiresIn, user, databases}
   */
  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login ด้วย username/password',
    description:
      'Step 1 ของ 2-step login. ออก pre-select JWT (อายุ 2m) + list databases',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['provider', 'username', 'password'],
      properties: {
        provider: { type: 'string', example: 'demo' },
        username: { type: 'string', example: 'DEMO1' },
        password: { type: 'string', example: '111' },
        dataGroup: {
          type: 'string',
          example: 'SML',
          description: 'default = SML',
        },
      },
    },
  })
  async login(@Body() body: unknown): Promise<LoginResponse> {
    const parsed = this.parse(LoginSchema, body);
    return this.auth.login(
      parsed.provider.toLowerCase(),
      parsed.username,
      parsed.password,
      parsed.dataGroup,
    );
  }

  /**
   * POST /api/v1/auth/select-database
   * Headers: Authorization: Bearer <preSelectToken>
   * Body: {dataCode}
   *
   * → {guidCode, sessionTtlHours, user, database}
   * guidCode ใช้ต่อใน Authorization: SmlGuid <provider>:<guidCode>
   */
  @Post('select-database')
  @Public()
  @UseGuards(PreSelectAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'เลือก data DB → ออก session (guid_code)',
    description:
      'Step 2. INSERT sml_guid + return guidCode สำหรับใช้กับ endpoint ทั่วไป',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['dataCode'],
      properties: { dataCode: { type: 'string', example: 'WHOLESALE' } },
    },
  })
  async selectDatabase(
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<SessionTokenResponse> {
    const parsed = this.parse(SelectDatabaseSchema, body);
    const ctx = req.preSelect;
    if (!ctx) {
      throw new BadRequestException({
        code: ErrorCode.UNAUTHORIZED,
        message: 'pre-select context missing',
      });
    }
    return this.auth.selectDatabase(
      ctx.provider,
      ctx.userCode,
      ctx.userLevel,
      parsed.dataCode,
    );
  }

  /**
   * POST /api/v1/auth/logout
   * Headers: Authorization: SmlGuid <provider>:<guidCode>
   *
   * → DELETE row จาก sml_guid
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('smlGuid')
  @ApiOperation({ summary: 'Logout — ลบ sml_guid row' })
  async logout(
    @Req() req: Request,
    @Tenant() tenant: TenantContext,
  ): Promise<LogoutResponse> {
    const guidCode = req.guidCode;
    if (!guidCode) {
      throw new BadRequestException({
        code: ErrorCode.UNAUTHORIZED,
        message: 'session context missing',
      });
    }
    return this.auth.logout(tenant.provider, guidCode);
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
