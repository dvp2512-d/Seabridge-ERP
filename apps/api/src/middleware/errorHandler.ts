import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  errors: any[];

  constructor(errors: any[]) {
    super('Validation failed', 400);
    this.errors = errors;
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Access forbidden') {
    super(message, 403);
  }
}

/**
 * Catch-all for unmatched routes.
 *
 * Without this Express replies with an HTML error page, which breaks the
 * frontend's JSON parsing and surfaces as a confusing error.
 */
export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
};

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error(`[${req.method} ${req.originalUrl}]`, err.message);

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err instanceof ValidationError && { errors: err.errors }),
    });
  }

  // Malformed JSON body
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({
      success: false,
      message: 'Request body is not valid JSON',
    });
  }

  // Known Prisma request errors
  if (err.name === 'PrismaClientKnownRequestError') {
    const prismaError = err as any;
    const target = Array.isArray(prismaError.meta?.target)
      ? prismaError.meta.target.join(', ')
      : prismaError.meta?.target;

    switch (prismaError.code) {
      case 'P2002':
        return res.status(409).json({
          success: false,
          message: target
            ? `A record with this ${target} already exists`
            : 'A record with this value already exists',
        });
      case 'P2025':
        return res.status(404).json({
          success: false,
          message: prismaError.meta?.cause || 'Record not found',
        });
      case 'P2003':
        return res.status(400).json({
          success: false,
          message:
            'This record is linked to other records and cannot be changed or removed',
        });
      case 'P2014':
        return res.status(400).json({
          success: false,
          message: 'This change would break a required relationship between records',
        });
      default:
        return res.status(400).json({
          success: false,
          message: `Database request failed (${prismaError.code})`,
        });
    }
  }

  // Bad arguments passed to Prisma - a programming error, but never return a 500
  // body that leaks the full query in production.
  if (err.name === 'PrismaClientValidationError') {
    return res.status(400).json({
      success: false,
      message:
        process.env.NODE_ENV === 'production'
          ? 'Invalid data supplied'
          : err.message,
    });
  }

  // Cannot reach the database
  if (err.name === 'PrismaClientInitializationError') {
    return res.status(503).json({
      success: false,
      message: 'Database is unavailable. Please try again shortly.',
    });
  }

  // Default error
  return res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message,
  });
};
