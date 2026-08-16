import { Router } from 'express';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';

const router: Router = Router();

router.use(authenticate);

// Main founder dashboard
router.get('/', can('DASHBOARD_FULL'), async (req, res, next) => {
  try {
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startOfYear = new Date(today.getFullYear(), 0, 1);

    // Parallel queries for performance
    const [
      // Revenue & Orders
      monthlyRevenue,
      yearlyRevenue,
      totalOrders,
      activeOrders,
      
      // Pipeline
      openInquiries,
      pendingQuotations,
      
      // Shipments
      activeShipments,
      
      // Finance
      totalReceivables,
      overdueReceivables,
      
      // Recent items
      recentInquiries,
      recentOrders,
      pendingTasks,
      
      // Counts
      totalBuyers,
      activeBuyers,
    ] = await Promise.all([
      // Monthly revenue (paid invoices this month)
      prisma.payment.aggregate({
        where: { paymentDate: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      
      // Yearly revenue
      prisma.payment.aggregate({
        where: { paymentDate: { gte: startOfYear } },
        _sum: { amount: true },
      }),
      
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
      
      // Total receivables
      prisma.invoice.aggregate({
        where: { status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] } },
        _sum: { balanceAmount: true },
      }),
      
      // Overdue receivables
      prisma.invoice.aggregate({
        where: { status: 'OVERDUE' },
        _sum: { balanceAmount: true },
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

    // Pipeline value
    const pipelineValue = await prisma.inquiry.aggregate({
      where: { stage: { notIn: ['WON', 'LOST'] } },
      _sum: { expectedValue: true },
    });

    res.json({
      success: true,
      data: {
        kpis: {
          monthlyRevenue: monthlyRevenue._sum.amount || 0,
          yearlyRevenue: yearlyRevenue._sum.amount || 0,
          totalOrders,
          activeOrders,
          openInquiries,
          pendingQuotations,
          activeShipments,
          totalReceivables: totalReceivables._sum.balanceAmount || 0,
          overdueReceivables: overdueReceivables._sum.balanceAmount || 0,
          pipelineValue: pipelineValue._sum.expectedValue || 0,
          totalBuyers,
          activeBuyers,
        },
        recent: {
          inquiries: recentInquiries,
          orders: recentOrders,
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
      // Inquiries by stage
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
        inquiriesByStage,
        quotationsByStatus,
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
