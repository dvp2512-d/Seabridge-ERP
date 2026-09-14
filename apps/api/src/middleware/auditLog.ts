/**
 * Audit logging.
 *
 * The audit_logs table existed but was never written to, so there was no record
 * of who changed a price, an exchange rate or a company bank account.
 *
 * Recorded after the response is sent, so a logging failure can never break the
 * operation that succeeded - an audit trail that takes down writes is worse than
 * one with a gap. For the same reason every failure here is swallowed and
 * reported to the console rather than thrown.
 */
import { Request, Response, NextFunction } from 'express';
import { prisma } from '@seabridge/database';
import { logger } from '../utils/logger';

/** Field names whose values must never be written to the log. */
const SENSITIVE_KEYS = [
  'password',
  'passwordhash',
  'token',
  'secret',
  'jwt',
  'authorization',
  'apikey',
  'api_key',
];

/**
 * Copy a payload with sensitive values masked.
 *
 * The audit log is read by more people than can see a password reset, and it is
 * retained far longer, so credentials are replaced rather than stored.
 */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value;

  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.some((s) => key.toLowerCase().includes(s))) {
        out[key] = '[redacted]';
      } else {
        out[key] = redact(val, depth + 1);
      }
    }
    return out;
  }

  return value;
}

/** Map an HTTP method to the audit action, or null when it is only a read. */
function actionFor(method: string): string | null {
  switch (method.toUpperCase()) {
    case 'POST':
      return 'CREATE';
    case 'PUT':
    case 'PATCH':
      return 'UPDATE';
    case 'DELETE':
      return 'DELETE';
    default:
      return null; // GET and HEAD are not changes
  }
}

/**
 * Derive the entity type from the route.
 *
 * "/api/invoices/:id/payments" is a payment against an invoice, so the last
 * meaningful path segment is used rather than the first.
 */
function entityTypeFor(path: string): string {
  const parts = path
    .replace(/^\/api\//, '')
    .split('/')
    .filter((p) => p && !/^[0-9a-f]{8,}$/i.test(p) && !/^c[a-z0-9]{20,}$/i.test(p));

  const last = parts[parts.length - 1] ?? 'unknown';
  // Trailing sub-resources like "status" describe the change, not the entity
  const descriptive = ['status', 'pdf', 'packing', 'convert-to-order', 'notification'];
  const meaningful = descriptive.includes(last) && parts.length > 1 ? parts[parts.length - 2] : last;

  return meaningful.replace(/-/g, '_').toUpperCase();
}

/** Pull a record id out of the response body or the route parameters. */
function entityIdFor(req: Request, body: any): string {
  return (
    body?.data?.id ??
    req.params?.id ??
    Object.values(req.params ?? {})[0] ??
    'unknown'
  );
}

/**
 * Record write operations that succeeded.
 *
 * Only 2xx responses are logged: a rejected request changed nothing, and logging
 * it would fill the trail with noise that hides the real changes.
 * 
 * For UPDATE/DELETE operations, attempts to capture oldValues by fetching the
 * record before the handler runs.
 */
export function auditLog(req: Request, res: Response, next: NextFunction) {
  const action = actionFor(req.method);
  if (!action) return next();

  // Capture the response body by wrapping json(), since the id of a created
  // record is only known once the handler has produced it.
  const originalJson = res.json.bind(res);
  let captured: any = null;
  let oldValues: any = null;

  res.json = (body: any) => {
    captured = body;
    return originalJson(body);
  };

  // For UPDATE/DELETE, try to fetch the record before modification
  const captureOldValues = async () => {
    if (action !== 'UPDATE' && action !== 'DELETE') return;
    
    const entityType = entityTypeFor(req.path);
    const entityId = req.params?.id ?? Object.values(req.params ?? {})[0];
    
    if (!entityId) return;

    // Map entity types to Prisma models
    const modelMap: Record<string, string> = {
      BUYERS: 'buyer',
      INVOICES: 'invoice',
      ORDERS: 'exportOrder',
      QUOTATIONS: 'quotation',
      INQUIRIES: 'inquiry',
      PRODUCTS: 'product',
      SUPPLIERS: 'supplier',
      USERS: 'user',
      EXPENSES: 'expense',
      INCOME: 'income',
      TASKS: 'task',
      WEBHOOKS: 'webhook',
      CHA: 'cha',
      TRANSPORTERS: 'transporter',
      COUNTRIES: 'country',
      PORTS: 'port',
      CURRENCIES: 'currency',
      INCOTERMS: 'incoterm',
      PRODUCT_CATEGORIES: 'productCategory',
      EXCHANGE_RATES: 'exchangeRate',
    };

    const model = modelMap[entityType];
    if (!model) return;

    try {
      // @ts-ignore - Dynamic model access
      const record = await (prisma as any)[model]?.findUnique({
        where: { id: entityId },
      });
      if (record) {
        oldValues = redact(record);
      }
    } catch (err) {
      // Silent fail - old values are nice to have, not critical
      logger.warn('Audit log failed to capture old values', { 
        entityType, 
        entityId, 
        error: (err as Error).message 
      });
    }
  };

  // Capture old values asynchronously, then proceed
  captureOldValues()
    .catch(() => {}) // Swallow any errors
    .finally(() => {
      res.on('finish', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return;

        const user = (req as any).user;

        // Fire and forget. The response has already gone out, so nothing here can
        // affect the caller.
        void prisma.auditLog
          .create({
            data: {
              userId: user?.id ?? null,
              action,
              entityType: entityTypeFor(req.path),
              entityId: String(entityIdFor(req, captured)),
              // The request body is what was asked for; the response is what
              // resulted. Storing the request keeps the log useful even when the
              // handler returns only an id.
              newValues: redact(req.body) as any,
              oldValues: oldValues as any,
              ipAddress:
                (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
                req.socket?.remoteAddress ??
                null,
              userAgent: (req.headers['user-agent'] as string) ?? null,
            },
          })
          .catch((error) => {
            // Never rethrow: the operation itself already succeeded.
            logger.error('Audit log failed to record entry', { error: (error as Error).message });
          });
      });

      next();
    });
}
