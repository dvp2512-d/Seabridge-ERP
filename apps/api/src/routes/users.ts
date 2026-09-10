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
      // The Users form shows email as an editable, required field. Without it
      // here Zod stripped it silently: "User updated" but the email unchanged.
      email: z.string().email('Enter a valid email address').optional(),
      role: z.enum(['FOUNDER', 'SALES', 'OPERATIONS', 'FINANCE', 'ADMIN']).optional(),
      status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
      phone: z.string().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new ValidationError(validation.error.errors);

    // The same two lock-yourself-out cases the deactivate route guards against
    // are reachable through this route by sending status/role directly, so they
    // are enforced here too.
    const { status: newStatus, role: newRole } = validation.data;
    const losesActiveFounder =
      (newStatus !== undefined && newStatus !== 'ACTIVE') ||
      (newRole !== undefined && newRole !== 'FOUNDER');

    if (newStatus !== undefined && newStatus !== 'ACTIVE' && req.user?.id === req.params.id) {
      throw new AppError('You cannot deactivate your own account.', 400);
    }

    if (losesActiveFounder) {
      const current = await prisma.user.findUnique({
        where: { id: req.params.id },
        select: { role: true, status: true },
      });
      if (!current) throw new NotFoundError('User');

      if (current.role === 'FOUNDER' && current.status === 'ACTIVE') {
        const activeFounders = await prisma.user.count({
          where: { role: 'FOUNDER', status: 'ACTIVE' },
        });
        if (activeFounders <= 1) {
          throw new AppError(
            'This is the only active founder. Promote another user to FOUNDER before changing this one.',
            400
          );
        }
      }
    }

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

/**
 * Deactivate a user.
 *
 * This is a soft delete: the row is kept and its status set to INACTIVE. A user
 * is referenced as the actor on audit log entries, quotations, orders, payments
 * and tasks, so removing the row would either fail on a foreign key or strip the
 * author from historical records. Deactivating stops the login (see the status
 * check in middleware/auth.ts) while leaving history intact.
 *
 * Two guards, both of which are ways to lock everybody out of the system:
 *  - you cannot deactivate yourself
 *  - you cannot deactivate the last active FOUNDER
 */
router.delete('/:id', can('USER_MANAGE'), async (req, res, next) => {
  try {
    const targetId = req.params.id;

    if (req.user?.id === targetId) {
      throw new AppError('You cannot deactivate your own account.', 400);
    }

    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, role: true, status: true },
    });
    if (!target) throw new NotFoundError('User');

    if (target.status === 'INACTIVE') {
      throw new AppError('This user is already deactivated.', 400);
    }

    if (target.role === 'FOUNDER') {
      const activeFounders = await prisma.user.count({
        where: { role: 'FOUNDER', status: 'ACTIVE' },
      });
      if (activeFounders <= 1) {
        throw new AppError(
          'This is the only active founder. Promote another user to FOUNDER before deactivating this one.',
          400
        );
      }
    }

    const user = await prisma.user.update({
      where: { id: targetId },
      data: { status: 'INACTIVE' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
      },
    });

    res.json({ success: true, data: user, message: 'User deactivated' });
  } catch (error) {
    next(error);
  }
});

/** Restore a deactivated user. */
router.post('/:id/reactivate', can('USER_MANAGE'), async (req, res, next) => {
  try {
    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!target) throw new NotFoundError('User');

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { status: 'ACTIVE' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
      },
    });

    res.json({ success: true, data: user, message: 'User reactivated' });
  } catch (error) {
    next(error);
  }
});

export { router as userRouter };
