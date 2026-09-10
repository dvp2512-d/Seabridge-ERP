import { Router } from 'express';
import { prisma, Prisma } from '@seabridge/database';
import { COMMERCIAL_TYPE_FILTER, DOCUMENT_ONLY_TYPE_LIST } from '../utils/invoiceTypes';
import { authenticate, can } from '../middleware/auth';
import {
  startOfFinancialYear,
  startOfMonth as monthStart,
  financialYearLabel,
} from '../utils/period';
import { getBaseCurrency } from '../services/exchangeRateService';

/**
 * Reshape a Prisma groupBy into the { key, count, value } rows the charts read.
 *
 * Kept as a named helper because the chart components depend on this exact shape:
 * they previously read Prisma's raw `_count.id` / `_sum.x` wrappers and silently
 * rendered zeros when the response shape changed.
 *
 * No currency handling here - every amount is INR.
 */
function toChartRows<T extends Record<string, any>>(
  groups: T[],
  keyField: keyof T,
  getValue: (group: T) => number
): { key: string; count: number; value: number }[] {
  return groups.map((group) => ({
    key: String(group[keyField]),
    count: group._count?.id ?? group._count?._all ?? 0,
    value: Math.round((getValue(group) + Number.EPSILON) * 100) / 100,
  }));
}

const router: Router = Router();

router.use(authenticate);

