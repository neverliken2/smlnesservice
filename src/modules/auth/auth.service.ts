import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload, JwtTokenType } from '../../core/auth/jwt.types';
import { ErrorCode } from '../../core/error/error-codes';
import { AuthRepository } from './auth.repository';
import { CnPermissionService } from './cn-permission.service';
import { StockAdjustPermissionService } from './stock-adjust-permission.service';
import { parseDurationSeconds } from './duration.util';
import type {
  DatabaseInfo,
  LoginResponse,
  SessionTokenResponse,
  UserInfo,
} from './dto/login-response.dto';

const DEFAULT_DATA_GROUP = 'SML';
const DEFAULT_PRE_SELECT_TTL = '2m';
const DEFAULT_SESSION_TTL = '8h';

const CLIENT_CN_COUPON = 'nextstep-cn-coupon';
const CLIENT_STOCK_ADJUST = 'nextstep-stock-adjust';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly repo: AuthRepository,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly cnPermission: CnPermissionService,
    private readonly stockAdjustPermission: StockAdjustPermissionService,
  ) {}

  /**
   * Step 1 — verify user/password + return databases + pre-select JWT (อายุสั้น)
   * clientCode มาจาก ClientAuthGuard
   */
  async login(
    clientCode: string,
    provider: string,
    username: string,
    password: string,
    dataGroup: string | undefined,
  ): Promise<LoginResponse> {
    let user;
    try {
      user = await this.repo.findUserByCode(provider, username);
    } catch (err) {
      this.mapDbError(err, provider);
      throw err;
    }

    if (!user || user.user_password !== password) {
      throw new UnauthorizedException({
        code: ErrorCode.INVALID_CREDENTIALS,
        message: 'username หรือ password ไม่ถูกต้อง',
      });
    }

    // Permission gate — เช็คสิทธิ์เมนูตาม clientCode ที่ login มา
    // ต้อง isRead AND isAdd ถึงผ่าน (mirror logic จาก _isAccessMenuPermision)
    //   nextstep-cn-coupon    → menu_so_credit_note
    //   nextstep-stock-adjust → menu_ic_stk_adjust
    //   client อื่น (ไม่รู้จัก) → reject ตาม strict policy
    let permAllowed = false;
    let permReason = 'unknown-client';
    let permIsRead = false;
    let permIsAdd = false;

    if (clientCode === CLIENT_CN_COUPON) {
      const perm = await this.cnPermission.checkCreditNoteAccess(
        provider,
        user.user_code,
      );
      permAllowed = perm.allowed;
      permReason = perm.reason;
      permIsRead = perm.isRead;
      permIsAdd = perm.isAdd;
    } else if (clientCode === CLIENT_STOCK_ADJUST) {
      const perm = await this.stockAdjustPermission.checkStockAdjustAccess(
        provider,
        user.user_code,
      );
      permAllowed = perm.allowed;
      permReason = perm.reason;
      permIsRead = perm.isRead;
      permIsAdd = perm.isAdd;
    }

    if (!permAllowed) {
      this.logger.warn(
        `Permission denied for ${user.user_code} @ ${provider} via clientCode=${clientCode} — reason=${permReason}, isRead=${permIsRead}, isAdd=${permIsAdd}`,
      );
      throw new ForbiddenException({
        code: ErrorCode.NO_PERMISSION,
        message: 'ไม่มีสิทธิ์เข้าใช้งานระบบ',
      });
    }

    const effectiveGroup = dataGroup ?? DEFAULT_DATA_GROUP;
    const dbRows = await this.repo.listDatabasesForUser(
      provider,
      user.user_code,
      effectiveGroup,
    );
    const databases: DatabaseInfo[] = dbRows.map((r) => ({
      dataCode: r.data_code,
      databaseName: r.data_database_name,
      dataName: r.data_name,
    }));

    const userInfo: UserInfo = {
      userCode: user.user_code,
      userName: user.user_name,
      userLevel: user.user_level ?? 0,
    };

    const preSelectTtl =
      this.config.get<string>('PRE_SELECT_EXPIRES_IN') ??
      DEFAULT_PRE_SELECT_TTL;

    const preSelectToken = await this.signToken(
      {
        sub: user.user_code,
        provider,
        tokenType: 'pre-select',
        clientCode,
        userLevel: user.user_level ?? 0,
      },
      preSelectTtl,
    );

    return {
      preSelectToken,
      preSelectExpiresIn: parseDurationSeconds(preSelectTtl),
      user: userInfo,
      databases,
    };
  }

  /**
   * Step 2 — sign session JWT (อายุ 8h) บรรจุ database
   */
  async selectDatabase(
    clientCode: string,
    provider: string,
    userCode: string,
    userLevel: number,
    dataCode: string,
  ): Promise<SessionTokenResponse> {
    let dbRow;
    try {
      dbRow = await this.repo.findDatabaseByCode(provider, userCode, dataCode);
    } catch (err) {
      this.mapDbError(err, provider);
      throw err;
    }
    if (!dbRow) {
      throw new UnauthorizedException({
        code: ErrorCode.DATABASE_NOT_FOUND,
        message: 'ไม่พบ data DB ที่ระบุ หรือไม่มีสิทธิ์เข้าถึง',
      });
    }

    const sessionTtl =
      this.config.get<string>('SESSION_EXPIRES_IN') ?? DEFAULT_SESSION_TTL;

    const accessToken = await this.signToken(
      {
        sub: userCode,
        provider,
        tokenType: 'session',
        clientCode,
        database: dbRow.data_database_name,
        userLevel,
      },
      sessionTtl,
    );

    return {
      accessToken,
      expiresIn: parseDurationSeconds(sessionTtl),
      user: { userCode, userName: '', userLevel },
      database: {
        dataCode: dbRow.data_code,
        databaseName: dbRow.data_database_name,
        dataName: dbRow.data_name,
      },
    };
  }

  private signToken(
    payload: Omit<JwtPayload, 'iat' | 'exp'> & { tokenType: JwtTokenType },
    expiresIn: string,
  ): Promise<string> {
    return this.jwt.signAsync(payload, {
      expiresIn: expiresIn as `${number}${'s' | 'm' | 'h' | 'd'}`,
    });
  }

  private mapDbError(err: unknown, provider: string): void {
    const dbErr = err as { code?: string };
    if (dbErr.code === '3D000') {
      throw new BadRequestException({
        code: ErrorCode.PROVIDER_NOT_FOUND,
        message: `ไม่พบ provider "${provider}"`,
      });
    }
    if (dbErr.code === '42P01') {
      throw new BadRequestException({
        code: ErrorCode.PROVIDER_NOT_FOUND,
        message: `Auth DB ของ provider "${provider}" ไม่มีตารางที่ต้องการ`,
      });
    }
  }
}
