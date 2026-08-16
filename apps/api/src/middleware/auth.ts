import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma, UserRole } from '@seabridge/database';
import { UnauthorizedError, ForbiddenError } from './errorHandler';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  firstName: string;
  lastName: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('No token provided');
    }

    const token = authHeader.split(' ')[1];
    const secret = process.env.JWT_SECRET || 'default_secret';

    const decoded = jwt.verify(token, secret) as { userId: string };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        role: true,
        firstName: true,
        lastName: true,
        status: true,
      },
    });

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedError('Account is not active');
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new UnauthorizedError('Invalid token'));
    } else if (error instanceof jwt.TokenExpiredError) {
      next(new UnauthorizedError('Token expired'));
    } else {
      next(error);
    }
  }
};

// Role-based access control
export const authorize = (...allowedRoles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError('Not authenticated'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(new ForbiddenError('You do not have permission to perform this action'));
    }

    next();
  };
};

// Permission matrix for different operations
export const PERMISSIONS = {
  // Dashboard - Founder sees all, others see their scope
  DASHBOARD_FULL: [UserRole.FOUNDER, UserRole.ADMIN],
  DASHBOARD_SALES: [UserRole.FOUNDER, UserRole.ADMIN, UserRole.SALES],
  DASHBOARD_OPERATIONS: [UserRole.FOUNDER, UserRole.ADMIN, UserRole.OPERATIONS],
  DASHBOARD_FINANCE: [UserRole.FOUNDER, UserRole.ADMIN, UserRole.FINANCE],

  // Master Data - Admin/Founder can manage, others can view
  MASTER_MANAGE: [UserRole.FOUNDER, UserRole.ADMIN],
  MASTER_VIEW: [UserRole.FOUNDER, UserRole.ADMIN, UserRole.SALES, UserRole.OPERATIONS, UserRole.FINANCE],

  // CRM/Buyers
  BUYER_MANAGE: [UserRole.FOUNDER, UserRole.ADMIN, UserRole.SALES],
  BUYER_VIEW: [UserRole.FOUNDER, UserRole.ADMIN, UserRole.SALES, UserRole.OPERATIONS, UserRole.FINANCE],

  // Sales/Inquiries/Quotations
  SALES_MANAGE: [UserRole.FOUNDER, UserRole.ADMIN, UserRole.SALES],
  SALES_VIEW: [UserRole.FOUNDER, UserRole.ADMIN, UserRole.SALES, UserRole.OPERATIONS],

  // Orders/Operations
  OPERATIONS_MANAGE: [UserRole.FOUNDER, UserRole.ADMIN, UserRole.OPERATIONS],
  OPERATIONS_VIEW: [UserRole.FOUNDER, UserRole.ADMIN, UserRole.SALES, UserRole.OPERATIONS, UserRole.FINANCE],

  // Finance
  FINANCE_MANAGE: [UserRole.FOUNDER, UserRole.ADMIN, UserRole.FINANCE],
  FINANCE_VIEW: [UserRole.FOUNDER, UserRole.ADMIN, UserRole.FINANCE],

  // Users
  USER_MANAGE: [UserRole.FOUNDER, UserRole.ADMIN],
  USER_VIEW: [UserRole.FOUNDER, UserRole.ADMIN],

  // System settings, templates, webhooks and automation rules
  SETTINGS_MANAGE: [UserRole.FOUNDER, UserRole.ADMIN],
  SETTINGS_VIEW: [UserRole.FOUNDER, UserRole.ADMIN, UserRole.SALES, UserRole.OPERATIONS, UserRole.FINANCE],
};

export const can = (permission: keyof typeof PERMISSIONS) => {
  return authorize(...PERMISSIONS[permission]);
};
