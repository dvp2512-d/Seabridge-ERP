/**
 * Market exchange rates, advisory only.
 *
 * There is no stored exchange rate in this system. Every amount is INR, and a
 * currency and rate are chosen when a quotation or invoice PDF is generated, then
 * recorded on that document. This route exists purely to suggest a sensible number
 * in that dialog, so a transposed digit is obvious before the document goes out.
 *
 * Nothing here writes anything, and a provider outage is reported as
 * "unavailable" rather than failing the request - the operator's typed rate is
 * always what gets used.
 */
import { Router } from 'express';
import { authenticate, can } from '../middleware/auth';
import { getBaseCurrency } from '../services/exchangeRateService';

const router: Router = Router();

router.use(authenticate);

router.get('/market-check', can('MASTER_VIEW'), async (_req, res, next) => {
  try {
    const base = await getBaseCurrency();

    // No API key needed, and a failure here must not block rate entry.
    const response = await fetch(`https://open.er-api.com/v6/latest/${base.code}`, {
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return res.json({
        success: true,
        data: { available: false, reason: `provider returned ${response.status}` },
      });
    }

    const payload: any = await response.json();
    const perBase: Record<string, number> = payload?.rates ?? {};

    // The provider gives foreign-per-base; documents need base-per-foreign, which
    // is how an exporter states a rate ("1 USD = 95.65").
    const inverted: Record<string, number> = {};
    for (const [code, value] of Object.entries(perBase)) {
      if (typeof value === 'number' && value > 0) {
        inverted[code] = Math.round((1 / value) * 10000) / 10000;
      }
    }

    res.json({
      success: true,
      data: {
        available: true,
        baseCode: base.code,
        asOf: payload?.time_last_update_utc ?? null,
        ratesPerForeignUnit: inverted,
      },
    });
  } catch (error) {
    // Advisory only, so a provider outage returns "unavailable" rather than 500.
    res.json({
      success: true,
      data: { available: false, reason: (error as Error).message },
    });
  }
});

export { router as exchangeRateRouter };
