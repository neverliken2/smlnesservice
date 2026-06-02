import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';

/**
 * Client registry — รักษา list ของ client ที่ allowed
 *
 * Source: env `ALLOWED_CLIENTS_JSON`
 * Format: '[{"clientCode":"nextstep-cn-coupon","tokenHash":"$2b$12$..."}]'
 *
 * Generate tokenHash:
 *   const bcrypt = require('bcrypt');
 *   const raw = require('crypto').randomBytes(32).toString('hex');
 *   bcrypt.hashSync(raw, 12);
 *
 * เก็บ raw token ที่ฝั่ง client (env ของ NextStep) — ส่งใน Authorization Bearer ตอน login
 */

interface ClientEntry {
  clientCode: string;
  tokenHash: string;
}

interface VerifyCacheEntry {
  clientCode: string;
  expiresAt: number;
}

const VERIFY_CACHE_TTL_MS = 5 * 60 * 1000;
const CLIENT_CODE_PATTERN = /^[a-zA-Z0-9_-]{1,50}$/;

@Injectable()
export class ClientRegistryService implements OnModuleInit {
  private readonly logger = new Logger(ClientRegistryService.name);
  private clients: ClientEntry[] = [];
  private allowedCodes = new Set<string>();
  private readonly verifyCache = new Map<string, VerifyCacheEntry>();

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.loadFromEnv();
  }

  /**
   * Verify raw client token → return clientCode ถ้า match, null ถ้าไม่
   * Cache 5 นาทีต่อ token เพื่อกัน bcrypt cost ทุก request
   */
  async verifyToken(rawToken: string): Promise<string | null> {
    if (!rawToken) return null;

    const cacheKey = this.shortHash(rawToken);
    const cached = this.verifyCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.clientCode;
    }

    for (const client of this.clients) {
      if (await bcrypt.compare(rawToken, client.tokenHash)) {
        this.verifyCache.set(cacheKey, {
          clientCode: client.clientCode,
          expiresAt: Date.now() + VERIFY_CACHE_TTL_MS,
        });
        return client.clientCode;
      }
    }
    return null;
  }

  /**
   * เช็คว่า clientCode (จาก JWT payload) ยังอยู่ใน registry
   * ใช้กัน JWT เก่า ที่ออกตอน client ยัง allow → admin rotate → JWT เก่ายัง valid signature
   * แต่ clientCode ไม่อยู่แล้ว → reject
   */
  isClientAllowed(clientCode: string): boolean {
    return this.allowedCodes.has(clientCode);
  }

  private loadFromEnv(): void {
    const raw = this.config.get<string>('ALLOWED_CLIENTS_JSON');
    if (!raw || raw.trim() === '') {
      this.logger.warn(
        'ALLOWED_CLIENTS_JSON ว่าง — ไม่มี client ที่อนุญาตให้ login (service จะ 401 ทุก /auth/login)',
      );
      this.clients = [];
      this.allowedCodes = new Set();
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `ALLOWED_CLIENTS_JSON ต้องเป็น valid JSON — ${(err as Error).message}`,
      );
    }
    if (!Array.isArray(parsed)) {
      throw new Error('ALLOWED_CLIENTS_JSON ต้องเป็น array');
    }

    const valid: ClientEntry[] = [];
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue;
      const obj = entry as Record<string, unknown>;
      const clientCode = obj.clientCode;
      const tokenHash = obj.tokenHash;
      if (typeof clientCode !== 'string' || typeof tokenHash !== 'string') {
        throw new Error(
          'ALLOWED_CLIENTS_JSON: แต่ละ entry ต้องมี clientCode + tokenHash เป็น string',
        );
      }
      if (!CLIENT_CODE_PATTERN.test(clientCode)) {
        throw new Error(
          `ALLOWED_CLIENTS_JSON: clientCode "${clientCode}" format ไม่ถูกต้อง (alphanumeric/dash/underscore, max 50)`,
        );
      }
      if (!tokenHash.startsWith('$2')) {
        throw new Error(
          `ALLOWED_CLIENTS_JSON: tokenHash ของ ${clientCode} ต้องเป็น bcrypt hash (ขึ้นต้น $2)`,
        );
      }
      valid.push({ clientCode, tokenHash });
    }

    this.clients = valid;
    this.allowedCodes = new Set(valid.map((c) => c.clientCode));
    this.logger.log(
      `Loaded ${valid.length} allowed client(s): ${valid.map((c) => c.clientCode).join(', ') || '(none)'}`,
    );
  }

  private shortHash(input: string): string {
    return createHash('sha256').update(input).digest('hex').slice(0, 32);
  }
}
