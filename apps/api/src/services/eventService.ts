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
 */
import crypto from 'crypto';
import { prisma } from '@seabridge/database';
import { isObviouslyUnsafeUrl } from '../utils/urlValidator';

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
  | 'expense.approved';

const TIMEOUT_MS = 10_000;

/** A webhook failing this many times in a row is switched off. */
const MAX_CONSECUTIVE_FAILURES = 10;

/**
 * Sign the payload so the receiver can confirm it came from us.
 * HMAC-SHA256 over the exact body, which is the convention receivers expect.
 */
function sign(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/** Deliver to one webhook, recording the outcome either way. */
async function deliver(webhook: any, event: DomainEvent, payload: unknown): Promise<void> {
  // SSRF Protection: Validate URL before making request
  if (isObviouslyUnsafeUrl(webhook.url)) {
    console.warn(`[webhook] "${webhook.name}" blocked: URL failed SSRF validation`);
    // Log the blocked attempt
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
      console.warn(
        `[webhook] "${webhook.name}" deactivated after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`
      );
    }
  } catch (error) {
    console.error('[webhook] failed to record delivery:', (error as Error).message);
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
      console.error(`[webhook] dispatch failed for ${event}:`, (error as Error).message);
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
        console.warn(
          `[automation] rule "${rule.name}" has unsupported action type "${action?.type}" - skipped`
        );
        continue;
      }

      if (!action.assigneeId) {
        console.warn(`[automation] rule "${rule.name}" has no assigneeId - skipped`);
        continue;
      }

      // The assignee may have been deactivated since the rule was written.
      const assignee = await prisma.user.findUnique({ where: { id: action.assigneeId } });
      if (!assignee || assignee.status !== 'ACTIVE') {
        console.warn(
          `[automation] rule "${rule.name}" targets an unavailable user - skipped`
        );
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
    console.error(`[automation] failed for ${event}:`, (error as Error).message);
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
