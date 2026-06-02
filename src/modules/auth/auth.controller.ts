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
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ClientAuthGuard } from '../../core/auth/client-auth.guard';
import { Public } from '../../core/auth/public.decorator';
import { ErrorCode } from '../../core/error/error-codes';
import { AuthService } from './auth.service';
import { LoginSchema, SelectDatabaseSchema } from './dto/login.dto';
import type {
  LoginResponse,
  SessionTokenResponse,
} from './dto/login-response.dto';
import { PreSelectAuthGuard } from './pre-select.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * POST /api/v1/auth/login
   * Auth:  Authorization: Bearer <CLIENT_TOKEN>   (verify ผ่าน ClientAuthGuard)
   * Body:  {provider, username, password, dataGroup?}
   *
   * → {preSelectToken, preSelectExpiresIn, user, databases}
   */
  @Post('login')
  @Public()
  @UseGuards(ClientAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('clientToken')
  @ApiOperation({
    summary: 'Step 1 — verify user/password (ต้องผ่าน client token)',
    description:
      'Authorization Bearer = client token (เช่น token ของ NextStep CN Coupon, ' +
      'hash อยู่ใน env ALLOWED_CLIENTS_JSON). ออก pre-select JWT (2m) + databases list',
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
  async login(
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<LoginResponse> {
    const parsed = this.parse(LoginSchema, body);
    const clientCode = req.clientCode;
    if (!clientCode) {
      throw new BadRequestException({
        code: ErrorCode.INVALID_API_KEY,
        message: 'client context missing — guard ผิดพลาด',
      });
    }
    return this.auth.login(
      clientCode,
      parsed.provider.toLowerCase(),
      parsed.username,
      parsed.password,
      parsed.dataGroup,
    );
  }

  /**
   * POST /api/v1/auth/select-database
   * Auth:  Authorization: Bearer <preSelectJWT>   (verify ผ่าน PreSelectAuthGuard)
   * Body:  {dataCode}
   *
   * → {accessToken, expiresIn, user, database}
   * accessToken = session JWT (8h) บรรจุ database + clientCode
   */
  @Post('select-database')
  @Public()
  @UseGuards(PreSelectAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('preSelectJwt')
  @ApiOperation({
    summary: 'Step 2 — เลือก data DB → ออก session JWT 8h',
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
      ctx.clientCode,
      ctx.provider,
      ctx.userCode,
      ctx.userLevel,
      parsed.dataCode,
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
