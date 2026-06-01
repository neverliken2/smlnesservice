/* eslint-disable no-console */
/**
 * Generate API key + bcrypt hash สำหรับ sml_api_clients
 *
 * Run: npx ts-node scripts/generate-api-key.ts
 *      หรือ npm run gen:apikey
 *
 * Output:
 *   - RAW key (ให้ client ใช้ใน X-API-Key header — บันทึกที่ปลอดภัย)
 *   - HASH (paste เป็นค่า api_key_hash ใน INSERT)
 */

import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 12;

async function main() {
  // 32 bytes → 64 hex chars (เพียงพอต่อ entropy)
  const raw = randomBytes(32).toString('hex');
  const hash = await bcrypt.hash(raw, BCRYPT_ROUNDS);

  console.log('--- API Key (เก็บที่ปลอดภัย — ส่งให้ client) ---');
  console.log(raw);
  console.log('');
  console.log('--- bcrypt hash (paste ใน INSERT sml_api_clients.api_key_hash) ---');
  console.log(hash);
  console.log('');
  console.log('--- ตัวอย่าง SQL ---');
  console.log(
    `INSERT INTO sml_api_clients (client_code, client_name, api_key_hash, note)`,
  );
  console.log(
    `VALUES ('CHANGE-ME', 'CHANGE-ME', '${hash}', 'generated ${new Date().toISOString()}');`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
