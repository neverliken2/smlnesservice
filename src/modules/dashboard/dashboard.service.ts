import { Injectable, Logger } from '@nestjs/common';
import type { TenantContext } from '../../core/tenant/tenant.types';
import { DashboardRepository } from './dashboard.repository';
import type {
  SalesOverviewQuery,
  SalesOverviewResponse,
  SalesOverviewRow,
} from './dto/sales-overview.dto';
import type {
  StockBalanceQuery,
  StockBalanceResponse,
  StockBalanceRow,
} from './dto/stock-balance.dto';
import type { ProductTransactionsResponse } from './dto/product-transactions.dto';
import type {
  StockMovementQuery,
  StockMovementResponse,
  StockMovementRow,
} from './dto/stock-movement.dto';
import type {
  ReorderPointQuery,
  ReorderPointResponse,
} from './dto/reorder-point.dto';
import type {
  ProfitProductQuery,
  ProfitProductResponse,
} from './dto/profit-product.dto';
import type {
  DailySalesChartQuery,
  DailySalesChartPoint,
  DailySalesChartResponse,
} from './dto/daily-sales-chart.dto';
import type {
  BankStatementQuery,
  BankStatementResponse,
  BankBooksResponse,
  BankBookEntry,
} from './dto/bank-statement.dto';
import type {
  ArMovementQuery,
  ArMovementResponse,
} from './dto/ar-movement.dto';
import type {
  ReceivableOverdueQuery,
  ReceivableOverdueResponse,
} from './dto/receivable-overdue.dto';
import type { ArAgingQuery, ArAgingResponse } from './dto/ar-aging.dto';
import type {
  ApMovementQuery,
  ApMovementResponse,
} from './dto/ap-movement.dto';
import type {
  PayableOverdueQuery,
  PayableOverdueResponse,
} from './dto/payable-overdue.dto';
import type { ApAgingQuery, ApAgingResponse } from './dto/ap-aging.dto';

export interface PingResponse {
  module: 'dashboard';
  provider: string;
  database: string;
  userCode: string;
  userLevel: number;
  ts: string;
}

/**
 * Dashboard Service — business logic ของ read-only reports
 */