// Main founder dashboard
router.get('/', can('DASHBOARD_FULL'), async (req, res, next) => {
  try {
    const today = new Date();
    const startOfMonth = monthStart(today);
    /**
     * Indian financial year, 1 April to 31 March - not the calendar year.
     *
     * This previously started on 1 January, so January, February and March counted
     * against the wrong year and every yearly total disagreed with the books by
     * three months of activity. The label travels with the response so a screen
     * can state which year it is showing rather than leaving it to be assumed.
     */
    const startOfYear = startOfFinancialYear(today);
    const periodLabel = financialYearLabel(today);

    // Parallel queries for performance
    const [
      // Revenue & Orders
      totalOrders,
      activeOrders,
      
      // Pipeline
      openInquiries,
      pendingQuotations,
      
      // Shipments
      activeShipments,
      
      // Finance
      
      // Recent items
      recentInquiries,
      recentOrders,
      pendingTasks,
      
      // Counts
      totalBuyers,
      activeBuyers,
    ] = await Promise.all([
      
      // Total orders this year
      prisma.exportOrder.count({
        where: { orderDate: { gte: startOfYear } },
      }),
      
      // Active orders
      prisma.exportOrder.count({
        where: { status: { in: ['CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP'] } },
      }),
      
      // Open inquiries
      prisma.inquiry.count({
        where: { stage: { notIn: ['WON', 'LOST'] } },
      }),
      
      // Pending quotations
      prisma.quotation.count({
        where: { status: { in: ['DRAFT', 'SENT'] } },
      }),
      
      // Active shipments
      prisma.shipment.count({
        where: { status: { in: ['PENDING', 'BOOKED', 'IN_TRANSIT'] } },
      }),
      
      // Recent inquiries
      prisma.inquiry.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          buyer: { select: { companyName: true } },
          salesOwner: { select: { firstName: true, lastName: true } },
        },
      }),
      
      // Recent orders
      prisma.exportOrder.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { buyer: { select: { companyName: true } } },
      }),
      
      // Pending tasks
      prisma.task.findMany({
        where: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
        take: 10,
        orderBy: { dueDate: 'asc' },
        include: { assignee: { select: { firstName: true, lastName: true } } },
      }),
      
      // Total buyers
      prisma.buyer.count(),
      
      // Active buyers
      prisma.buyer.count({ where: { status: 'ACTIVE' } }),
    ]);

    /**
     * Every monetary column is INR, so these are plain aggregates done in SQL.
     *
     * This block previously fetched each row with its currency and converted in
     * application code, because amounts were stored in mixed currencies and could
     * not be added directly. Storing INR removes both the conversion and the
     * possibility of a total that quietly excludes rows whose rate was missing.
     */
    const [
      monthlyPaymentTotal,
      yearlyPaymentTotal,
      receivableTotal,
      overdueTotal,
      pipelineTotal,
      /**
       * Other income, kept apart from Revenue on purpose.
       *
       * Drawback, RoDTEP, interest and forex gain are real receipts but they are
       * not export sales. Folding them into Revenue would flatter sales
       * performance and stop one period being comparable with another.
       */
      incomeByStatus,
      incomeByCategory,
      allPaymentTotal,
      allIncomeReceived,
      allExpenseGroups,
    ] = await Promise.all([
      prisma.payment.aggregate({
        where: { paymentDate: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({
        where: { paymentDate: { gte: startOfYear } },
        _sum: { amount: true },
      }),
      prisma.invoice.aggregate({
        // Proformas and samples are documents, not receivables, so they are excluded from
        // every money figure here.
        where: {
          type: COMMERCIAL_TYPE_FILTER,
          status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] },
        },
        _sum: { balanceAmount: true },
      }),
      prisma.invoice.aggregate({
        // Overdue is derived from the due date, not from the OVERDUE status:
        // nothing in the system ever transitions an invoice into that status, so
        // filtering on it reported zero while the alert banner and the aging
        // chart - which both use the due date - correctly showed arrears.
        where: {
          type: COMMERCIAL_TYPE_FILTER,
          status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] },
          balanceAmount: { gt: 0 },
          dueDate: { lt: new Date() },
        },
        _sum: { balanceAmount: true },
      }),
      prisma.inquiry.aggregate({
        where: { stage: { notIn: ['WON', 'LOST'] } },
        _sum: { expectedValue: true },
      }),
      prisma.income.groupBy({
        by: ['status'],
        where: { receivedDate: { gte: startOfYear } },
        _count: { _all: true },
        _sum: { amountINR: true },
      }),
      prisma.income.groupBy({
        by: ['category'],
        where: { receivedDate: { gte: startOfYear }, status: 'RECEIVED' },
        _sum: { amountINR: true },
      }),
      /**
       * All-time figures for the remaining balance.
       *
       * Deliberately not scoped to the financial year. The balance answers "how
       * much is actually left to use", and money received in a previous year is
       * still money. Scoping it to April onwards would understate what is
       * available every April and slowly recover through the year, which is not
       * what anyone means by a remaining balance.
       *
       * The KPI cards stay on the financial year, because revenue performance is
       * a period question.
       */
      prisma.payment.aggregate({ _sum: { amount: true } }),
      prisma.income.aggregate({
        where: { status: 'RECEIVED' },
        _sum: { amountINR: true },
      }),
      prisma.expense.groupBy({
        by: ['status'],
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);

    const base = await getBaseCurrency();

    const monthlyRevenue = Number(monthlyPaymentTotal._sum.amount ?? 0);
    const yearlyRevenue = Number(yearlyPaymentTotal._sum.amount ?? 0);
    const totalReceivables = Number(receivableTotal._sum.balanceAmount ?? 0);
    const overdueReceivables = Number(overdueTotal._sum.balanceAmount ?? 0);
    const pipelineValue = Number(pipelineTotal._sum.expectedValue ?? 0);

    /**
     * Other income for the year to date, in rupees.
     *
     * Deliberately not added to any revenue figure. Reported alongside so the
     * top line can be seen if wanted, without changing what Revenue means.
     */
    const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
    let otherIncomeReceived = 0;
    let otherIncomePending = 0;
    for (const group of incomeByStatus) {
      const amount = Number(group._sum.amountINR ?? 0);
      if (group.status === 'RECEIVED') otherIncomeReceived += amount;
      if (group.status === 'PENDING') otherIncomePending += amount;
    }

    /**
     * Net position: the remaining balance, all time.
     *
     *   total income   = every payment received + every other-income receipt
     *   total expenses = every expense paid
     *   remaining      = the difference
     *
     * All time rather than financial year, because this answers what is left to
     * use. Money received last year has not stopped existing, and scoping it to
     * April onwards would show a near-empty balance every April.
     *
     * Cash-based: only money that has actually moved. Approved-but-unpaid
     * expenses and pending income are reported separately rather than folded in,
     * since a figure mixing the two is neither a cash position nor a profit.
     */
    let expensesPaid = 0;
    let expensesCommitted = 0;

    for (const group of allExpenseGroups) {
      const amount = Number(group._sum.amount ?? 0);
      if (group.status === 'PAID') expensesPaid += amount;
      // Approved but not yet paid: an obligation, not yet an outflow.
      if (group.status === 'APPROVED') expensesCommitted += amount;
    }

    const allTimeRevenue = Number(allPaymentTotal._sum.amount ?? 0);

    const otherIncomeAllTime = Number(allIncomeReceived._sum.amountINR ?? 0);
    const totalIncome = round2(allTimeRevenue + otherIncomeAllTime);
    const totalExpenses = round2(expensesPaid);
    const netBalance = round2(totalIncome - totalExpenses);

    res.json({
      success: true,
      data: {
        // Every money figure below is expressed in this currency.
        baseCurrency: base,
        /**
         * What period and basis these figures cover, so a screen can label them
         * rather than presenting bare numbers whose meaning has to be guessed.
         * The mismatch this replaces: the dashboard showed year-to-date received
         * income while the income page showed all-time received plus pending, and
         * nothing said so.
         */
        period: {
          label: periodLabel,
          from: startOfYear,
          to: today,
          basis: 'Received and paid only, excluding pending',
        },
        // Every stored amount is already in this currency, so no record can fail
        // to convert - the unconvertedRecords field this replaces is obsolete.
        kpis: {
          monthlyRevenue: round2(monthlyRevenue),
          yearlyRevenue: round2(yearlyRevenue),
          totalOrders,
          activeOrders,
          openInquiries,
          pendingQuotations,
          activeShipments,
          totalReceivables: round2(totalReceivables),
          overdueReceivables: round2(overdueReceivables),
          pipelineValue: round2(pipelineValue),
          totalBuyers,
          activeBuyers,
        },
        recent: {
          inquiries: recentInquiries,
          orders: recentOrders,
        },
        /**
         * Separate from kpis.monthlyRevenue and yearlyRevenue, which remain export
         * sales only. Always INR, since income is converted when it is recorded.
         */
        otherIncome: {
          currency: 'INR',
          received: round2(otherIncomeReceived),
          pending: round2(otherIncomePending),
          byCategory: incomeByCategory
            .map((g) => ({
              category: g.category,
              amountINR: round2(Number(g._sum.amountINR ?? 0)),
            }))
            .sort((a, b) => b.amountINR - a.amountINR),
        },
        /**
         * Remaining balance, all time, in the base currency.
         *
         * Every component is returned so the arithmetic is checkable rather than a
         * single unexplained number. Scope is stated on the block itself, because
         * this is all time while the KPI cards above are financial year - the two
         * appearing to disagree without explanation is exactly the confusion this
         * replaces.
         */
        netPosition: {
          currency: base.code,
          scope: 'All time',
          exportRevenue: round2(allTimeRevenue),
          otherIncome: round2(otherIncomeAllTime),
          totalIncome,
          totalExpenses,
          netBalance,
          // Not included in the figures above; shown so the balance is not
          // mistaken for the whole picture.
          expensesCommitted: round2(expensesCommitted),
          incomePending: round2(otherIncomePending),
        },
        pendingTasks,
        alerts: await getAlerts(),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Sales dashboard
router.get('/sales', can('DASHBOARD_SALES'), async (req, res, next) => {
  try {
    const [
      inquiriesByStage,
      quotationsByStatus,
      topBuyers,
      salesByMonth,
    ] = await Promise.all([
      // Inquiries by stage. Amounts are INR, so a plain _sum is correct.
      prisma.inquiry.groupBy({
        by: ['stage'],
        _count: { id: true },
        _sum: { expectedValue: true },
      }),
      
      // Quotations by status
      prisma.quotation.groupBy({
        by: ['status'],
        _count: { id: true },
        _sum: { grandTotal: true },
      }),
      
      // Top buyers by revenue
      prisma.buyer.findMany({
        take: 10,
        orderBy: { totalRevenue: 'desc' },
        where: { totalRevenue: { gt: 0 } },
        select: {
          id: true,
          companyName: true,
          totalRevenue: true,
          totalOrders: true,
          country: { select: { name: true } },
        },
      }),
      
      // Sales by month (last 12 months)
      prisma.$queryRaw`
        SELECT 
          DATE_TRUNC('month', payment_date) as month,
          SUM(amount) as total
        FROM payments
        WHERE payment_date >= NOW() - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('month', payment_date)
        ORDER BY month
      `,
    ]);

    res.json({
      success: true,
      data: {
        baseCurrency: await getBaseCurrency(),
        // Shaped as { key, count, value } to match what the charts consume.
        inquiriesByStage: toChartRows(inquiriesByStage, 'stage', (g) =>
          Number(g._sum.expectedValue ?? 0)
        ),
        quotationsByStatus: toChartRows(quotationsByStatus, 'status', (g) =>
          Number(g._sum.grandTotal ?? 0)
        ),
        topBuyers,
        salesByMonth,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Operations dashboard
router.get('/operations', can('DASHBOARD_OPERATIONS'), async (req, res, next) => {
  try {
    const [
      ordersByStatus,
      shipmentsInTransit,
      pendingDocuments,
      upcomingShipments,
    ] = await Promise.all([
      // Orders by status
      prisma.exportOrder.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      
      // Shipments in transit
      prisma.shipment.findMany({
        where: { status: 'IN_TRANSIT' },
        include: {
          order: { select: { orderNumber: true, buyer: { select: { companyName: true } } } },
          destinationPort: { select: { name: true } },
        },
        orderBy: { eta: 'asc' },
      }),
      
      // Pending documents
      prisma.document.findMany({
        where: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
        include: { order: { select: { orderNumber: true } } },
        orderBy: { dueDate: 'asc' },
        take: 20,
      }),
      
      // Upcoming shipments (next 30 days)
      prisma.shipment.findMany({
        where: {
          etd: { gte: new Date(), lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
          status: { in: ['PENDING', 'BOOKED'] },
        },
        include: {
          order: { select: { orderNumber: true, buyer: { select: { companyName: true } } } },
        },
        orderBy: { etd: 'asc' },
      }),
    ]);

    res.json({
      success: true,
      data: {
        ordersByStatus,
        shipmentsInTransit,
        pendingDocuments,
        upcomingShipments,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Finance dashboard
router.get('/finance', can('DASHBOARD_FINANCE'), async (req, res, next) => {
  try {
    const [
      receivablesSummary,
      recentPayments,
      overdueInvoices,
      monthlyCollections,
    ] = await Promise.all([
      // Receivables by age
      prisma.$queryRaw`
        SELECT 
          CASE 
            WHEN due_date >= CURRENT_DATE THEN 'current'
            WHEN due_date >= CURRENT_DATE - INTERVAL '30 days' THEN '1-30 days'
            WHEN due_date >= CURRENT_DATE - INTERVAL '60 days' THEN '31-60 days'
            WHEN due_date >= CURRENT_DATE - INTERVAL '90 days' THEN '61-90 days'
            ELSE '90+ days'
          END as aging,
          SUM(balance_amount) as total,
          -- Cast to int: Postgres COUNT(*) is bigint, which Prisma returns as a
          -- JS BigInt and res.json() cannot serialize (throws, 500ing the route
          -- as soon as a single invoice is outstanding).
          COUNT(*)::int as count
        FROM invoices
        -- Proformas and samples are documents and carry no receivable, so they are
        -- excluded. Prisma.join binds one parameter per type; a comma-joined string
        -- would be bound as a single value and would quietly match nothing.
        WHERE status IN ('SENT', 'PARTIALLY_PAID', 'OVERDUE')
        AND type NOT IN (${Prisma.join(DOCUMENT_ONLY_TYPE_LIST)})
        GROUP BY aging
      `,
      
      // Recent payments
      prisma.payment.findMany({
        take: 10,
        orderBy: { paymentDate: 'desc' },
        include: {
          invoice: {
            select: {
              invoiceNumber: true,
              buyer: { select: { companyName: true } },
            },
          },
        },
      }),
      
      // Overdue invoices
      prisma.invoice.findMany({
        where: { 
          type: COMMERCIAL_TYPE_FILTER,
          status: { in: ['SENT', 'PARTIALLY_PAID'] },
          dueDate: { lt: new Date() },
        },
        include: { buyer: { select: { companyName: true } } },
        orderBy: { dueDate: 'asc' },
        take: 20,
      }),
      
      // Monthly collections
      prisma.$queryRaw`
        SELECT 
          DATE_TRUNC('month', payment_date) as month,
          SUM(amount) as total
        FROM payments
        WHERE payment_date >= NOW() - INTERVAL '6 months'
        GROUP BY DATE_TRUNC('month', payment_date)
        ORDER BY month
      `,
    ]);

    res.json({
      success: true,
      data: {
        receivablesSummary,
        recentPayments,
        overdueInvoices,
        monthlyCollections,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Helper function for alerts
async function getAlerts() {
  const alerts: any[] = [];
  const today = new Date();

  // Overdue follow-ups
  const overdueFollowUps = await prisma.inquiry.count({
    where: {
      nextFollowUp: { lt: today },
      stage: { notIn: ['WON', 'LOST'] },
    },
  });
  if (overdueFollowUps > 0) {
    alerts.push({
      type: 'warning',
      message: `${overdueFollowUps} inquiries have overdue follow-ups`,
      link: '/inquiries?filter=overdue',
    });
  }

  // Expiring quotations
  const expiringQuotations = await prisma.quotation.count({
    where: {
      status: 'SENT',
      validUntil: { lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    },
  });
  if (expiringQuotations > 0) {
    alerts.push({
      type: 'warning',
      message: `${expiringQuotations} quotations expiring within 7 days`,
      link: '/quotations?filter=expiring',
    });
  }

  // Overdue invoices
  const overdueInvoices = await prisma.invoice.count({
    where: { 
      type: COMMERCIAL_TYPE_FILTER,
      dueDate: { lt: today },
      status: { in: ['SENT', 'PARTIALLY_PAID'] },
    },
  });
  if (overdueInvoices > 0) {
    alerts.push({
      type: 'error',
      message: `${overdueInvoices} invoices are overdue`,
      link: '/invoices?filter=overdue',
    });
  }

  return alerts;
}

export { router as dashboardRouter };
