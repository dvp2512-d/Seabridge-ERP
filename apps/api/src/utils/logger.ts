/**
 * Structured JSON logger for production observability.
 *
 * In production (NODE_ENV=production), outputs machine-parseable JSON logs that
 * can be ingested by log aggregation systems (CloudWatch, Datadog, Splunk).
 *
 * In development, outputs human-readable logs with colors for easy debugging.
 *
 * Security: All log context is automatically redacted for sensitive fields
 * (passwords, tokens, secrets, API keys) to prevent credential leakage.
 *
 * Usage:
 *   import { logger } from './utils/logger';
 *   logger.info('Server started', { port: 4000 });
 *   logger.error('Request failed', { error: err.message, requestId: req.id });
 */
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestId?: string;
  [key: string]: unknown;
}

const isProduction = process.env.NODE_ENV === 'production';

// Store current request ID in async local storage alternative
let currentRequestId: string | undefined;

export function setRequestId(id: string | undefined) {
  currentRequestId = id;
}

export function getRequestId(): string | undefined {
  return currentRequestId;
}

/** Field names whose values must never appear in logs. Case-insensitive partial match. */
const SENSITIVE_KEYS = [
  'password',
  'passwordhash',
  'token',
  'secret',
  'jwt',
  'authorization',
  'apikey',
  'api_key',
  'bearer',
  'credential',
  'private',
];

/**
 * Recursively redact sensitive values from log context.
 * 
 * Matches field names case-insensitively and replaces values with '[REDACTED]'.
 * Handles nested objects and arrays up to 6 levels deep to prevent infinite loops.
 */
function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map((v) => redactSensitive(v, depth + 1));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const keyLower = key.toLowerCase();
      if (SENSITIVE_KEYS.some((s) => keyLower.includes(s))) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = redactSensitive(val, depth + 1);
      }
    }
    return out;
  }

  return value;
}

// ANSI colors for development
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function formatDev(entry: LogEntry): string {
  const { timestamp, level, message, ...rest } = entry;
  const time = colors.dim + timestamp.split('T')[1]?.replace('Z', '') + colors.reset;
  
  const levelColors: Record<LogLevel, string> = {
    debug: colors.cyan,
    info: colors.blue,
    warn: colors.yellow,
    error: colors.red,
  };
  
  const levelStr = levelColors[level] + level.toUpperCase().padEnd(5) + colors.reset;
  const extra = Object.keys(rest).length > 0 ? ' ' + JSON.stringify(rest) : '';
  
  return `${time} ${levelStr} ${message}${extra}`;
}

function formatProd(entry: LogEntry): string {
  return JSON.stringify(entry);
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  // Redact sensitive fields from context before logging
  const safeContext = context ? redactSensitive(context) as Record<string, unknown> : undefined;
  
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(currentRequestId && { requestId: currentRequestId }),
    ...safeContext,
  };

  const output = isProduction ? formatProd(entry) : formatDev(entry);
  
  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => log('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => log('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => log('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => log('error', message, context),
};

/**
 * Create a child logger with preset context fields.
 * Useful for adding request IDs or service names.
 */
export function createLogger(baseContext: Record<string, unknown>) {
  return {
    debug: (message: string, context?: Record<string, unknown>) =>
      log('debug', message, { ...baseContext, ...context }),
    info: (message: string, context?: Record<string, unknown>) =>
      log('info', message, { ...baseContext, ...context }),
    warn: (message: string, context?: Record<string, unknown>) =>
      log('warn', message, { ...baseContext, ...context }),
    error: (message: string, context?: Record<string, unknown>) =>
      log('error', message, { ...baseContext, ...context }),
  };
}

/**
 * Generate a short unique request ID
 */
export function generateRequestId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Middleware to attach request ID to each request
 * Also logs request start and completion
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  // Use existing request ID from header or generate new one
  const requestId = (req.headers['x-request-id'] as string) || generateRequestId();
  
  // Attach to request object for access in handlers
  (req as any).requestId = requestId;
  
  // Set response header so client can reference it
  res.setHeader('X-Request-ID', requestId);
  
  // Set for logger context
  setRequestId(requestId);
  
  // Log request start
  const startTime = Date.now();
  
  // Log on response finish
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    setRequestId(requestId); // Restore in case it was changed
    
    // Only log API requests (not static files)
    if (req.path.startsWith('/api') || req.path === '/health') {
      logger.info('Request completed', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration,
      });
    }
    
    setRequestId(undefined);
  });
  
  next();
}
