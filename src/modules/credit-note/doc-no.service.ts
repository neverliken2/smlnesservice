import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ErrorCode } from '../../core/error/error-codes';
import { CreditNoteRepository } from './credit-note.repository';

const CN_FORMAT_CODE = 'CN';

/**
 * Generate next CN document number based on erp_doc_format.format pattern.
 *
 * Format tokens (mirrors SMLERP22):
 *   @     = doc_format.code (prefix, e.g. "CN")
 *   YY    = year ค.ศ. 2-digit last
 *   YYYY  = year ค.ศ. 4-digit
 *   MM    = month 2-digit
 *   DD    = day 2-digit
 *   #...# = running, zero-padded to #-count digits
 *   anything else = literal (เช่น "-")
 *
 * Running counter resets per (prefix + period) — derived from MAX(doc_no)
 * ของ trans_flag=48 ที่ match prefix pattern เดือนเดียวกัน
 */
@Injectable()
export class DocNoService {
  constructor(private readonly repo: CreditNoteRepository) {}

  async getNextDocNo(
    database: string,
    formatCode: string | undefined,
    docDate: string,
  ): Promise<{ doc_no: string }> {
    const code = (formatCode || CN_FORMAT_CODE).trim();
    if (!code) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'formatCode ว่าง',
      });
    }

    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(docDate || '');
    if (!dateMatch) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)',
      });
    }
    const [, yyyy, mm, dd] = dateMatch;
    const yy = yyyy.slice(-2);

    const fmt = await this.repo.findDocFormat(database, code);
    if (!fmt) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: `ไม่พบ doc_format "${code}"`,
      });
    }
    const format = fmt.format || '';
    if (!format) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'format ของ doc_format ว่าง',
      });
    }

    // Parse format → prefix (literal) + digit count
    const runMatch = /(#+)/.exec(format);
    if (!runMatch) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_ERROR,
        message: `format "${format}" ไม่มี # สำหรับ running`,
      });
    }
    const digitCount = runMatch[1].length;
    const beforeRun = format.slice(0, runMatch.index);
    const afterRun = format.slice(runMatch.index + digitCount);

    const expand = (tpl: string) =>
      tpl
        .replace(/@/g, code)
        .replace(/YYYY/g, yyyy)
        .replace(/YY/g, yy)
        .replace(/MM/g, mm)
        .replace(/DD/g, dd);

    const prefix = expand(beforeRun);
    const suffix = expand(afterRun);

    // Build regex pattern สำหรับ Postgres ~ operator
    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pgPattern = `^${escapeRegex(prefix)}[0-9]{${digitCount}}${escapeRegex(suffix)}$`;

    const last = await this.repo.findLastDocNo(database, code, pgPattern);

    let nextRunning = 1;
    if (last) {
      const digits = last.doc_no.slice(
        prefix.length,
        prefix.length + digitCount,
      );
      const parsed = parseInt(digits, 10);
      if (!Number.isNaN(parsed)) {
        nextRunning = parsed + 1;
      }
    }

    const doc_no =
      prefix + String(nextRunning).padStart(digitCount, '0') + suffix;
    return { doc_no };
  }
}