@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private readonly repo: DashboardRepository) {}

  // ──────────────────────────── Ping ────────────────────────────

  ping(tenant: TenantContext): PingResponse {
    this.logger.debug(
      `ping by ${tenant.userCode}@${tenant.provider}/${tenant.database}`,
    );
    return {
      module: 'dashboard',
      provider: tenant.provider,
      database: tenant.database,
      userCode: tenant.userCode,
      userLevel: tenant.userLevel,
      ts: new Date().toISOString(),
    };
  }

  // ──────────────────────────── Sales Overview ────────────────────────────

  async salesOverview(
    tenant: TenantContext,
    query: SalesOverviewQuery,
  ): Promise<SalesOverviewResponse> {
    const { fromDate, toDate } = this.resolveDateRange(query);

    const [credit, cash, ret] = await Promise.all([
      this.repo.getSalesAggregate(
        tenant,
        44,
        fromDate,
        toDate,
        query.branch,
        query.warehouse,
      ),
      this.repo.getSalesAggregate(
        tenant,
        46,
        fromDate,
        toDate,
        query.branch,
        query.warehouse,
      ),
      this.repo.getSalesAggregate(
        tenant,
        48,
        fromDate,
        toDate,
        query.branch,
        query.warehouse,
      ),
    ]);

    const creditSales = safeNumber(credit.total_sales);
    const creditCost = safeNumber(credit.total_cost);
    const creditProfit = creditSales - creditCost;
    const creditPP = pct(creditProfit, creditSales);

    const cashSales = safeNumber(cash.total_sales);
    const cashCost = safeNumber(cash.total_cost);
    const cashProfit = cashSales - cashCost;
    const cashPP = pct(cashProfit, cashSales);

    const returnSales = safeNumber(ret.total_sales);
    const returnCost = safeNumber(ret.total_cost);
    const returnProfit = returnSales - returnCost;

    const totalSales = creditSales + cashSales;
    const totalCost = creditCost + cashCost;
    const totalProfit = totalSales - totalCost;
    const totalPP = pct(totalProfit, totalSales);

    const grandSales = totalSales - returnSales;
    const grandCost = totalCost - returnCost;
    const grandProfit = grandSales - grandCost;
    const grandPP = pct(grandProfit, grandSales);

    const rows: SalesOverviewRow[] = [
      {
        type: 'ขายเชื่อ',
        isSubTotal: false,
        totalSales: creditSales,
        totalCost: creditCost,
        grossProfit: creditProfit,
        profitPercent: creditPP,
      },
      {
        type: 'ขายสด',
        isSubTotal: false,
        totalSales: cashSales,
        totalCost: cashCost,
        grossProfit: cashProfit,
        profitPercent: cashPP,
      },
      {
        type: 'รวมขาย',
        isSubTotal: true,
        totalSales: totalSales,
        totalCost: totalCost,
        grossProfit: totalProfit,
        profitPercent: totalPP,
      },
      {
        type: 'รับคืนเงินเชื่อ',
        isSubTotal: false,
        totalSales: -returnSales,
        totalCost: -returnCost,
        grossProfit: -returnProfit,
        profitPercent: 0,
      },
      {
        type: 'รวมรับคืน',
        isSubTotal: true,
        totalSales: -returnSales,
        totalCost: -returnCost,
        grossProfit: -returnProfit,
        profitPercent: 0,
      },
    ];

    return {
      rows,
      total: {
        type: 'รวมทั้งสิ้น',
        totalSales: grandSales,
        totalCost: grandCost,
        grossProfit: grandProfit,
        profitPercent: grandPP,
      },
      dateRange: { from: fromDate, to: toDate },
    };
  }

  private resolveDateRange(query: SalesOverviewQuery): {
    fromDate: string;
    toDate: string;
  } {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return {
      fromDate: query.startDate ?? `${yyyy}-01-01`,
      toDate: query.endDate ?? `${yyyy}-${mm}-${dd}`,
    };
  }

  // ──────────────────────────── Stock Balance ────────────────────────────

  async stockBalance(
    tenant: TenantContext,
    query: StockBalanceQuery,
  ): Promise<StockBalanceResponse> {
    const rawRows = await this.repo.getStockBalance(tenant, query);

    const rows: StockBalanceRow[] = rawRows.map((r) => {
      const qtyIn = safeNumber(r.qty_in);
      const amountIn = safeNumber(r.amount_in);
      const qtyOut = safeNumber(r.qty_out);
      const amountOut = safeNumber(r.amount_out);
      const balanceQty = safeNumber(r.balance_qty);
      const currentAvgCost = safeNumber(r.current_avg_cost);

      return {
        ic_code: r.ic_code,
        ic_name: r.ic_name,
        ic_unit_code: r.ic_unit_code,
        qty_in: qtyIn,
        amount_in: amountIn,
        avg_cost_in: qtyIn > 0 ? amountIn / qtyIn : 0,
        qty_out: qtyOut,
        amount_out: amountOut,
        avg_cost_out: qtyOut > 0 ? amountOut / qtyOut : 0,
        balance_qty: balanceQty,
        current_avg_cost: currentAvgCost,
        avg_cost: currentAvgCost,
        balance_amount: balanceQty * currentAvgCost,
      };
    });

    return { rows, count: rows.length };
  }

  // ──────────────────────────── Product Transactions ────────────────────────────

  async productTransactions(
    tenant: TenantContext,
    productCode: string,
  ): Promise<ProductTransactionsResponse> {
    const [latestPurchases, latestSales] = await Promise.all([
      this.repo.getLatestPurchases(tenant, productCode),
      this.repo.getLatestSales(tenant, productCode),
    ]);

    return { latestPurchases, latestSales };
  }

  // ──────────────────────────── Stock Movement ────────────────────────────

  async stockMovement(
    tenant: TenantContext,
    query: StockMovementQuery,
  ): Promise<StockMovementResponse> {
    const [dbRows, begin] = await Promise.all([
      this.repo.getStockMovementRows(
        tenant,
        query.productCode,
        query.fromDate,
        query.toDate,
      ),
      query.fromDate
        ? this.repo.getStockMovementBegin(
            tenant,
            query.productCode,
            query.fromDate,
          )
        : Promise.resolve({ begin_qty: 0, begin_amount: 0 }),
    ]);

    const beginningQty = safeNumber(begin.begin_qty);
    const beginningAmount = safeNumber(begin.begin_amount);

    let runningQty = beginningQty;
    let runningAmount = beginningAmount;

    const rows: StockMovementRow[] = [];

    if (query.fromDate && (beginningQty !== 0 || beginningAmount !== 0)) {
      rows.push({
        doc_date: query.fromDate,
        doc_time: '',
        trans_type: 'ยอดยกมา',
        doc_no: '-',
        warehouse: '',
        shelf_code: '',
        unit_code: '',
        qty_in: beginningQty > 0 ? beginningQty : 0,
        avg_cost_in: 0,
        amount_in: beginningAmount > 0 ? beginningAmount : 0,
        qty_out: beginningQty < 0 ? Math.abs(beginningQty) : 0,
        avg_cost_out: 0,
        amount_out: beginningAmount < 0 ? Math.abs(beginningAmount) : 0,
        running_balance: runningQty,
        running_amount: runningAmount,
      });
    }

    for (const r of dbRows) {
      const qtyIn = safeNumber(r.qty_in);
      const qtyOut = safeNumber(r.qty_out);
      const amountIn = safeNumber(r.amount_in);
      const amountOut = safeNumber(r.amount_out);

      runningQty += qtyIn - qtyOut;
      runningAmount += amountIn - amountOut;

      rows.push({
        doc_date: r.doc_date,
        doc_time: r.doc_time ? r.doc_time.substring(0, 5) : '',
        trans_type: getTransTypeName(r.trans_flag),
        doc_no: r.doc_no,
        warehouse: r.warehouse ?? '',
        shelf_code: r.shelf_code ?? '',
        unit_code: r.unit_code ?? '',
        qty_in: qtyIn,
        avg_cost_in: qtyIn > 0 ? amountIn / qtyIn : 0,
        amount_in: amountIn,
        qty_out: qtyOut,
        avg_cost_out: qtyOut > 0 ? amountOut / qtyOut : 0,
        amount_out: amountOut,
        running_balance: runningQty,
        running_amount: runningAmount,
      });
    }

    return { rows, count: rows.length };
  }

  // ──────────────────────────── Reorder Point ────────────────────────────

  async reorderPoint(
    tenant: TenantContext,
    query: ReorderPointQuery,
  ): Promise<ReorderPointResponse> {
    const rawRows = await this.repo.getReorderPoints(tenant, query);
    const rows = rawRows.map((r) => ({
      ic_code: r.ic_code,
      ic_name: r.ic_name,
      ic_unit_code: r.ic_unit_code,
      balance_qty: safeNumber(r.balance_qty),
      purchase_point: safeNumber(r.purchase_point),
      minimum_qty: safeNumber(r.minimum_qty),
      maximum_qty: safeNumber(r.maximum_qty),
      last_purchase_date: r.last_purchase_date,
      average_cost_end: safeNumber(r.average_cost_end),
      last_purchase_qty: safeNumber(r.last_purchase_qty),
      purchase_amount: safeNumber(r.purchase_amount),
      sale_amount: safeNumber(r.sale_amount),
      forecast_purchase: safeNumber(r.forecast_purchase),
    }));
    return { rows, count: rows.length };
  }

  // ──────────────────────────── Profit Product ────────────────────────────

  async profitProduct(
    tenant: TenantContext,
    query: ProfitProductQuery,
  ): Promise<ProfitProductResponse> {
    const { rows, totalRecords, totals } = await this.repo.getProfitProducts(
      tenant,
      query,
    );
    return {
      rows,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalRecords,
        totalPages: Math.ceil(totalRecords / query.pageSize),
      },
      totals: {
        qty_sale: safeNumber(totals.qty_sale),
        amount_sale: safeNumber(totals.amount_sale),
        cost_sale: safeNumber(totals.cost_sale),
        qty_sale_return: safeNumber(totals.qty_sale_return),
        amount_sale_return: safeNumber(totals.amount_sale_return),
        cost_sale_return: safeNumber(totals.cost_sale_return),
        net_amount_sale: safeNumber(totals.net_amount_sale),
        net_cost_sale: safeNumber(totals.net_cost_sale),
        profit: safeNumber(totals.profit),
      },
    };
  }

  // ──────────────────────────── Daily Sales Chart ────────────────────────────

  async dailySalesChart(
    tenant: TenantContext,
    query: DailySalesChartQuery,
  ): Promise<DailySalesChartResponse> {
    const rawRows = await this.repo.getDailySalesChart(
      tenant,
      query.startDate,
      query.endDate,
      query.groupBy,
    );

    const points: DailySalesChartPoint[] = rawRows.map((r) => ({
      // monthly returns 'YYYY-MM' — append '-01' เพื่อ format ใช้กับ Date() ได้
      month: query.groupBy === 'monthly' ? `${r.period}-01` : r.period,
      value: safeNumber(r.net_sales),
      cost: safeNumber(r.net_cost),
    }));

    return { points };
  }

  // ──────────────────────────── Bank Statement ────────────────────────────

  async bankStatement(
    tenant: TenantContext,
    query: BankStatementQuery,
  ): Promise<BankStatementResponse> {
    const today = new Date().toISOString().split('T')[0];
    const fromDate = query.fromDate ?? today;
    const toDate = query.toDate ?? today;

    const [openingBalances, transactions] = await Promise.all([
      this.repo.getBankOpeningBalances(
        tenant,
        fromDate,
        query.bankCode,
        query.bookNo,
      ),
      this.repo.getBankTransactions(
        tenant,
        fromDate,
        toDate,
        query.bankCode,
        query.bookNo,
        query.transactionType,
      ),
    ]);

    const totalIn = transactions.reduce(
      (sum, t) => sum + safeNumber(t.amount_in),
      0,
    );
    const totalOut = transactions.reduce(
      (sum, t) => sum + safeNumber(t.amount_out),
      0,
    );
    const openingBalance = openingBalances.reduce(
      (sum, b) => sum + safeNumber(b.amount_balance),
      0,
    );

    return {
      openingBalances: openingBalances.map((b) => ({
        book_no: b.book_no,
        amount_balance: safeNumber(b.amount_balance),
      })),
      transactions: transactions.map((t) => ({
        ...t,
        amount_in: safeNumber(t.amount_in),
        amount_out: safeNumber(t.amount_out),
        amount_balance: safeNumber(t.amount_balance),
      })),
      summary: {
        openingBalance,
        totalIn,
        totalOut,
        netAmount: openingBalance + totalIn - totalOut,
        transactionCount: transactions.length,
        depositCount: transactions.filter((t) => safeNumber(t.amount_in) > 0)
          .length,
        withdrawCount: transactions.filter((t) => safeNumber(t.amount_out) > 0)
          .length,
      },
    };
  }

  // ──────────────────────────── Bank Books ────────────────────────────

  async bankBooks(tenant: TenantContext): Promise<BankBooksResponse> {
    const rawBooks = await this.repo.getBankBooks(tenant);

    // bank_code field อาจอยู่ในรูป "CODE~ชื่อ" — extract code ก่อน
    const splitFirst = (s: string): string =>
      s.includes('~') ? s.split('~')[0] : s;

    const uniqueBankCodes = Array.from(
      new Set(rawBooks.map((b) => splitFirst(b.bank_code)).filter(Boolean)),
    );

    const [banksResult, branchesResult] = await Promise.all([
      this.repo.getBanksByCodes(tenant, uniqueBankCodes),
      this.repo.getBankBranches(tenant).catch(() => []),
    ]);

    const bankNameMap = new Map(banksResult.map((b) => [b.code, b.name]));

    const books: BankBookEntry[] = rawBooks.map((raw) => {
      const bankCode = splitFirst(raw.bank_code) || '';
      const branchParts = raw.bank_branch ? raw.bank_branch.split('~') : [];
      return {
        code: raw.code,
        name: raw.name,
        book_number: raw.book_number,
        bank_code: bankCode,
        bank_name: bankNameMap.get(bankCode) || bankCode,
        branch_code: branchParts[0] || '',
        branch_name: branchParts[1] || '',
      };
    });

    return {
      books,
      banks: banksResult,
      branches: branchesResult,
    };
  }

  // ──────────────────────────── AR Movement ────────────────────────────

  async arMovement(
    tenant: TenantContext,
    query: ArMovementQuery,
  ): Promise<ArMovementResponse> {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateFrom = query.dateFrom ?? `${yyyy}-${mm}-01`;
    const dateTo = query.dateTo ?? `${yyyy}-${mm}-${dd}`;

    const rawRows = await this.repo.getArMovement(
      tenant,
      dateFrom,
      dateTo,
      query.customerCodes,
    );

    const rows = rawRows.map((r) => ({
      ...r,
      amount: safeNumber(r.amount),
      trans_type_name: getArTransTypeName(r.doc_type),
    }));

    return { rows, count: rows.length };
  }

  // ──────────────────────────── Receivable Overdue ────────────────────────────

  async receivableOverdue(
    tenant: TenantContext,
    query: ReceivableOverdueQuery,
  ): Promise<ReceivableOverdueResponse> {
    const asOfDate = query.asOfDate ?? new Date().toISOString().split('T')[0];
    const today = new Date(asOfDate);

    const openInvoices = await this.repo.getArOpenInvoices(tenant, asOfDate);

    const customerFilter = parseCustomerCodes(query.customerCodes);

    const rows = openInvoices
      .filter((r) => {
        if (!r.due_date) return false;
        const dueDate = new Date(r.due_date);
        if (isNaN(dueDate.getTime())) return false;
        return dueDate < today && safeNumber(r.balance_amount) > 0;
      })
      .filter((r) => !customerFilter || customerFilter.has(r.cust_code))
      .map((r) => {
        const dueDate = new Date(r.due_date as string);
        const overdueDays = Math.floor(
          (today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24),
        );
        return {
          ar_code: r.cust_code,
          ar_name: r.cust_name,
          doc_no: r.doc_no,
          doc_date: r.doc_date,
          due_date: r.due_date,
          doc_type: r.doc_type,
          ref_doc_no: r.ref_doc_no,
          ref_doc_date: r.ref_doc_date,
          total_amount: safeNumber(r.total_amount),
          balance_amount: safeNumber(r.balance_amount),
          overdue_days: overdueDays,
        };
      });

    return { rows, asOfDate };
  }

  // ──────────────────────────── AR Aging ────────────────────────────

  async arAging(
    tenant: TenantContext,
    query: ArAgingQuery,
  ): Promise<ArAgingResponse> {
    const asOfDate = query.asOfDate ?? new Date().toISOString().split('T')[0];
    const today = new Date(asOfDate);

    const openInvoices = await this.repo.getArOpenInvoices(tenant, asOfDate);

    const customerFilter = parseCustomerCodes(query.customerCodes);

    const items = openInvoices
      .filter((r) => safeNumber(r.balance_amount) > 0)
      .filter((r) => !customerFilter || customerFilter.has(r.cust_code));

    type Bucket = ArAgingResponse['rows'][number];
    const map = new Map<string, Bucket>();

    for (const item of items) {
      const balance = safeNumber(item.balance_amount);
      let overdueDays = 0;
      if (item.due_date) {
        const dueDate = new Date(item.due_date);
        if (!isNaN(dueDate.getTime())) {
          overdueDays = Math.floor(
            (today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24),
          );
        }
      }

      let bucket = map.get(item.cust_code);
      if (!bucket) {
        bucket = {
          ar_code: item.cust_code,
          ar_name: item.cust_name ?? '',
          current_amount: 0,
          days_1_30: 0,
          days_31_60: 0,
          days_61_90: 0,
          days_over_90: 0,
          total_amount: 0,
        };
        map.set(item.cust_code, bucket);
      }
      bucket.total_amount += balance;
      if (overdueDays <= 0) bucket.current_amount += balance;
      else if (overdueDays <= 30) bucket.days_1_30 += balance;
      else if (overdueDays <= 60) bucket.days_31_60 += balance;
      else if (overdueDays <= 90) bucket.days_61_90 += balance;
      else bucket.days_over_90 += balance;
    }

    const rows = Array.from(map.values()).sort((a, b) =>
      a.ar_code.localeCompare(b.ar_code),
    );

    return { rows, asOfDate };
  }

  // ──────────────────────────── AP Movement ────────────────────────────

  async apMovement(
    tenant: TenantContext,
    query: ApMovementQuery,
  ): Promise<ApMovementResponse> {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateFrom = query.dateFrom ?? `${yyyy}-${mm}-01`;
    const dateTo = query.dateTo ?? `${yyyy}-${mm}-${dd}`;

    const rawRows = await this.repo.getApMovement(
      tenant,
      dateFrom,
      dateTo,
      query.supplierCodes,
    );

    const rows = rawRows.map((r) => ({
      ...r,
      amount: safeNumber(r.amount),
      trans_type_name: getApTransTypeName(r.doc_type),
    }));

    return { rows, count: rows.length };
  }

  // ──────────────────────────── Payable Overdue ────────────────────────────

  async payableOverdue(
    tenant: TenantContext,
    query: PayableOverdueQuery,
  ): Promise<PayableOverdueResponse> {
    const asOfDate = query.asOfDate ?? new Date().toISOString().split('T')[0];
    const today = new Date(asOfDate);

    const openInvoices = await this.repo.getApOpenInvoices(tenant, asOfDate);

    const supplierFilter = parseCustomerCodes(query.supplierCodes);

    const rows = openInvoices
      .filter((r) => {
        if (!r.due_date) return false;
        const dueDate = new Date(r.due_date);
        if (isNaN(dueDate.getTime())) return false;
        return dueDate < today && safeNumber(r.balance_amount) > 0;
      })
      .filter((r) => !supplierFilter || supplierFilter.has(r.vend_code))
      .map((r) => {
        const dueDate = new Date(r.due_date as string);
        const overdueDays = Math.floor(
          (today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24),
        );
        return {
          ap_code: r.vend_code,
          ap_name: r.vend_name,
          doc_no: r.doc_no,
          doc_date: r.doc_date,
          due_date: r.due_date,
          doc_type: r.doc_type,
          ref_doc_no: r.ref_doc_no,
          ref_doc_date: r.ref_doc_date,
          total_amount: safeNumber(r.total_amount),
          balance_amount: safeNumber(r.balance_amount),
          overdue_days: overdueDays,
        };
      });

    return { rows, asOfDate };
  }

  // ──────────────────────────── AP Aging ────────────────────────────

  async apAging(
    tenant: TenantContext,
    query: ApAgingQuery,
  ): Promise<ApAgingResponse> {
    const asOfDate = query.asOfDate ?? new Date().toISOString().split('T')[0];
    const today = new Date(asOfDate);

    const openInvoices = await this.repo.getApOpenInvoices(tenant, asOfDate);

    const supplierFilter = parseCustomerCodes(query.supplierCodes);

    const items = openInvoices
      .filter((r) => safeNumber(r.balance_amount) > 0)
      .filter((r) => !supplierFilter || supplierFilter.has(r.vend_code));

    type Bucket = ApAgingResponse['rows'][number];
    const map = new Map<string, Bucket>();

    for (const item of items) {
      const balance = safeNumber(item.balance_amount);
      let overdueDays = 0;
      if (item.due_date) {
        const dueDate = new Date(item.due_date);
        if (!isNaN(dueDate.getTime())) {
          overdueDays = Math.floor(
            (today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24),
          );
        }
      }

      let bucket = map.get(item.vend_code);
      if (!bucket) {
        bucket = {
          ap_code: item.vend_code,
          ap_name: item.vend_name ?? '',
          current_amount: 0,
          days_1_30: 0,
          days_31_60: 0,
          days_61_90: 0,
          days_over_90: 0,
          total_amount: 0,
        };
        map.set(item.vend_code, bucket);
      }
      bucket.total_amount += balance;
      if (overdueDays <= 0) bucket.current_amount += balance;
      else if (overdueDays <= 30) bucket.days_1_30 += balance;
      else if (overdueDays <= 60) bucket.days_31_60 += balance;
      else if (overdueDays <= 90) bucket.days_61_90 += balance;
      else bucket.days_over_90 += balance;
    }

    const rows = Array.from(map.values()).sort((a, b) =>
      a.ap_code.localeCompare(b.ap_code),
    );

    return { rows, asOfDate };
  }
}

