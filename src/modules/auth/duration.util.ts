/**
 * Parse expires-in string ("2m", "30m", "1h", "1d", "45s") เป็นวินาที
 * รองรับเฉพาะ unit s/m/h/d เพราะ JwtModule ก็ใช้แบบเดียวกัน
 */
export function parseDurationSeconds(value: string): number {
  const m = /^(\d+)\s*([smhd])$/.exec(value.trim());
  if (!m) {
    throw new Error(
      `Invalid duration "${value}" — รองรับเฉพาะรูปแบบเช่น "30m", "1h", "120s", "1d"`,
    );
  }
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const mult =
    unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
  return n * mult;
}
