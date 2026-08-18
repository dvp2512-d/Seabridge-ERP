/**
 * Audit log, read-only.
 *
 * There is deliberately no create, update or delete endpoint. Entries are written
 * by middleware as a side effect of the operations themselves, and a trail that
 * can be edited through the API is not a trail.
 *
 * Restricted to SETTINGS_MANAGE (founder and admin) because the log shows what
 * every user has been doing.
 */
import { Router } from 'express';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';

const router: Router = Router();

router.use(authenticate);

router.get('/', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    const { userId, action, entityType, entityId, from, to, page = 1, limit = 50 } = req.query;

    const where: any = {};
    if (userId) where.userId = String(userId);
    if (action) where.action = String(action);
    if (entityType) where.entityType = String(entityType).toUpperCase();
    if (entityId) where.entityId = String(entityId);
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(String(from));
      if (to) where.createdAt.lte = new Date(String(to));
    }

    // Cap the page size: the log grows without bound and an unbounded query
    // would eventually time out or exhaust memory.
    const take = Math.min(Number(limit) || 50, 200);
    const skip = (Number(page) - 1) * take;

    const [entries, total, actionGroups, entityGroups] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
        },
      }),
      prisma.auditLog.count({ where }),
      prisma.auditLog.groupBy({ by: ['action'], where, _count: { _all: true } }),
      prisma.auditLog.groupBy({
        by: ['entityType'],
        where,
        _count: { _all: true },
        orderBy: { _count: { entityType: 'desc' } },
        take: 20,
      }),
    ]);

    res.json({
      success: true,
      data: entries,
      pagination: { page: Number(page), limit: take, total },
      summary: {
        countByAction: Object.fromEntries(actionGroups.map((g) => [g.action, g._count._all])),
        entityTypes: entityGroups.map((g) => ({ entityType: g.entityType, count: g._count._all })),
      },
    });
  } catch (error) {
    next(error);
  }
});

/** Everything that has happened to one record, for tracing a specific change. */
router.get('/entity/:entityType/:entityId', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    const entries = await prisma.auditLog.findMany({
      where: {
        entityType: req.params.entityType.toUpperCase(),
        entityId: req.params.entityId,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    res.json({ success: true, data: entries });
  } catch (error) {
    next(error);
  }
});

export { router as auditRouter };