// ──────────────────────────── Helpers ────────────────────────────

function parseCustomerCodes(csv?: string): Set<string> | null {
  if (!csv) return null;
  const codes = csv
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  return codes.length > 0 ? new Set(codes) : null;
}

const AR_TRANS_TYPE_MAP: Record<number, string> = {
  2: 'ใบเสนอซื้อ',
  6: 'ใบสั่งซื้อ',
  7: 'ยกเลิกใบสั่งซื้อ',
  10: 'จ่ายเงินล่วงหน้า-เจ้าหนี้',
  11: 'จ่ายเงินมัดจำ-เจ้าหนี้',
  12: 'ซื้อ',
  16: 'ส่งคืน/ลดหนี้',
  20: 'รับคืนเงินล่วงหน้า-เจ้าหนี้',
  30: 'ใบเสนอราคา',
  31: 'ยกเลิกใบเสนอราคา',
  34: 'สั่งจอง/สั่งซื้อ',
  36: 'ใบสั่งขาย',
  37: 'ยกเลิกใบสั่งขาย',
  40: 'รับเงินล่วงหน้า-ลูกหนี้',
  44: 'ขาย',
  48: 'รับคืน',
  54: 'ยกมา',
  56: 'เบิก',
  58: 'รับคืนจากเบิก',
  60: 'รับสำเร็จรูป',
  66: 'ปรับปรุง',
  70: 'โอนเข้า',
  72: 'โอนออก',
  81: 'ตั้งหนี้ยกมา-เจ้าหนี้',
  87: 'ตั้งหนี้อื่นๆ-เจ้าหนี้',
  89: 'เพิ่มหนี้อื่นๆ-เจ้าหนี้',
  91: 'ลดหนี้อื่นๆ-เจ้าหนี้',
  93: 'ตั้งหนี้ยกมา-ลูกหนี้',
  97: 'ลดหนี้ยกมา-ลูกหนี้',
  99: 'ตั้งหนี้อื่นๆ-ลูกหนี้',
  103: 'ลดหนี้อื่นๆ-ลูกหนี้',
  239: 'รับชำระหนี้',
  260: 'รายจ่ายอื่น',
  262: 'รายจ่ายอื่นลดหนี้',
  310: 'พาเชียล_รับสินค้า',
  315: 'พาเชียล_ตั้งหนี้',
  316: 'พาเชียล_เพิ่มหนี้',
  317: 'พาเชียล_ลดหนี้',
};

