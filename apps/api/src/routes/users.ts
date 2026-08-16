import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@seabridge/database';
import { authenticate, can } from '../middleware/auth';
import { ValidationError, NotFoundError } from '../middleware/errorHandler';

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
    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'User deleted' });
  } catch (error) {
    next(error);
  }
});

export { router as userRouter };
