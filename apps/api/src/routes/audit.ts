import { Router } from 'express';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';

const router: Router = Router();

router.use(authenticate);

/**
 * List all audit log entries with filtering and pagination.
 * Only founders and admins can view the full audit trail.
 */
router.get('/', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    const {
      page = '1',
      limit = '50',
      entityType,
      action,
      userId,
      startDate,
      endDate,
      search,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};

    if (entityType) {
      where.entityType = entityType;
    }

    if (action) {
      where.action = action;
    }

    if (userId) {
      where.userId = userId;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate as string);
      }
    }

    if (search) {
      where.OR = [
        { entityType: { contains: search as string, mode: 'insensitive' } },
        { entityId: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const [entries, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        entries,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get audit history for a specific entity.
 * Shows all changes made to one record.
 */
router.get('/entity/:entityType/:entityId', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    const { entityType, entityId } = req.params;

    const entries = await prisma.auditLog.findMany({
      where: {
        entityType,
        entityId,
      },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: entries,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get audit log statistics for dashboard.
 */
router.get('/stats', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const [todayCount, weekCount, totalCount, actionCounts] = await Promise.all([
      prisma.auditLog.count({
        where: { createdAt: { gte: today } },
      }),
      prisma.auditLog.count({
        where: { createdAt: { gte: weekAgo } },
      }),
      prisma.auditLog.count(),
      prisma.auditLog.groupBy({
        by: ['action'],
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
    ]);

    res.json({
      success: true,
      data: {
        todayCount,
        weekCount,
        totalCount,
        actionBreakdown: actionCounts.map((a) => ({
          action: a.action,
          count: a._count.id,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get filter options for the audit log UI.
 */
router.get('/options', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    const [entityTypes, actions, users] = await Promise.all([
      prisma.auditLog.findMany({
        select: { entityType: true },
        distinct: ['entityType'],
        orderBy: { entityType: 'asc' },
      }),
      prisma.auditLog.findMany({
        select: { action: true },
        distinct: ['action'],
        orderBy: { action: 'asc' },
      }),
      prisma.user.findMany({
        select: { id: true, firstName: true, lastName: true },
        where: { status: 'ACTIVE' },
        orderBy: { firstName: 'asc' },
      }),
    ]);

    res.json({
      success: true,
      data: {
        entityTypes: entityTypes.map((e) => e.entityType),
        actions: actions.map((a) => a.action),
        users,
      },
    });
  } catch (error) {
    next(error);
  }
});

export { router as auditRouter };
