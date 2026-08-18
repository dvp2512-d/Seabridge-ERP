import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { AppError, ValidationError, NotFoundError } from '../middleware/errorHandler';

const router: Router = Router();

router.use(authenticate);

// List users
router.get('/', can('USER_VIEW'), async (req, res, next) => {
  try {
    const { role, status, search } = req.query;

    const where: any = {};
    if (role) where.role = role;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { firstName: { contains: search as string, mode: 'insensitive' } },
        { lastName: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        phone: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: users });
  } catch (error) {
    next(error);
  }
});

// Get user by ID
router.get('/:id', can('USER_VIEW'), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        phone: true,
        lastLoginAt: true,
        createdAt: true,
        employee: true,
      },
    });

    if (!user) throw new NotFoundError('User');
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

// Create user
router.post('/', can('USER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(8),
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      role: z.enum(['FOUNDER', 'SALES', 'OPERATIONS', 'FINANCE', 'ADMIN']),
      phone: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const { password, ...data } = validation.data;
    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: { ...data, passwordHash },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
      },
    });

    res.status(201).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

// Update user
router.put('/:id', can('USER_MANAGE'), async (req, res, next) => {
  try {
    const schema = z.object({
      firstName: z.string().min(1).optional(),
      lastName: z.string().min(1).optional(),
      role: z.enum(['FOUNDER', 'SALES', 'OPERATIONS', 'FINANCE', 'ADMIN']).optional(),
      status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
      phone: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: validation.data,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
      },
    });

    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

// Delete user
router.delete('/:id', can('USER_MANAGE'), async (req, res, next) => {
  try {
    /**
     * Deactivate rather than delete.
     *
     * Tasks reference a user through assigneeId and createdById with ON DELETE
     * RESTRICT, so a real delete throws a raw database error for anyone who has
     * ever been given or created a task - which is everyone who has used the
     * system. The audit log points at users too, and losing that attribution
     * would defeat the trail.
     *
     * INACTIVE users cannot sign in, which is what "remove this person" actually
     * means in practice.
     */
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw new NotFoundError('User');

    // Removing your own access mid-session locks you out of your own system.
    if (target.id === (req as any).user?.id) {
      throw new AppError(
        'You cannot deactivate your own account. Ask another founder or admin to do it.',
        400
      );
    }

    // Leaving nobody who can administer the system is unrecoverable without
    // database access.
    if (target.role === 'FOUNDER') {
      const activeFounders = await prisma.user.count({
        where: { role: 'FOUNDER', status: 'ACTIVE' },
      });
      if (activeFounders <= 1) {
        throw new AppError(
          'This is the only active founder account. Promote another user first, or you will lock yourself out.',
          400
        );
      }
    }

    if (target.status === 'INACTIVE') {
      throw new AppError('This user is already inactive', 400);
    }

    await prisma.user.update({
      where: { id: req.params.id },
      data: { status: 'INACTIVE' },
    });

    res.json({
      success: true,
      message: `${target.firstName} ${target.lastName} can no longer sign in. Their tasks and history are unchanged.`,
    });
  } catch (error) {
    next(error);
  }
});

/** Restore access for a deactivated user. */
router.put('/:id/reactivate', can('USER_MANAGE'), async (req, res, next) => {
  try {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw new NotFoundError('User');

    if (target.status === 'ACTIVE') {
      throw new AppError('This user is already active', 400);
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { status: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true, status: true },
    });

    res.json({ success: true, data: updated, message: 'Access restored.' });
  } catch (error) {
    next(error);
  }
});

export { router as userRouter };
