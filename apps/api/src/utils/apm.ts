/**
 * APM (Application Performance Monitoring) Integration Guide
 * 
 * This file documents how to add APM monitoring to SeaBridge ERP for production.
 * 
 * Recommended APM Solutions:
 * 
 * 1. AWS X-Ray (for AWS deployments)
 *    - Native AWS integration
 *    - Traces requests across services
 *    - npm install aws-xray-sdk
 * 
 * 2. Datadog APM
 *    - Comprehensive monitoring suite
 *    - npm install dd-trace
 *    - Requires DATADOG_API_KEY environment variable
 * 
 * 3. New Relic
 *    - Full-stack observability
 *    - npm install newrelic
 *    - Requires NEW_RELIC_LICENSE_KEY environment variable
 * 
 * 4. OpenTelemetry (vendor-neutral)
 *    - Works with multiple backends
 *    - npm install @opentelemetry/api @opentelemetry/sdk-node
 * 
 * Example: Adding OpenTelemetry tracing
 * =====================================
 * 
 * 1. Install dependencies:
 *    npm install @opentelemetry/api @opentelemetry/sdk-node \
 *                @opentelemetry/auto-instrumentations-node \
 *                @opentelemetry/exporter-trace-otlp-http
 * 
 * 2. Create instrumentation file (tracing.ts):
 * 
 *    import { NodeSDK } from '@opentelemetry/sdk-node';
 *    import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
 *    import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
 *    
 *    const sdk = new NodeSDK({
 *      serviceName: 'seabridge-api',
 *      traceExporter: new OTLPTraceExporter({
 *        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
 *      }),
 *      instrumentations: [getNodeAutoInstrumentations()],
 *    });
 *    
 *    sdk.start();
 * 
 * 3. Import tracing.ts at the top of index.ts (before other imports):
 *    import './tracing';
 * 
 * 4. Set environment variables:
 *    OTEL_EXPORTER_OTLP_ENDPOINT=https://your-collector:4318
 *    OTEL_SERVICE_NAME=seabridge-api
 * 
 * Metrics to Monitor:
 * ===================
 * - Request latency (p50, p95, p99)
 * - Error rate
 * - Database query time
 * - PDF generation time
 * - External API call time (exchange rates, webhooks)
 * - Memory usage
 * - Active connections
 * 
 * Key Transactions to Trace:
 * ==========================
 * - POST /api/orders (quotation → order conversion)
 * - GET /api/quotations/:id/pdf (PDF generation)
 * - POST /api/invoices/:id/payments (payment recording)
 * - GET /api/dashboard (aggregated queries)
 * 
 * The structured logger (utils/logger.ts) already outputs JSON logs suitable
 * for log aggregation systems. Combine with APM for complete observability.
 */

export const APM_READY = true;

// Example: Request timing middleware (works without external APM)
import { Request, Response, NextFunction } from 'express';
import { logger } from './logger';

/**
 * Simple request timing middleware.
 * Logs request duration for performance monitoring.
 * 
 * Usage: app.use(requestTiming);
 */
export function requestTiming(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  
  res.on('finish', () => {
    const durationNs = process.hrtime.bigint() - start;
    const durationMs = Number(durationNs / 1_000_000n);
    
    // Only log slow requests (> 500ms) in production to reduce noise
    if (process.env.NODE_ENV === 'production' && durationMs < 500) {
      return;
    }
    
    logger.info('Request completed', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs,
    });
  });
  
  next();
}
