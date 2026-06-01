import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload, JwtTokenType } from '../../core/auth/jwt.types';
import { SmlGuidRepository } from '../../core/auth/sml-guid.repository';
import { generateGuidCode } from '../../core/auth/sml-guid.util';
import { ErrorCode } from '../../core/error/error-codes';
import { AuthRepository } from './auth.repository';
import { parseDurationSeconds } from './duration.util';
import type {
  DatabaseInfo,
  LoginResponse,
  LogoutResponse,
  SessionTokenResponse,
  UserInfo,
} from './dto/login-response.dto';

const DEFAULT_DATA_GROUP = 'SML';
const DEFAULT_PRE_SELECT_TTL = '2m';
const DEFAULT_SESSION_TTL_HOURS = 8;
const COMPUTER_NAME = 'smlnesservice';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly repo: AuthRepository,
    private readonly guidRepo: SmlGuidRepository,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Step 1 — verify password + return list of allowed databases + pre-select JWT
   * pre-select JWT ใช้กับ /auth/select-database step ต่อไปเท่านั้น
   */
  async login(
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

    // ป้องกัน user enumeration — ตอบ message เดียวกันทั้ง user ไม่พบ + password ผิด
    if (!user || user.user_password !== password) {
      throw new UnauthorizedException({
        code: ErrorCode.INVALID_CREDENTIALS,
        message: 'username หรือ password ไม่ถูกต้อง',
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
   * Step 2 — INSERT row ใน sml_guid + return guid_code (= session key)
   */
  async selectDatabase(
    provider: string,
    userCode: string,
    _userLevel: number,
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

    const guidCode = generateGuidCode();
    try {
      await this.guidRepo.insert(provider, {
        guidCode,
        userCode,
        databaseCode: dbRow.data_database_name,
        computerName: COMPUTER_NAME,
      });
    } catch (err) {
      this.mapDbError(err, provider);
      throw err;
    }

    return {
      guidCode,
      sessionTtlHours: this.sessionTtlHours(),
      user: { userCode, userName: '', userLevel: _userLevel },
      database: {
        dataCode: dbRow.data_code,
        databaseName: dbRow.data_database_name,
        dataName: dbRow.data_name,
      },
    };
  }

  /**
   * Logout — DELETE row ใน sml_guid
   * Return success even if row หายไปแล้ว (idempotent)
   */
  async logout(provider: string, guidCode: string): Promise<LogoutResponse> {
    let rowCount = 0;
    try {
      rowCount = await this.guidRepo.delete(provider, guidCode);
    } catch (err) {
      const dbErr = err as { code?: string };
      if (dbErr.code !== '3D000' && dbErr.code !== '42P01') throw err;
    }
    return { deleted: rowCount > 0 };
  }

  private sessionTtlHours(): number {
    const raw = this.config.get<string>('SESSION_TTL_HOURS');
    const parsed = raw ? parseInt(raw, 10) : NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_SESSION_TTL_HOURS;
    }
    return parsed;
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
        message: `Auth DB ของ provider "${provider}" ไม่มีตาราง sml_user_list หรือ sml_guid`,
      });
    }
  }
}
