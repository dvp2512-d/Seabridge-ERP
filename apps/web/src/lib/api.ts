import axios from 'axios';
import { useAuthStore } from '@/store/authStore';

/**
 * Resolve the API base URL.
 *
 * Every backend route is mounted under `/api`, so the base URL must always end
 * with `/api`. In development VITE_API_URL is left empty and Vite's dev-server
 * proxy forwards `/api` to the API container/process.
 */
function resolveBaseUrl(): string {
  const configured = import.meta.env.VITE_API_URL?.trim();
  if (!configured) return '/api';

  const withoutTrailingSlash = configured.replace(/\/+$/, '');
  return withoutTrailingSlash.endsWith('/api')
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}/api`;
}

const api = axios.create({
  baseURL: resolveBaseUrl(),
  headers: {
    'Content-Type': 'application/json',
  },
  // Prevent hung requests from blocking indefinitely
  timeout: 30000,
});

// Request interceptor - attach the bearer token to every call
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor - handle expired sessions once, globally
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;

    // Only force a logout for genuine auth failures, and don't redirect if the
    // user is already on the login page (prevents a reload loop).
    if (status === 401 && window.location.pathname !== '/login') {
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }

    return Promise.reject(error);
  }
);

/**
 * Extract a human-readable message from an API error so pages can surface
 * something useful instead of a generic failure toast.
 */
export function getApiErrorMessage(error: any, fallback = 'Something went wrong'): string {
  return (
    error?.response?.data?.message ||
    error?.response?.data?.error?.message ||
    error?.message ||
    fallback
  );
}

// ============================================
// AUTH API
// ============================================

export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  
  register: (data: { email: string; password: string; firstName: string; lastName: string; role?: string }) =>
    api.post('/auth/register', data),
  
  me: () => api.get('/auth/me'),

  /** Update your own display details. Role and email are not editable here. */
  updateMe: (data: { firstName?: string; lastName?: string; phone?: string | null }) =>
    api.patch('/auth/me', data),
  
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),
};

// ============================================
// MASTER DATA API
// ============================================

export const masterApi = {
  getDropdowns: () => api.get('/master/dropdowns'),
  
  // Countries
  getCountries: (params?: any) => api.get('/master/countries', { params }),
  createCountry: (data: any) => api.post('/master/countries', data),
  updateCountry: (id: string, data: any) => api.put(`/master/countries/${id}`, data),
  
  // Ports
  getPorts: (params?: any) => api.get('/master/ports', { params }),
  createPort: (data: any) => api.post('/master/ports', data),
  updatePort: (id: string, data: any) => api.put(`/master/ports/${id}`, data),
  
  // Currencies
  getCurrencies: (params?: any) => api.get('/master/currencies', { params }),
  createCurrency: (data: any) => api.post('/master/currencies', data),
  updateCurrency: (id: string, data: any) => api.put(`/master/currencies/${id}`, data),
  
  // Incoterms
  getIncoterms: (params?: any) => api.get('/master/incoterms', { params }),
  createIncoterm: (data: any) => api.post('/master/incoterms', data),
  updateIncoterm: (id: string, data: any) => api.put(`/master/incoterms/${id}`, data),
  
  // Product Categories
  getProductCategories: (params?: any) => api.get('/master/product-categories', { params }),
  createProductCategory: (data: any) => api.post('/master/product-categories', data),
  updateProductCategory: (id: string, data: any) =>
    api.put(`/master/product-categories/${id}`, data),
};

// ============================================
// BUYERS API
// ============================================

export const buyersApi = {
  list: (params?: any) => api.get('/buyers', { params }),
  get: (id: string) => api.get(`/buyers/${id}`),
  create: (data: any) => api.post('/buyers', data),
  update: (id: string, data: any) => api.put(`/buyers/${id}`, data),
  delete: (id: string) => api.delete(`/buyers/${id}`),
  addContact: (id: string, data: any) => api.post(`/buyers/${id}/contacts`, data),
  updateContact: (id: string, contactId: string, data: any) =>
    api.put(`/buyers/${id}/contacts/${contactId}`, data),
  addCommunication: (id: string, data: any) => api.post(`/buyers/${id}/communications`, data),
  // Export to CSV - returns blob
  exportCsv: (params?: { status?: string; countryId?: string }) =>
    api.get('/buyers/export/csv', { params, responseType: 'blob' }),
};

// ============================================
// PRODUCTS API
// ============================================

export const productsApi = {
  list: (params?: any) => api.get('/products', { params }),
  get: (id: string) => api.get(`/products/${id}`),
  create: (data: any) => api.post('/products', data),
  update: (id: string, data: any) => api.put(`/products/${id}`, data),
};

// ============================================
// SUPPLIERS API
// ============================================

export const suppliersApi = {
  list: (params?: any) => api.get('/suppliers', { params }),
  get: (id: string) => api.get(`/suppliers/${id}`),
  create: (data: any) => api.post('/suppliers', data),
  update: (id: string, data: any) => api.put(`/suppliers/${id}`, data),
  addPrice: (id: string, data: any) => api.post(`/suppliers/${id}/prices`, data),
};

// ============================================
// CHA API
// ============================================

export const chaApi = {
  list: (params?: any) => api.get('/cha', { params }),
  get: (id: string) => api.get(`/cha/${id}`),
  create: (data: any) => api.post('/cha', data),
  update: (id: string, data: any) => api.put(`/cha/${id}`, data),
  addRate: (id: string, data: any) => api.post(`/cha/${id}/rates`, data),
};

// ============================================
// TRANSPORTERS API
// ============================================

export const transportersApi = {
  list: (params?: any) => api.get('/transporters', { params }),
  get: (id: string) => api.get(`/transporters/${id}`),
  create: (data: any) => api.post('/transporters', data),
  update: (id: string, data: any) => api.put(`/transporters/${id}`, data),
  addRate: (id: string, data: any) => api.post(`/transporters/${id}/rates`, data),
};

// ============================================
// INQUIRIES API
// ============================================

export const inquiriesApi = {
  list: (params?: any) => api.get('/inquiries', { params }),
  get: (id: string) => api.get(`/inquiries/${id}`),
  create: (data: any) => api.post('/inquiries', data),
  update: (id: string, data: any) => api.put(`/inquiries/${id}`, data),
  addItem: (id: string, data: any) => api.post(`/inquiries/${id}/items`, data),
  addFollowUp: (id: string, data: any) => api.post(`/inquiries/${id}/followups`, data),
};

// ============================================
// QUOTATIONS API
// ============================================

export const quotationsApi = {
  list: (params?: any) => api.get('/quotations', { params }),
  get: (id: string) => api.get(`/quotations/${id}`),
  create: (data: any) => api.post('/quotations', data),
  update: (id: string, data: any) => api.put(`/quotations/${id}`, data),
  updateStatus: (id: string, status: string, notes?: string) => 
    api.patch(`/quotations/${id}/status`, { status, notes }),
  convertToOrder: (id: string, data: any) => api.post(`/quotations/${id}/convert-to-order`, data),
  /**
   * Amounts are stored in INR; `currency` and `rate` decide how the buyer's copy
   * reads and are recorded on the quotation. Omit them to reuse whatever it was
   * last generated with.
   */
  downloadPdf: (id: string, currency?: string, rate?: number) =>
    api.get(`/quotations/${id}/pdf`, {
      responseType: 'blob',
      params: currency ? { currency, rate } : undefined,
    }),
  // Revision tracking
  getHistory: (id: string) => api.get(`/quotations/${id}/history`),
  revise: (id: string, data: { revisionReason: string; validUntil?: string; paymentTerms?: string; deliveryTerms?: string; notes?: string; items?: any[]; costs?: any[] }) =>
    api.post(`/quotations/${id}/revise`, data),
};

// ============================================
// ORDERS API
// ============================================

export const ordersApi = {
  list: (params?: any) => api.get('/orders', { params }),
  get: (id: string) => api.get(`/orders/${id}`),
  create: (data: any) => api.post('/orders', data),
  update: (id: string, data: any) => api.put(`/orders/${id}`, data),
  addProcurement: (id: string, data: any) => api.post(`/orders/${id}/procurements`, data),
  addShipment: (id: string, data: any) => api.post(`/orders/${id}/shipments`, data),
  /**
   * Per-document readiness: which printed boxes would be blank if each document
   * were generated now, and when each was last produced.
   */
  documentReadiness: (id: string) => api.get(`/orders/${id}/document-readiness`),
  /**
   * Fill every line's packing figures from the packing agreed on the quotation and the
   * product's standard pack. Only fills what is empty unless overwrite is asked for.
   */
  fillPacking: (orderId: string, overwrite = false) =>
    api.post(`/orders/${orderId}/items/fill-packing`, { overwrite }),
  /**
   * Update a line's packing figures - packages, weight per package, net and gross.
   * These four are the Packing List and the weight block on every invoice.
   */
  updateOrderItem: (orderId: string, itemId: string, data: any) =>
    api.put(`/orders/${orderId}/items/${itemId}`, data),
  /**
   * Suggested purchase order lines for a supplier: the order's products, priced
   * from that supplier's price list, with GST from each product. Nothing is saved.
   */
  suggestProcurement: (orderId: string, supplierId: string) =>
    api.get(`/orders/${orderId}/procurements/suggest`, { params: { supplierId } }),
  /**
   * Update a supplier purchase order. Changing the amount moves the matching
   * expense with it, unless that expense has already been part paid.
   */
  updateProcurement: (orderId: string, procId: string, data: any) =>
    api.put(`/orders/${orderId}/procurements/${procId}`, data),
  /**
   * Update a shipment. Entering freight, CHA or transport charges raises the
   * matching expenses automatically.
   */
  updateShipment: (orderId: string, shipmentId: string, data: any) =>
    api.put(`/orders/${orderId}/shipments/${shipmentId}`, data),
  updateDocument: (orderId: string, docId: string, data: any) => 
    api.put(`/orders/${orderId}/documents/${docId}`, data),
  downloadProcurementPdf: (orderId: string, procId: string) =>
    api.get(`/orders/${orderId}/procurements/${procId}/pdf`, { responseType: 'blob' }),
};

// ============================================
// INVOICES API
// ============================================

export const invoicesApi = {
  list: (params?: any) => api.get('/invoices', { params }),
  get: (id: string) => api.get(`/invoices/${id}`),
  create: (data: any) => api.post('/invoices', data),
  update: (id: string, data: any) => api.put(`/invoices/${id}`, data),
  addPayment: (id: string, data: any) => api.post(`/invoices/${id}/payments`, data),
  /** See quotationsApi.downloadPdf. */
  downloadPdf: (id: string, currency?: string, rate?: number) =>
    api.get(`/invoices/${id}/pdf`, {
      responseType: 'blob',
      params: currency ? { currency, rate } : undefined,
    }),
  getReceivables: () => api.get('/invoices/reports/receivables'),
};

// ============================================
// DASHBOARD API
// ============================================

export const dashboardApi = {
  getMain: () => api.get('/dashboard'),
  getSales: () => api.get('/dashboard/sales'),
  getOperations: () => api.get('/dashboard/operations'),
  getFinance: () => api.get('/dashboard/finance'),
};

// ============================================
// AUTOMATION API
// ============================================

export const automationApi = {
  // Webhooks
  listWebhooks: () => api.get('/automation/webhooks'),
  createWebhook: (data: any) => api.post('/automation/webhooks', data),
  updateWebhook: (id: string, data: any) => api.put(`/automation/webhooks/${id}`, data),
  deleteWebhook: (id: string) => api.delete(`/automation/webhooks/${id}`),
  testWebhook: (id: string) => api.post(`/automation/webhooks/${id}/test`),
  getWebhookEvents: () => api.get('/automation/webhook-events'),

  // Templates
  listTemplates: (type?: string) => api.get('/automation/templates', { params: { type } }),
  getTemplate: (id: string) => api.get(`/automation/templates/${id}`),
  createTemplate: (data: any) => api.post('/automation/templates', data),
  updateTemplate: (id: string, data: any) => api.put(`/automation/templates/${id}`, data),
  deleteTemplate: (id: string) => api.delete(`/automation/templates/${id}`),
  getTemplateVariables: () => api.get('/automation/template-variables'),

  // Automation Rules
  listAutomations: () => api.get('/automation/automations'),
  createAutomation: (data: any) => api.post('/automation/automations', data),
  updateAutomation: (id: string, data: any) => api.put(`/automation/automations/${id}`, data),
  deleteAutomation: (id: string) => api.delete(`/automation/automations/${id}`),
};

// ============================================
// EXCHANGE RATES API
// ============================================
// There is no stored exchange rate. Every amount is INR; a currency and rate are
// chosen when a quotation or invoice PDF is generated and recorded on that
// document. This is the advisory market lookup that suggests a rate in that
// dialog, so a transposed digit is obvious before the document goes out.
export const exchangeRatesApi = {
  marketCheck: () => api.get('/exchange-rates/market-check'),
};

// ============================================
// EXPENSES API
// ============================================

export const expensesApi = {
  list: (params?: any) => api.get('/expenses', { params }),
  get: (id: string) => api.get(`/expenses/${id}`),
  create: (data: any) => api.post('/expenses', data),
  update: (id: string, data: any) => api.put(`/expenses/${id}`, data),
  delete: (id: string) => api.delete(`/expenses/${id}`),
  remove: (id: string) => api.delete(`/expenses/${id}`),
  setStatus: (id: string, status: string) =>
    api.patch(`/expenses/${id}/status`, { status }),
  options: () => api.get('/expenses/meta/options'),
  /** Search vendors (suppliers, CHAs, transporters) for auto-complete */
  searchVendors: (params?: { search?: string; category?: string }) =>
    api.get('/expenses/meta/vendors', { params }),
  /** Get linkable records (shipments, orders, procurements) for pre-fill */
  getLinkableRecords: (category?: string) =>
    api.get('/expenses/meta/linkable-records', { params: { category } }),

  // ---- Outgoing payment tracking ----
  /** Payments recorded against an expense, with its paid and outstanding totals. */
  listPayments: (id: string) => api.get(`/expenses/${id}/payments`),
  /**
   * Record money paid out. The expense's status follows the payments, so there is
   * no separate "mark as paid" call.
   */
  addPayment: (
    id: string,
    data: {
      amount: number;
      paymentDate: string;
      method?: string;
      reference?: string;
      notes?: string;
    }
  ) => api.post(`/expenses/${id}/payments`, data),
  /** Reverse a payment - a bounced cheque or a wrong entry. */
  deletePayment: (id: string, paymentId: string) =>
    api.delete(`/expenses/${id}/payments/${paymentId}`),

  /**
   * Generate expenses for procurements and shipments recorded before the automatic
   * sync existed. Safe to run more than once.
   */
  syncFromSources: () => api.post('/expenses/sync'),
};

// ============================================
// INCOME API
// ============================================

export const incomeApi = {
  list: (params?: any) => api.get('/income', { params }),
  get: (id: string) => api.get(`/income/${id}`),
  create: (data: any) => api.post('/income', data),
  update: (id: string, data: any) => api.put(`/income/${id}`, data),
  delete: (id: string) => api.delete(`/income/${id}`),
  remove: (id: string) => api.delete(`/income/${id}`),
  setStatus: (id: string, status: string) =>
    api.patch(`/income/${id}/status`, { status }),
  options: () => api.get('/income/meta/options'),
  forexGain: (invoiceId: string) => api.get(`/income/forex-gain/${invoiceId}`),
};

// ============================================
// TASKS API
// ============================================

export const tasksApi = {
  list: (params?: any) => api.get('/tasks', { params }),
  get: (id: string) => api.get(`/tasks/${id}`),
  create: (data: any) => api.post('/tasks', data),
  update: (id: string, data: any) => api.put(`/tasks/${id}`, data),
  delete: (id: string) => api.delete(`/tasks/${id}`),
  remove: (id: string) => api.delete(`/tasks/${id}`),
  options: () => api.get('/tasks/meta/options'),
};

// ============================================
// USERS API
// ============================================

// ============================================
// SETTINGS API
// ============================================
// The company profile is a single row: GET returns it (or null when it has not
// been set up), PUT upserts it. These values are printed on outgoing documents.
export const settingsApi = {
  getCompany: () => api.get('/settings/company'),
  updateCompany: (data: any) => api.put('/settings/company', data),
};

export const usersApi = {
  list: (params?: any) => api.get('/users', { params }),
  get: (id: string) => api.get(`/users/${id}`),
  create: (data: any) => api.post('/auth/register', data),
  update: (id: string, data: any) => api.put(`/users/${id}`, data),
  /**
   * Deactivates the user (soft delete - the row is kept and status set to
   * INACTIVE, because users are referenced by orders, payments and audit
   * entries). Rejected for your own account and for the last active founder.
   */
  deactivate: (id: string) => api.delete(`/users/${id}`),
  reactivate: (id: string) => api.post(`/users/${id}/reactivate`),
};

// ============================================
// AUDIT LOG API
// ============================================

export const auditApi = {
  /** List all audit log entries with filtering */
  list: (params?: any) => api.get('/audit', { params }),
  /** Get audit history for a specific entity */
  forEntity: (entityType: string, entityId: string) =>
    api.get(`/audit/entity/${entityType}/${entityId}`),
  /** Get audit statistics */
  stats: () => api.get('/audit/stats'),
  /** Get filter options */
  options: () => api.get('/audit/options'),
};

// ============================================
// RECORD DELETION API (Founder Only)
// ============================================

export const recordsApi = {
  /** Preview what will be deleted */
  preview: (resource: string, id: string) =>
    api.get(`/records/${resource}/${id}/preview`),
  /** Permanently delete a record */
  delete: (resource: string, id: string) =>
    api.delete(`/records/${resource}/${id}`, { data: { confirmDelete: 'DELETE' } }),
  /** Get list of deletable resource types */
  types: () => api.get('/records/types'),
};

// ============================================
// ATTACHMENTS API
// ============================================

export const attachmentsApi = {
  /** List attachments for an entity */
  list: (entityType: string, entityId: string, documentId?: string) =>
    api.get('/attachments', { params: { entityType, entityId, documentId } }),
  /** Upload a file attachment (base64 encoded) */
  upload: (data: {
    entityType: 'ORDER' | 'INQUIRY' | 'DOCUMENT' | 'QUOTATION';
    entityId: string;
    documentId?: string;
    description?: string;
    fileName: string;
    mimeType: string;
    fileData: string; // base64
  }) => api.post('/attachments/upload', data),
  /** Download an attachment */
  download: (id: string) => api.get(`/attachments/${id}/download`, { responseType: 'blob' }),
  /** Delete an attachment */
  delete: (id: string) => api.delete(`/attachments/${id}`),
};



// ============================================
// LIFECYCLE API (Master Data Deactivation)
// ============================================
// Soft delete and restore for master data records. These records cannot be
// hard-deleted because they are referenced by historical documents, but they
// can be hidden from dropdowns in new records.

export const lifecycleApi = {
  /**
   * Preview what deactivating a record would affect, without changing anything.
   * Returns dependent counts and whether the action is blocked.
   */
  preview: (resource: string, id: string) =>
    api.get(`/lifecycle/${resource}/${id}/preview`),
  /**
   * Deactivate a master data record (hide from new records, keep on existing).
   * Requires SETTINGS_MANAGE permission (Founder/Admin only).
   */
  deactivate: (resource: string, id: string) =>
    api.put(`/lifecycle/${resource}/${id}/deactivate`),
  /**
   * Reactivate a previously deactivated record.
   * Requires SETTINGS_MANAGE permission (Founder/Admin only).
   */
  reactivate: (resource: string, id: string) =>
    api.put(`/lifecycle/${resource}/${id}/reactivate`),
};
