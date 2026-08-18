/**
 * Tasks.
 *
 * Follow-ups attached to the work: chase a buyer, book a container, collect a
 * certificate. Every task has an assignee and a creator, and may point at a
 * record it relates to.
 *
 * Visibility follows role rather than being open to all: a salesperson sees the
 * tasks they created or were assigned, while founders and admins see everything.
 * Otherwise a shared task list becomes an unfiltered view of the whole company.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { AppError, ValidationError, NotFoundError } from '../middleware/errorHandler';

const router: Router = Router();

router.use(authenticate);

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
const RELATED_TYPES = ['INQUIRY', 'QUOTATION', 'ORDER', 'SHIPMENT', 'INVOICE', 'BUYER'] as const;

/** Founders and admins oversee everyone; everybody else sees their own work. */
function canSeeAllTasks(role?: string): boolean {
  return role === 'FOUNDER' || role === 'ADMIN';
}

// ---------------------------------------------------------------- list

router.get('/', can('OPERATIONS_VIEW'), async (req: any, res, next) => {
  try {
    const { status, priority, assigneeId, relatedType, relatedId, overdue, page = 1, limit = 50 } =
      req.query;

    const where: any = {};
    if (status) where.status = String(status);
    if (priority) where.priority = String(priority);
    if (assigneeId) where.assigneeId = String(assigneeId);
    if (relatedType) where.relatedType = String(relatedType);
    if (relatedId) where.relatedId = String(relatedId);

    // Past due and not finished. Tasks with no due date are never overdue.
    if (overdue === 'true') {
      where.dueDate = { lt: new Date() };
      where.status = { notIn: ['COMPLETED', 'CANCELLED'] };
    }

    // Scope to the caller unless their role oversees the team.
    if (!canSeeAllTasks(req.user?.role)) {
      where.OR = [{ assigneeId: req.user?.id }, { createdById: req.user?.id }];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [tasks, total, statusGroups, overdueCount] = await Promise.all([
      prisma.task.findMany({
        where,
        orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { priority: 'desc' }],
        skip,
        take: Number(limit),
        include: {
          assignee: { select: { id: true, firstName: true, lastName: true, role: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      prisma.task.count({ where }),
      prisma.task.groupBy({ by: ['status'], where, _count: { _all: true } }),
      prisma.task.count({
        where: {
          ...where,
          dueDate: { lt: new Date() },
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        },
      }),
    ]);

    const countByStatus: Record<string, number> = {};
    for (const group of statusGroups) countByStatus[group.status] = group._count._all;

    res.json({
      success: true,
      data: tasks,
      pagination: { page: Number(page), limit: Number(limit), total },
      summary: { countByStatus, overdueCount, scopedToSelf: !canSeeAllTasks(req.user?.role) },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', can('OPERATIONS_VIEW'), async (req: any, res, next) => {
  try {
    const task = await prisma.task.findUnique({
      where: { id: req.params.id },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true, role: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!task) throw new NotFoundError('Task');

    // Don't leak another user's task through a guessed id.
    if (
      !canSeeAllTasks(req.user?.role) &&
      task.assigneeId !== req.user?.id &&
      task.createdById !== req.user?.id
    ) {
      throw new AppError('You do not have access to this task', 403);
    }

    res.json({ success: true, data: task });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- create

const createSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  assigneeId: z.string().min(1, 'An assignee is required'),
  priority: z.enum(PRIORITIES).optional(),
  dueDate: z.string().optional(),
  relatedType: z.enum(RELATED_TYPES).optional(),
  relatedId: z.string().optional(),
  notes: z.string().optional(),
});

router.post('/', can('OPERATIONS_VIEW'), async (req: any, res, next) => {
  try {
    const validation = createSchema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const data = validation.data;

    // Assigning to a non-existent or deactivated user would hide the task from
    // everyone.
    const assignee = await prisma.user.findUnique({ where: { id: data.assigneeId } });
    if (!assignee) throw new AppError('The assigned user does not exist', 400);
    if (assignee.status !== 'ACTIVE') {
      throw new AppError(
        `Cannot assign a task to a user whose account is ${assignee.status}`,
        400
      );
    }

    // relatedId without relatedType (or the reverse) cannot be resolved later.
    if (Boolean(data.relatedType) !== Boolean(data.relatedId)) {
      throw new AppError('Give both the related record type and its id, or neither', 400);
    }

    const task = await prisma.task.create({
      data: {
        title: data.title,
        description: data.description,
        assigneeId: data.assigneeId,
        createdById: req.user.id,
        priority: data.priority ?? 'MEDIUM',
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        relatedType: data.relatedType,
        relatedId: data.relatedId,
        notes: data.notes,
      },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true, role: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    res.status(201).json({ success: true, data: task });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- update

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  assigneeId: z.string().optional(),
  priority: z.enum(PRIORITIES).optional(),
  status: z.enum(STATUSES).optional(),
  dueDate: z.string().nullable().optional(),
  notes: z.string().optional(),
});

router.put('/:id', can('OPERATIONS_VIEW'), async (req: any, res, next) => {
  try {
    const validation = updateSchema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const existing = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Task');

    const isOwn = existing.assigneeId === req.user?.id || existing.createdById === req.user?.id;
    if (!canSeeAllTasks(req.user?.role) && !isOwn) {
      throw new AppError('You do not have access to this task', 403);
    }

    // Reassigning someone else's work is an oversight action, not a peer one.
    if (validation.data.assigneeId && validation.data.assigneeId !== existing.assigneeId) {
      if (!canSeeAllTasks(req.user?.role) && existing.createdById !== req.user?.id) {
        throw new AppError('Only the task creator or an admin can reassign a task', 403);
      }
      const assignee = await prisma.user.findUnique({
        where: { id: validation.data.assigneeId },
      });
      if (!assignee) throw new AppError('The assigned user does not exist', 400);
      if (assignee.status !== 'ACTIVE') {
        throw new AppError(
          `Cannot assign a task to a user whose account is ${assignee.status}`,
          400
        );
      }
    }

    const { dueDate, status, ...rest } = validation.data;

    const task = await prisma.task.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        ...(status ? { status } : {}),
        ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
        // Stamp completion so "how long did that take" is answerable, and clear
        // it if the task is reopened.
        ...(status === 'COMPLETED' && existing.status !== 'COMPLETED'
          ? { completedAt: new Date() }
          : {}),
        ...(status && status !== 'COMPLETED' && existing.status === 'COMPLETED'
          ? { completedAt: null }
          : {}),
      },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true, role: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    res.json({ success: true, data: task });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', can('OPERATIONS_VIEW'), async (req: any, res, next) => {
  try {
    const existing = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Task');

    // Deleting removes history, so restrict it to the creator or an admin.
    if (!canSeeAllTasks(req.user?.role) && existing.createdById !== req.user?.id) {
      throw new AppError('Only the task creator or an admin can delete a task', 403);
    }

    await prisma.task.delete({ where: { id: req.params.id } });
    res.json({ success: true, data: { id: existing.id } });
  } catch (error) {
    next(error);
  }
});

router.get('/meta/options', can('OPERATIONS_VIEW'), async (_req, res) => {
  res.json({
    success: true,
    data: { priorities: PRIORITIES, statuses: STATUSES, relatedTypes: RELATED_TYPES },
  });
});

export { router as taskRouter };