function getArTransTypeName(transFlag: number): string {
  return AR_TRANS_TYPE_MAP[transFlag] ?? `อื่นๆ(${transFlag})`;
}

const AP_TRANS_TYPE_MAP: Record<number, string> = {
  12: 'ซื้อ',
  16: 'ส่งคืน/ลดหนี้',
  81: 'ตั้งหนี้ยกมา-เจ้าหนี้',
  87: 'ตั้งหนี้อื่นๆ-เจ้าหนี้',
  89: 'เพิ่มหนี้อื่นๆ-เจ้าหนี้',
  91: 'ลดหนี้อื่นๆ-เจ้าหนี้',
  240: 'ชำระหนี้',
  260: 'รายจ่ายอื่น',
  262: 'รายจ่ายอื่นลดหนี้',
};

function getApTransTypeName(transFlag: number): string {
  return AP_TRANS_TYPE_MAP[transFlag] ?? `อื่นๆ(${transFlag})`;
}

function safeNumber(value: unknown): number {
  const n = parseFloat(String(value));
  if (!isFinite(n) || isNaN(n) || Math.abs(n) > 1e15) return 0;
  return n;
}

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

const TRANS_TYPE_MAP: Record<number, string> = {
  12: 'ซื้อ',
  310: 'รับคืน',
  70: 'รับโอน',
  54: 'ผลิต',
  60: 'ปรับปรุง+',
  58: 'นับสต๊อก+',
  14: 'รับฝาก',
  48: 'แปลงหน่วย+',
  66: 'อื่นๆ',
  44: 'ขาย',
  56: 'จ่ายโอน',
  68: 'เบิก',
  72: 'ส่งคืน',
  46: 'ส่งฝาก',
  16: 'ปรับปรุง-',
  311: 'ยกเลิก',
};

function getTransTypeName(transFlag: number): string {
  return TRANS_TYPE_MAP[transFlag] ?? String(transFlag);
}
