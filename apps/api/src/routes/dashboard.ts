import { Router } from 'express';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import {
  startOfFinancialYear,
  startOfMonth as monthStart,
  financialYearLabel,
} from '../utils/period';
import {
  buildRateMap,
  buildRateMapByCode,
  sumConverted,
} from '../services/exchangeRateService';

/**
 * Collapse a Prisma groupBy that was split by currency back into one row per
 * key, with the money converted into the base currency.
 *
 * Grouping by currency is what makes conversion possible at all, but the UI wants
 * one row per stage or status, so the currency dimension is folded away here.
 * Groups whose currency has no notified rate are counted rather than added, so a
 * chart never shows a total that quietly excludes some records.
 */
function collapseByCurrency<T extends Record<string, any>>(
  groups: T[],
  keyField: keyof T,
  getValue: (group: T) => number,
  rates: Map<string, number>
): { key: string; count: number; value: number; unconvertedCount: number }[] {
  const collapsed = new Map<
    string,
    { key: string; count: number; value: number; unconvertedCount: number }
  >();

  for (const group of groups) {
    const key = String(group[keyField]);
    const entry =
      collapsed.get(key) ?? { key, count: 0, value: 0, unconvertedCount: 0 };

    entry.count += group._count?.id ?? 0;

    const currencyId = group.currencyId as string | null;
    const rate = currencyId ? rates.get(currencyId) : undefined;
    if (rate === undefined) {
      entry.unconvertedCount += group._count?.id ?? 0;
    } else {
      entry.value += getValue(group) * rate;
    }

    collapsed.set(key, entry);
  }

  return [...collapsed.values()].map((e) => ({
    ...e,
    value: Math.round((e.value + Number.EPSILON) * 100) / 100,
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
     * Money figures below are converted into the base currency before being
     * summed. Previously these were Prisma _sum aggregates, which add the raw
     * numbers regardless of currency - a USD 5,900 payment and a EUR 3,000
     * payment came out as 8,900 of nothing.
     *
     * Prisma cannot convert inside an aggregate, so each figure is fetched with
     * its currency and converted in application code. Rows whose currency has no
     * notified rate are reported rather than silently dropped.
     */
    const { base, rates: ratesByCode } = await buildRateMapByCode(today);
    const { rates: ratesById } = await buildRateMap(today);

    const [
      monthlyPayments,
      yearlyPayments,
      receivableInvoices,
      overdueInvoices,
      pipelineInquiries,
      /**
       * Other income, kept apart from Revenue on purpose.
       *
       * Drawback, RoDTEP, interest and forex gain are real receipts but they are
       * not export sales. Folding them into Revenue would flatter sales
       * performance and stop one period being comparable with another.
       *
       * Already stored in INR, so these are plain sums - no conversion needed,
       * which is the point of converting on write.
       */
      incomeByStatus,
      incomeByCategory,
      allPayments,
      allIncomeReceived,
      allExpenseGroups,
    ] = await Promise.all([
      prisma.payment.findMany({
        where: { paymentDate: { gte: startOfMonth } },
        select: { amount: true, currency: true },
      }),
      prisma.payment.findMany({
        where: { paymentDate: { gte: startOfYear } },
        select: { amount: true, currency: true },
      }),
      prisma.invoice.findMany({
        where: { status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] } },
        select: { balanceAmount: true, currencyId: true },
      }),
      prisma.invoice.findMany({
        where: { status: 'OVERDUE' },
        select: { balanceAmount: true, currencyId: true },
      }),
      prisma.inquiry.findMany({
        where: { stage: { notIn: ['WON', 'LOST'] } },
        select: { expectedValue: true, currencyId: true },
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
      prisma.payment.findMany({ select: { amount: true, currency: true } }),
      prisma.income.aggregate({
        where: { status: 'RECEIVED' },
        _sum: { amountINR: true },
      }),
      prisma.expense.groupBy({
        by: ['status', 'currency'],
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);

    const monthlyRevenue = sumConverted(
      monthlyPayments.map((p) => ({ amount: Number(p.amount), currencyId: p.currency })),
      ratesByCode
    );
    const yearlyRevenue = sumConverted(
      yearlyPayments.map((p) => ({ amount: Number(p.amount), currencyId: p.currency })),
      ratesByCode
    );
    const totalReceivables = sumConverted(
      receivableInvoices.map((i) => ({
        amount: Number(i.balanceAmount),
        currencyId: i.currencyId,
      })),
      ratesById
    );
    const overdueReceivables = sumConverted(
      overdueInvoices.map((i) => ({ amount: Number(i.balanceAmount), currencyId: i.currencyId })),
      ratesById
    );
    // Inquiries may predate the currency column, so those without one cannot be
    // converted and are counted as unconvertible instead of assumed.
    const pipelineValue = sumConverted(
      pipelineInquiries
        .filter((i) => i.expectedValue !== null)
        .map((i) => ({
          amount: Number(i.expectedValue),
          currencyId: i.currencyId ?? '__unknown__',
        })),
      ratesById
    );

    const unconverted =
      monthlyRevenue.unconvertedCount +
      yearlyRevenue.unconvertedCount +
      totalReceivables.unconvertedCount +
      overdueReceivables.unconvertedCount +
      pipelineValue.unconvertedCount;

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
    let expensesUnconverted = 0;

    for (const group of allExpenseGroups) {
      const rate = ratesByCode.get(group.currency);
      if (rate === undefined) {
        expensesUnconverted += group._count._all;
        continue;
      }
      const amount = Number(group._sum.amount ?? 0) * rate;
      if (group.status === 'PAID') expensesPaid += amount;
      // Approved but not yet paid: an obligation, not yet an outflow.
      if (group.status === 'APPROVED') expensesCommitted += amount;
    }

    // Every payment ever, converted at today's rates for a single comparable figure.
    const allTimeRevenue = sumConverted(
      allPayments.map((p) => ({ amount: Number(p.amount), currencyId: p.currency })),
      ratesByCode
    );

    const otherIncomeAllTime = Number(allIncomeReceived._sum.amountINR ?? 0);
    const totalIncome = round2(allTimeRevenue.total + otherIncomeAllTime);
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
        // Non-zero means some records could not be converted, so the totals are
        // understated. The UI surfaces this rather than showing a clean number.
        unconvertedRecords: unconverted,
        kpis: {
          monthlyRevenue: monthlyRevenue.total,
          yearlyRevenue: yearlyRevenue.total,
          totalOrders,
          activeOrders,
          openInquiries,
          pendingQuotations,
          activeShipments,
          totalReceivables: totalReceivables.total,
          overdueReceivables: overdueReceivables.total,
          pipelineValue: pipelineValue.total,
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
          exportRevenue: allTimeRevenue.total,
          otherIncome: round2(otherIncomeAllTime),
          totalIncome,
          totalExpenses,
          netBalance,
          // Not included in the figures above; shown so the balance is not
          // mistaken for the whole picture.
          expensesCommitted: round2(expensesCommitted),
          incomePending: round2(otherIncomePending),
          // Non-zero means some records had no exchange rate and are excluded.
          unconvertedExpenses: expensesUnconverted,
          unconvertedPayments: allTimeRevenue.unconvertedCount,
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
      // Inquiries by stage. Grouped by currency as well, so the value can be
      // converted before being totalled - a plain _sum here would add rupees to
      // dollars.
      prisma.inquiry.groupBy({
        by: ['stage', 'currencyId'],
        _count: { id: true },
        _sum: { expectedValue: true },
      }),
      
      // Quotations by status, likewise grouped by currency
      prisma.quotation.groupBy({
        by: ['status', 'currencyId'],
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

    // The two groupBy results above are split by currency, so collapse them back
    // to one row per stage/status with the value converted into the base currency.
    const { base: analyticsBase, rates: analyticsRates } = await buildRateMap(new Date());

    res.json({
      success: true,
      data: {
        baseCurrency: analyticsBase,
        inquiriesByStage: collapseByCurrency(
          inquiriesByStage,
          'stage',
          (g: any) => Number(g._sum.expectedValue ?? 0),
          analyticsRates
        ),
        quotationsByStatus: collapseByCurrency(
          quotationsByStatus,
          'status',
          (g: any) => Number(g._sum.grandTotal ?? 0),
          analyticsRates
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
          COUNT(*) as count
        FROM invoices
        WHERE status IN ('SENT', 'PARTIALLY_PAID', 'OVERDUE')
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
