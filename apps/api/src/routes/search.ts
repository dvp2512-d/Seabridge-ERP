/**
 * Global Search Routes
 * 
 * Search results are filtered based on user permissions:
 * - FINANCE_VIEW required for invoices
 * - SALES_VIEW required for inquiries and quotations
 * - OPERATIONS_VIEW required for orders
 * - BUYER_VIEW required for buyers
 * - MASTER_VIEW required for products and suppliers
 */
import { Router } from 'express';
import { authenticate, PERMISSIONS } from '../middleware/auth';
import { globalSearch } from '../services/searchService';
import { UserRole } from '@seabridge/database';

const router: Router = Router();

router.use(authenticate);

/**
 * Check if user's role has a specific permission
 */
function hasPermission(role: UserRole, permissionRoles: readonly UserRole[]): boolean {
  return permissionRoles.includes(role);
}

/**
 * Get allowed search types based on user's role
 */
function getAllowedSearchTypes(role: UserRole): string[] {
  const allowed: string[] = [];
  
  // Buyers - BUYER_VIEW
  if (hasPermission(role, PERMISSIONS.BUYER_VIEW)) {
    allowed.push('buyer');
  }
  
  // Inquiries and Quotations - SALES_VIEW
  if (hasPermission(role, PERMISSIONS.SALES_VIEW)) {
    allowed.push('inquiry', 'quotation');
  }
  
  // Orders - OPERATIONS_VIEW
  if (hasPermission(role, PERMISSIONS.OPERATIONS_VIEW)) {
    allowed.push('order');
  }
  
  // Invoices - FINANCE_VIEW
  if (hasPermission(role, PERMISSIONS.FINANCE_VIEW)) {
    allowed.push('invoice');
  }
  
  // Products and Suppliers - MASTER_VIEW
  if (hasPermission(role, PERMISSIONS.MASTER_VIEW)) {
    allowed.push('product', 'supplier');
  }
  
  return allowed;
}

// Global search endpoint
router.get('/', async (req: any, res, next) => {
  try {
    const { q, limit, types } = req.query;
    
    if (!q || typeof q !== 'string') {
      return res.json({
        success: true,
        data: {
          query: '',
          total: 0,
          results: [],
          categories: { buyers: 0, inquiries: 0, quotations: 0, orders: 0, invoices: 0, products: 0, suppliers: 0 },
        },
      });
    }

    // Get types the user is allowed to search based on their role
    const allowedTypes = getAllowedSearchTypes(req.user.role);
    
    // If user requested specific types, filter to only allowed ones
    let typeFilter: string[] | undefined;
    if (types) {
      const requestedTypes = (types as string).split(',');
      typeFilter = requestedTypes.filter(t => allowedTypes.includes(t));
      // If no requested types are allowed, return empty results
      if (typeFilter.length === 0) {
        return res.json({
          success: true,
          data: {
            query: q,
            total: 0,
            results: [],
            categories: { buyers: 0, inquiries: 0, quotations: 0, orders: 0, invoices: 0, products: 0, suppliers: 0 },
          },
        });
      }
    } else {
      // No specific types requested, use all allowed types
      typeFilter = allowedTypes;
    }
    
    const results = await globalSearch(q, {
      limit: limit ? parseInt(limit as string) : 20,
      types: typeFilter,
    });

    res.json({ success: true, data: results });
  } catch (error) {
    next(error);
  }
});

export { router as searchRouter };
