import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload, JwtTokenType } from '../../core/auth/jwt.types';
import { ErrorCode } from '../../core/error/error-codes';
import { AuthRepository } from './auth.repository';
import { parseDurationSeconds } from './duration.util';
import type {
  DatabaseInfo,
  LoginResponse,
  SessionTokenResponse,
  UserInfo,
} from './dto/login-response.dto';

const DEFAULT_DATA_GROUP = 'SML';
const DEFAULT_SESSION_TTL = '30m';
const DEFAULT_PRE_SELECT_TTL = '2m';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly repo: AuthRepository,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

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

  async selectDatabase(
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

    return this.issueSession(
      provider,
      userCode,
      userLevel,
      dbRow.data_database_name,
      {
        dataCode: dbRow.data_code,
        databaseName: dbRow.data_database_name,
        dataName: dbRow.data_name,
      },
    );
  }

  /**
   * Refresh session token — รับ session token เดิม (ยังไม่ expire) → ออกใบใหม่
   * เนื้อหา payload คงเดิม (provider, userCode, userLevel, database)
   * ต้อง verify ว่า DB ยังมีอยู่จริงเพื่อกัน race กับการลบสิทธิ์
   */
  async refresh(
    provider: string,
    userCode: string,
    userLevel: number,
    databaseName: string,
  ): Promise<SessionTokenResponse> {
    // หา data_code reverse จาก database_name — query ทุก DB ของ user แล้ว filter
    const all = await this.repo.listDatabasesForUser(
      provider,
      userCode,
      DEFAULT_DATA_GROUP,
    );
    const match = all.find(
      (r) => r.data_database_name.toLowerCase() === databaseName.toLowerCase(),
    );
    if (!match) {
      throw new UnauthorizedException({
        code: ErrorCode.DATABASE_NOT_FOUND,
        message: 'สิทธิ์เข้าถึง DB ถูกเพิกถอน — login ใหม่',
      });
    }

    return this.issueSession(provider, userCode, userLevel, databaseName, {
      dataCode: match.data_code,
      databaseName: match.data_database_name,
      dataName: match.data_name,
    });
  }

  private async issueSession(
    provider: string,
    userCode: string,
    userLevel: number,
    databaseName: string,
    dbInfo: DatabaseInfo,
  ): Promise<SessionTokenResponse> {
    const ttl =
      this.config.get<string>('JWT_EXPIRES_IN') ?? DEFAULT_SESSION_TTL;
    const accessToken = await this.signToken(
      {
        sub: userCode,
        provider,
        tokenType: 'session',
        database: databaseName,
        userLevel,
      },
      ttl,
    );
    return {
      accessToken,
      expiresIn: parseDurationSeconds(ttl),
      user: { userCode, userName: '', userLevel },
      database: dbInfo,
    };
  }

  private signToken(
    payload: Omit<JwtPayload, 'iat' | 'exp'> & { tokenType: JwtTokenType },
    expiresIn: string,
  ): Promise<string> {
    // @nestjs/jwt expects ms-style template literal — cast เพราะค่ามาจาก env (string)
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
        message: `Auth DB ของ provider "${provider}" ไม่มีตาราง sml_user_list`,
      });
    }
  }
}
