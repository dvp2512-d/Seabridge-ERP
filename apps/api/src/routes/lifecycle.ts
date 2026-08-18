/**
 * Deactivate, reactivate and preview endpoints for master data.
 *
 * Mounted as its own router so the nine master types share one implementation
 * rather than each route file repeating the same three handlers.
 *
 * Destructive actions require SETTINGS_MANAGE (founder and admin) rather than
 * MASTER_MANAGE, because MASTER_MANAGE includes SALES - deactivating a product
 * while someone else is quoting it is not a routine editing action.
 */
import { Router } from 'express';
import { authenticate, can } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import {
  deactivateRecord,
  reactivateRecord,
  previewDeactivation,
} from '../services/deactivationService';

const router: Router = Router();

router.use(authenticate);

/** URL segment -> internal type and the label shown to the user. */
const TYPES: Record<string, { type: string; label: string }> = {
  products: { type: 'product', label: 'Product' },
  suppliers: { type: 'supplier', label: 'Supplier' },
  buyers: { type: 'buyer', label: 'Buyer' },
  cha: { type: 'cha', label: 'CHA' },
  transporters: { type: 'transporter', label: 'Transporter' },
  countries: { type: 'country', label: 'Country' },
  ports: { type: 'port', label: 'Port' },
  currencies: { type: 'currency', label: 'Currency' },
  incoterms: { type: 'incoterm', label: 'Incoterm' },
  'product-categories': { type: 'productCategory', label: 'Product category' },
};

function resolve(segment: string) {
  const entry = TYPES[segment];
  if (!entry) {
    throw new AppError(
      `"${segment}" cannot be deactivated. Supported: ${Object.keys(TYPES).join(', ')}.`,
      400
    );
  }
  return entry;
}

/**
 * What deactivating would affect. Read-only, so it needs only view permission -
 * the confirmation dialog calls this before asking the user to commit.
 */
router.get('/:resource/:id/preview', can('MASTER_VIEW'), async (req, res, next) => {
  try {
    const { type } = resolve(req.params.resource);
    const preview = await previewDeactivation(type, req.params.id);
    res.json({ success: true, data: preview });
  } catch (error) {
    next(error);
  }
});

router.put('/:resource/:id/deactivate', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    const { type, label } = resolve(req.params.resource);
    const result = await deactivateRecord(type, req.params.id, label);
    res.json({ success: true, data: result, message: result.message });
  } catch (error) {
    next(error);
  }
});

router.put('/:resource/:id/reactivate', can('SETTINGS_MANAGE'), async (req, res, next) => {
  try {
    const { type, label } = resolve(req.params.resource);
    const result = await reactivateRecord(type, req.params.id, label);
    res.json({ success: true, data: result, message: result.message });
  } catch (error) {
    next(error);
  }
});

export { router as lifecycleRouter };
