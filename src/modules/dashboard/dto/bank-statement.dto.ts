import { z } from 'zod';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const BankStatementQuerySchema = z.object({
  fromDate: z.string().regex(ISO_DATE).optional(),
  toDate: z.string().regex(ISO_DATE).optional(),
  bankCode: z.string().max(50).optional(),
  bookNo: z.string().max(50).optional(),
  transactionType: z.enum(['all', 'deposit', 'withdraw']).default('all'),
});
export type BankStatementQuery = z.infer<typeof BankStatementQuerySchema>;

export interface BankBalance {
  book_no: string;
  amount_balance: number;
}

export interface BankTransaction {
  doc_sort: number;
  book_no: string;
  doc_date: string;
  doc_time: string;
  doc_no: string;
  remark: string;
  amount_in: number;
  amount_out: number;
  amount_balance: number;
  doc_type: number;
  remark1: string;
}

export interface BankStatementSummary {
  openingBalance: number;
  totalIn: number;
  totalOut: number;
  netAmount: number;
  transactionCount: number;
  depositCount: number;
  withdrawCount: number;
}

export interface BankStatementResponse {
  openingBalances: BankBalance[];
  transactions: BankTransaction[];
  summary: BankStatementSummary;
}

// ──────────────────────────── Bank Books ────────────────────────────

export interface BankBookEntry {
  code: string;
  name: string;
  book_number: string;
  bank_code: string;
  bank_name: string;
  branch_code: string;
  branch_name: string;
}

export interface BankRef {
  code: string;
  name: string;
}

export interface BankBranchRef {
  code: string;
  name: string;
  bank_code: string;
}

export interface BankBooksResponse {
  books: BankBookEntry[];
  banks: BankRef[];
  branches: BankBranchRef[];
}
