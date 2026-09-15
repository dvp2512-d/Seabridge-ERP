/**
 * Event dispatch for webhooks and automation rules.
 *
 * Webhooks could be created, listed and test-fired, but nothing ever triggered
 * them from a real event, so a configured webhook stayed silent while appearing
 * to work. This is what actually fires them.
 *
 * Design constraints, because a webhook talks to a system we do not control:
 *
 *  - Dispatch never blocks or fails the operation that caused it. Recording a
 *    payment must not fail because someone's endpoint is down.
 *  - Every attempt is logged with its status and duration, so a silent failure
 *    is visible rather than guessed at.
 *  - Requests time out. A hanging endpoint would otherwise pin a connection.
 *  - Payloads are signed when a secret is set, so the receiver can verify the
 *    call came from us.
 *  - Repeatedly failing webhooks are deactivated rather than retried forever.
 *  - URLs are validated to prevent SSRF attacks against internal networks.
 *  - Failed deliveries are retried with exponential backoff.
 */
import crypto from 'crypto';
import { prisma } from '@seabridge/database';
import { validateWebhookUrl, isObviouslyUnsafeUrl } from '../utils/urlValidator';
import { logger } from '../utils/logger';

/** Events the rest of the application can raise. */
export type DomainEvent =
  | 'inquiry.created'
  | 'quotation.created'
  | 'quotation.sent'
  | 'quotation.accepted'
  | 'order.created'
  | 'order.status_changed'
  | 'shipment.created'
  | 'shipment.status_changed'
  | 'invoice.created'
  | 'invoice.paid'
  | 'payment.recorded'
  | 'expense.approved'
  // Raised when payments against an expense settle it in full, so an integration
  // can reconcile an outgoing payment the same way it does an incoming one.
  | 'expense.paid';

const TIMEOUT_MS = 10_000;

/** A webhook failing this many times in a row is switched off. */
const MAX_CONSECUTIVE_FAILURES = 10;

/** Retry delays in milliseconds: 1m, 5m, 30m, 2h, 12h */
const RETRY_DELAYS_MS = [
  60 * 1000,        // 1 minute
  5 * 60 * 1000,    // 5 minutes
  30 * 60 * 1000,   // 30 minutes
  2 * 60 * 60 * 1000,  // 2 hours
  12 * 60 * 60 * 1000, // 12 hours
];

/**
 * Calculate next retry time with exponential backoff
 */
