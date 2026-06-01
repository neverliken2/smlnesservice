import { randomBytes } from 'node:crypto';

/**
 * Generate guid_code ตาม format ของ SML desktop:
 *   SMLWebService.RandomGUID@<8-hex>
 *
 * ความยาว = 25 + 8 = 33 chars (พอดี varchar(35) ของ sml_guid.guid_code)
 *
 * ใช้ randomBytes(4) → 8 hex chars (entropy 32 bits ≈ 4.3B combinations)
 * เหลือเฟือสำหรับ session id ที่มี TTL 8 ชม. + ผูกกับ user_code/database_code
 */
export function generateGuidCode(): string {
  const hex = randomBytes(4).toString('hex');
  return `SMLWebService.RandomGUID@${hex}`;
}
