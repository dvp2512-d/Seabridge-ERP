/**
 * Activity Timeline Routes
 * 
 * Each entity type requires the appropriate VIEW permission:
 * - buyers: BUYER_VIEW
 * - orders: OPERATIONS_VIEW
 * - invoices: FINANCE_VIEW
 * - inquiries, quotations: SALES_VIEW
 * - expenses, income, payments: FINANCE_VIEW
 */
import { Router } from 'express';
import { authenticate, can, PERMISSIONS } from '../middleware/auth';
import { ForbiddenError } from '../middleware/errorHandler';
import {
  getBuyerTimeline,
  getOrderTimeline,
  getInvoiceTimeline,
  getEntityTimeline,
} from '../services/timelineService';
import { UserRole } from '@seabridge/database';

const router: Router = Router();

router.use(authenticate);

/**
 * Map entity types to required permissions
 */
const ENTITY_PERMISSIONS: Record<string, keyof typeof PERMISSIONS> = {
  buyers: 'BUYER_VIEW',
  buyer: 'BUYER_VIEW',
  orders: 'OPERATIONS_VIEW',
  order: 'OPERATIONS_VIEW',
  invoices: 'FINANCE_VIEW',
  invoice: 'FINANCE_VIEW',
  inquiries: 'SALES_VIEW',
  inquiry: 'SALES_VIEW',
  quotations: 'SALES_VIEW',
  quotation: 'SALES_VIEW',
  expenses: 'FINANCE_VIEW',
  expense: 'FINANCE_VIEW',
  income: 'FINANCE_VIEW',
  payments: 'FINANCE_VIEW',
  payment: 'FINANCE_VIEW',
  products: 'MASTER_VIEW',
  product: 'MASTER_VIEW',
  suppliers: 'MASTER_VIEW',
  supplier: 'MASTER_VIEW',
  procurements: 'OPERATIONS_VIEW',
  procurement: 'OPERATIONS_VIEW',
  shipments: 'OPERATIONS_VIEW',
  shipment: 'OPERATIONS_VIEW',
};

/**
 * Check if user has permission for an entity type
 */
function checkEntityPermission(entityType: string, userRole: UserRole): boolean {
  const permissionKey = ENTITY_PERMISSIONS[entityType.toLowerCase()];
  if (!permissionKey) {
    // Unknown entity type - default to requiring ADMIN/FOUNDER
    return userRole === 'FOUNDER' || userRole === 'ADMIN';
  }
  const allowedRoles = PERMISSIONS[permissionKey] as readonly UserRole[];
  return allowedRoles.includes(userRole);
}

// Get buyer timeline
router.get('/buyers/:id', can('BUYER_VIEW'), async (req, res, next) => {
  try {
    const timeline = await getBuyerTimeline(req.params.id);
    res.json({ success: true, data: timeline });
  } catch (error) {
    next(error);
  }
});

// Get order timeline
router.get('/orders/:id', can('OPERATIONS_VIEW'), async (req, res, next) => {
  try {
    const timeline = await getOrderTimeline(req.params.id);
    res.json({ success: true, data: timeline });
  } catch (error) {
    next(error);
  }
});

// Get invoice timeline
router.get('/invoices/:id', can('FINANCE_VIEW'), async (req, res, next) => {
  try {
    const timeline = await getInvoiceTimeline(req.params.id);
    res.json({ success: true, data: timeline });
  } catch (error) {
    next(error);
  }
});

// Generic entity timeline - with permission check
router.get('/:entityType/:id', async (req: any, res, next) => {
  try {
    const { entityType, id } = req.params;
    
    // Check permission based on entity type
    if (!checkEntityPermission(entityType, req.user.role)) {
      throw new ForbiddenError(`You do not have permission to view ${entityType} timeline`);
    }
    
    const timeline = await getEntityTimeline(entityType, id);
    res.json({ success: true, data: timeline });
  } catch (error) {
    next(error);
  }
});

export { router as timelineRouter };