function getNextRetryDelay(failCount: number): number {
  const index = Math.min(failCount, RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[index];
}

/**
 * Sign the payload so the receiver can confirm it came from us.
 * HMAC-SHA256 over the exact body, which is the convention receivers expect.
 */
function sign(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/** Deliver to one webhook, recording the outcome either way. */
async function deliver(webhook: any, event: DomainEvent, payload: unknown): Promise<void> {
  /**
   * SSRF Protection: Validate URL with full DNS resolution before every request.
   *
   * URLs are validated at creation time, but an attacker could register a webhook
   * pointing to a domain they control, then change DNS to 169.254.169.254 after
   * creation. By re-validating at delivery time with DNS resolution, we catch
   * DNS rebinding attacks that would otherwise exfiltrate cloud instance metadata.
   *
   * First do a quick synchronous check to fail fast on obviously bad URLs,
   * then do the full async DNS resolution check.
   */
  if (isObviouslyUnsafeUrl(webhook.url)) {
    logger.warn('Webhook blocked: URL failed SSRF validation', { webhookName: webhook.name });
    try {
      await prisma.webhookLog.create({
        data: {
          webhookId: webhook.id,
          event,
          payload: { blocked: true, reason: 'SSRF protection' },
          status: 0,
          error: 'URL blocked by SSRF protection',
          duration: 0,
        },
      });
    } catch {}
    return;
  }

  // Full DNS resolution check to prevent DNS rebinding attacks
  const validation = await validateWebhookUrl(webhook.url);
  if (!validation.valid) {
    logger.warn('Webhook blocked: DNS rebinding SSRF attempt', { 
      webhookName: webhook.name,
      reason: validation.error 
    });
    try {
      await prisma.webhookLog.create({
        data: {
          webhookId: webhook.id,
          event,
          payload: { blocked: true, reason: 'DNS rebinding SSRF protection' },
          status: 0,
          error: `URL blocked: ${validation.error}`,
          duration: 0,
        },
      });
      // Increment fail count - this might be an attack in progress
      await prisma.webhook.update({
        where: { id: webhook.id },
        data: { failCount: { increment: 1 } },
      });
    } catch {}
    return;
  }

  const body = JSON.stringify({
    event,
    occurredAt: new Date().toISOString(),
    data: payload,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'SeaBridge-ERP-Webhook/1.0',
    'X-SeaBridge-Event': event,
  };
  if (webhook.secret) {
    headers['X-SeaBridge-Signature'] = `sha256=${sign(body, webhook.secret)}`;
  }

  const startedAt = Date.now();
  let status = 0;
  let responseText: string | null = null;
  let errorText: string | null = null;

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = response.status;
    // Keep a slice only: a receiver could return a large body and this is a log.
    responseText = (await response.text()).slice(0, 1000);
  } catch (error) {
    errorText = (error as Error).message;
  }

  const duration = Date.now() - startedAt;
  const succeeded = status >= 200 && status < 300;

  // Logging is best-effort; a logging failure must not surface to the caller.
  try {
    await prisma.webhookLog.create({
      data: {
        webhookId: webhook.id,
        event,
        payload: JSON.parse(body),
        status,
        response: responseText,
        error: errorText,
        duration,
      },
    });

    await prisma.webhook.update({
      where: { id: webhook.id },
      data: {
        lastTriggered: new Date(),
        lastStatus: status,
        // Reset on success so an occasional blip does not accumulate towards
        // deactivation.
        failCount: succeeded ? 0 : { increment: 1 },
        ...(!succeeded && webhook.failCount + 1 >= MAX_CONSECUTIVE_FAILURES
          ? { isActive: false }
          : {}),
      },
    });

    if (!succeeded && webhook.failCount + 1 >= MAX_CONSECUTIVE_FAILURES) {
      logger.warn('Webhook deactivated due to consecutive failures', {
        webhookName: webhook.name,
        failCount: MAX_CONSECUTIVE_FAILURES,
      });
    }
  } catch (error) {
    logger.error('Webhook failed to record delivery', { error: (error as Error).message });
  }
}

/**
 * Raise a domain event.
 *
 * Deliberately not awaited by callers: it returns immediately and delivers in the
 * background, so a slow or broken endpoint cannot delay a user's request. Any
 * failure is logged rather than thrown.
 */
export function emitEvent(event: DomainEvent, payload: unknown): void {
  void (async () => {
    try {
      const webhooks = await prisma.webhook.findMany({
        where: { isActive: true, events: { has: event } },
      });

      if (webhooks.length === 0) return;

      // Deliver in parallel; one bad endpoint should not hold up the others.
      await Promise.allSettled(webhooks.map((w) => deliver(w, event, payload)));
    } catch (error) {
      logger.error('Webhook dispatch failed', { event, error: (error as Error).message });
    }
  })();

  // Automation rules run on the same events.
  void runAutomations(event, payload);
}

/**
 * Automation rules.
 *
 * Only one action is supported: creating a task. That is deliberate - a general
 * rules engine invites configurations nobody can reason about, whereas "when
 * this happens, put it on someone's list" covers the cases that actually came up
 * and cannot cause damage if misconfigured.
 *
 * A rule's actions JSON is expected to look like:
 *   { "type": "CREATE_TASK", "title": "...", "assigneeId": "...", "dueInDays": 3 }
 */
async function runAutomations(event: DomainEvent, payload: any): Promise<void> {
  try {
    const rules = await prisma.automationRule.findMany({
      where: { isActive: true, trigger: event },
    });

    for (const rule of rules) {
      const action = rule.actions as any;

      if (!action || action.type !== 'CREATE_TASK') {
        // Unsupported action types are skipped loudly rather than silently, so a
        // rule that will never do anything is discoverable.
        logger.warn('Automation rule has unsupported action type - skipped', {
          ruleName: rule.name,
          actionType: action?.type,
        });
        continue;
      }

      if (!action.assigneeId) {
        logger.warn('Automation rule has no assigneeId - skipped', { ruleName: rule.name });
        continue;
      }

      // The assignee may have been deactivated since the rule was written.
      const assignee = await prisma.user.findUnique({ where: { id: action.assigneeId } });
      if (!assignee || assignee.status !== 'ACTIVE') {
        logger.warn('Automation rule targets an unavailable user - skipped', { ruleName: rule.name });
        continue;
      }

      await prisma.task.create({
        data: {
          title: String(action.title ?? `Follow up: ${event}`),
          description: action.description
            ? String(action.description)
            : `Created automatically by the rule "${rule.name}".`,
          assigneeId: action.assigneeId,
          // Automation has no user of its own, so the task is attributed to the
          // assignee rather than inventing a system account.
          createdById: action.assigneeId,
          priority: action.priority ?? 'MEDIUM',
          dueDate: action.dueInDays
            ? new Date(Date.now() + Number(action.dueInDays) * 86400000)
            : null,
          relatedType: action.relatedType ?? null,
          relatedId: payload?.id ? String(payload.id) : null,
        },
      });

      await prisma.automationRule.update({
        where: { id: rule.id },
        data: { lastRun: new Date(), runCount: { increment: 1 } },
      });
    }
  } catch (error) {
    logger.error('Automation failed', { event, error: (error as Error).message });
  }
}

/** Event names for the settings UI, kept in one place so they cannot drift. */
export const DOMAIN_EVENTS: DomainEvent[] = [
  'inquiry.created',
  'quotation.created',
  'quotation.sent',
  'quotation.accepted',
  'order.created',
  'order.status_changed',
  'shipment.created',
  'shipment.status_changed',
  'invoice.created',
  'invoice.paid',
  'payment.recorded',
  'expense.approved',
];

/**
 * Retry failed webhook deliveries with exponential backoff.
 * Should be called periodically (e.g., every minute via cron).
 * 
 * Checks WebhookLog entries that failed and schedules retries based on
 * the fail count and time since last attempt.
 */
export async function retryFailedWebhooks(): Promise<{ retried: number; succeeded: number }> {
  // Find webhooks with recent failures that are due for retry
  const failedLogs = await prisma.webhookLog.findMany({
    where: {
      status: { lt: 200 }, // Failed requests
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Last 24 hours
    },
    include: {
      webhook: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  // Group by webhook and get the most recent failure for each
  const webhookFailures = new Map<string, typeof failedLogs[0]>();
  for (const log of failedLogs) {
    if (!webhookFailures.has(log.webhookId)) {
      webhookFailures.set(log.webhookId, log);
    }
  }

  let retried = 0;
  let succeeded = 0;

  for (const [webhookId, lastFailure] of webhookFailures) {
    const webhook = lastFailure.webhook;
    
    // Skip if webhook is deactivated
    if (!webhook.isActive) continue;
    
    // Check if enough time has passed for retry
    const retryDelay = getNextRetryDelay(webhook.failCount);
    const timeSinceLastAttempt = Date.now() - lastFailure.createdAt.getTime();
    
    if (timeSinceLastAttempt < retryDelay) {
      continue; // Not yet time for retry
    }

    // Get the original payload from the failed log
    const payload = lastFailure.payload as any;
    if (!payload?.event || !payload?.data) continue;

    retried++;
    
    // Attempt redelivery
    try {
      await deliver(webhook, payload.event as DomainEvent, payload.data);
      
      // Check if it succeeded (by looking at the latest log)
      const latestLog = await prisma.webhookLog.findFirst({
        where: { webhookId },
        orderBy: { createdAt: 'desc' },
      });
      
      if (latestLog && latestLog.status >= 200 && latestLog.status < 300) {
        succeeded++;
        logger.info('Webhook retry succeeded', { webhookId, webhookName: webhook.name });
      }
    } catch (error) {
      logger.error('Webhook retry failed', { webhookId, error: (error as Error).message });
    }
  }

  if (retried > 0) {
    logger.info('Webhook retry batch completed', { retried, succeeded });
  }

  return { retried, succeeded };
}
