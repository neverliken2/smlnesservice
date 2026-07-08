import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConnectionRegistryService } from './connection-registry.service';

/**
 * Unit tests — ConnectionRegistryService
 * ครอบ 3 เรื่องหลักตาม multi-connection-plan.md:
 *   1. file mode: parse ถูก + default values + provider ซ้ำ → fail fast
 *   2. env fallback: provider ที่ไม่อยู่ในไฟล์วิ่ง DB_HOST เดิม
 *   3. authDbName ใช้ dbNamePrefix per-connection
 */

const ENV_KEYS = [
  'CONNECTIONS_FILE',
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_SSL',
  'DB_SSL_REJECT_UNAUTHORIZED',
  'DB_POOL_MAX',
  'DB_NAME_PREFIX',
];

describe('ConnectionRegistryService', () => {
  let tempDir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'conn-registry-'));
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  function writeConnections(content: unknown): string {
    const file = join(tempDir, 'connections.json');
    writeFileSync(
      file,
      typeof content === 'string' ? content : JSON.stringify(content),
      'utf-8',
    );
    return file;
  }

  function initService(): ConnectionRegistryService {
    const svc = new ConnectionRegistryService();
    svc.onModuleInit();
    return svc;
  }

  const kunggEntry = {
    provider: 'kungg',
    host: 'kungg-pg.example.com',
    user: 'svc',
    password: 'secret',
    ssl: true,
  };

  describe('file mode', () => {
    it('resolves provider from file with defaults applied', () => {
      process.env.CONNECTIONS_FILE = writeConnections({
        connections: [kunggEntry],
      });
      const svc = initService();

      const conn = svc.resolve('kungg');
      expect(conn.host).toBe('kungg-pg.example.com');
      expect(conn.port).toBe(5432); // default
      expect(conn.ssl).toBe(true);
      expect(conn.sslRejectUnauthorized).toBe(true); // default
      expect(conn.poolMax).toBe(20); // default
      expect(conn.dbNamePrefix).toBe('smlerpmain'); // default
      expect(conn.source).toBe('file');
    });

    it('matches provider case-insensitively', () => {
      process.env.CONNECTIONS_FILE = writeConnections({
        connections: [{ ...kunggEntry, provider: 'KUNGG' }],
      });
      const svc = initService();
      expect(svc.resolve('kungg').source).toBe('file');
      expect(svc.resolve('KungG').source).toBe('file');
    });

    it('fails fast on duplicate provider (case-insensitive)', () => {
      process.env.CONNECTIONS_FILE = writeConnections({
        connections: [kunggEntry, { ...kunggEntry, provider: 'KUNGG' }],
      });
      expect(() => initService()).toThrow(/duplicate provider/);
    });

    it('fails fast on invalid JSON', () => {
      process.env.CONNECTIONS_FILE = writeConnections('{not-json');
      expect(() => initService()).toThrow(/invalid JSON/);
    });

    it('fails fast on schema violation', () => {
      process.env.CONNECTIONS_FILE = writeConnections({
        connections: [{ provider: 'kungg' }], // ขาด host/user/password
      });
      expect(() => initService()).toThrow(/schema invalid/);
    });

    it('fails fast when CONNECTIONS_FILE points to missing file', () => {
      process.env.CONNECTIONS_FILE = join(tempDir, 'no-such-file.json');
      expect(() => initService()).toThrow(/not readable/);
    });

    it('lists providers declared in file', () => {
      process.env.CONNECTIONS_FILE = writeConnections({
        connections: [kunggEntry, { ...kunggEntry, provider: 'next' }],
      });
      const svc = initService();
      expect(svc.listFileProviders().sort()).toEqual(['kungg', 'next']);
    });
  });

  describe('env fallback', () => {
    it('resolves unknown provider from DB_HOST env (backward compat)', () => {
      process.env.DB_HOST = 'legacy-host';
      process.env.DB_USER = 'postgres';
      process.env.DB_PASSWORD = 'pw';
      process.env.DB_POOL_MAX = '7';
      const svc = initService();

      const conn = svc.resolve('demo');
      expect(conn.host).toBe('legacy-host');
      expect(conn.poolMax).toBe(7);
      expect(conn.ssl).toBe(false);
      expect(conn.source).toBe('env');
    });

    it('file entry wins over env fallback for the same provider', () => {
      process.env.DB_HOST = 'legacy-host';
      process.env.CONNECTIONS_FILE = writeConnections({
        connections: [kunggEntry],
      });
      const svc = initService();
      expect(svc.resolve('kungg').host).toBe('kungg-pg.example.com');
      expect(svc.resolve('other').host).toBe('legacy-host');
    });

    it('throws clear error when provider unknown and no DB_HOST', () => {
      process.env.CONNECTIONS_FILE = writeConnections({
        connections: [kunggEntry],
      });
      const svc = initService();
      expect(() => svc.resolve('ghost')).toThrow(/No connection config/);
    });
  });

  describe('authDbName', () => {
    it('uses per-connection dbNamePrefix from file', () => {
      process.env.CONNECTIONS_FILE = writeConnections({
        connections: [{ ...kunggEntry, dbNamePrefix: 'smlmain' }],
      });
      const svc = initService();
      expect(svc.authDbName('KUNGG')).toBe('smlmainkungg');
    });

    it('uses env DB_NAME_PREFIX for fallback provider', () => {
      process.env.DB_HOST = 'legacy-host';
      process.env.DB_NAME_PREFIX = 'smlerpmain';
      const svc = initService();
      expect(svc.authDbName('demo')).toBe('smlerpmaindemo');
    });
  });
});
