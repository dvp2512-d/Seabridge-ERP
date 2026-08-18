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

export default api;

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

  updateProfile: (data: { firstName: string; lastName: string; phone?: string }) =>
    api.put('/auth/me', data),
  
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),
};

// ============================================
// MASTER DATA API
// ============================================

export const masterApi = {
  getDropdowns: () => api.get('/master/dropdowns'),
  
  // Countries
  getCountries: () => api.get('/master/countries'),
  createCountry: (data: any) => api.post('/master/countries', data),
  updateCountry: (id: string, data: any) => api.put(`/master/countries/${id}`, data),
  
  // Ports
  getPorts: (params?: any) => api.get('/master/ports', { params }),
  createPort: (data: any) => api.post('/master/ports', data),
  updatePort: (id: string, data: any) => api.put(`/master/ports/${id}`, data),
  
  // Currencies
  getCurrencies: () => api.get('/master/currencies'),
  createCurrency: (data: any) => api.post('/master/currencies', data),
  updateCurrency: (id: string, data: any) => api.put(`/master/currencies/${id}`, data),
  
  // Incoterms
  getIncoterms: () => api.get('/master/incoterms'),
  createIncoterm: (data: any) => api.post('/master/incoterms', data),
  updateIncoterm: (id: string, data: any) => api.put(`/master/incoterms/${id}`, data),
  
  // Product Categories
  getProductCategories: () => api.get('/master/product-categories'),
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
  downloadPdf: (id: string) => api.get(`/quotations/${id}/pdf`, { responseType: 'blob' }),
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
  updateDocument: (orderId: string, docId: string, data: any) => 
    api.put(`/orders/${orderId}/documents/${docId}`, data),
  /** Packing List PDF, rendered from the Packing List template */
  downloadPackingList: (id: string) =>
    api.get(`/orders/${id}/packing-list`, { responseType: 'blob' }),
  /** Record cartons and net/gross weights against an order line */
  updateItemPacking: (orderId: string, itemId: string, data: any) =>
    api.put(`/orders/${orderId}/items/${itemId}/packing`, data),
};

// ============================================
// EXCHANGE RATES API
// ============================================

export const exchangeRatesApi = {
  /** Rates in force on a date, one row per currency */
  current: (params?: { date?: string; direction?: 'EXPORT' | 'IMPORT' }) =>
    api.get('/exchange-rates/current', { params }),
  history: (currencyId: string) => api.get(`/exchange-rates/history/${currencyId}`),
  /** Record a CBIC notification: one effective date, many currency rates */
  createNotification: (data: any) => api.post('/exchange-rates/notification', data),
  update: (id: string, data: any) => api.put(`/exchange-rates/${id}`, data),
  remove: (id: string) => api.delete(`/exchange-rates/${id}`),
  /** Advisory market rates for spotting a transposed digit */
  marketCheck: () => api.get('/exchange-rates/market-check'),
  /** Which currencies cannot currently be converted */
  coverage: (date?: string) => api.get('/exchange-rates/coverage', { params: { date } }),
};

// ============================================
// RECORD LIFECYCLE
// ============================================

/**
 * Deactivate, reactivate and cancel.
 *
 * Master data deactivates because foreign keys are RESTRICT - a hard delete of a
 * product that appears on any order fails at the database. Business documents
 * cancel because their numbers appear on customs paperwork. Only drafts and
 * internal records really delete.
 */
export const lifecycleApi = {
  /** What deactivating would affect, for the confirmation dialog */
  preview: (resource: string, id: string) =>
    api.get(`/lifecycle/${resource}/${id}/preview`),
  deactivate: (resource: string, id: string) =>
    api.put(`/lifecycle/${resource}/${id}/deactivate`),
  reactivate: (resource: string, id: string) =>
    api.put(`/lifecycle/${resource}/${id}/reactivate`),

  // Documents keep their number and are marked void
  cancelInvoice: (id: string, reason?: string) => api.put(`/invoices/${id}/cancel`, { reason }),
  cancelOrder: (id: string, reason?: string) => api.put(`/orders/${id}/cancel`, { reason }),
  cancelQuotation: (id: string, reason?: string) => api.put(`/quotations/${id}/cancel`, { reason }),
  cancelInquiry: (id: string, reason?: string) => api.put(`/inquiries/${id}/cancel`, { reason }),

  /** Genuine deletion, draft quotations only */
  deleteDraftQuotation: (id: string) => api.delete(`/quotations/${id}`),

  reactivateUser: (id: string) => api.put(`/users/${id}/reactivate`),
};

// ============================================
// EXPENSES, TASKS, AUDIT
// ============================================

export const expensesApi = {
  list: (params?: any) => api.get('/expenses', { params }),
  get: (id: string) => api.get(`/expenses/${id}`),
  create: (data: any) => api.post('/expenses', data),
  update: (id: string, data: any) => api.put(`/expenses/${id}`, data),
  setStatus: (id: string, status: string) => api.put(`/expenses/${id}/status`, { status }),
  remove: (id: string) => api.delete(`/expenses/${id}`),
  options: () => api.get('/expenses/meta/options'),
};

export const tasksApi = {
  list: (params?: any) => api.get('/tasks', { params }),
  get: (id: string) => api.get(`/tasks/${id}`),
  create: (data: any) => api.post('/tasks', data),
  update: (id: string, data: any) => api.put(`/tasks/${id}`, data),
  remove: (id: string) => api.delete(`/tasks/${id}`),
  options: () => api.get('/tasks/meta/options'),
};

export const auditApi = {
  /** Read-only: entries are written by middleware, never through the API */
  list: (params?: any) => api.get('/audit', { params }),
  forEntity: (entityType: string, entityId: string) =>
    api.get(`/audit/entity/${entityType}/${entityId}`),
};

export const usersApi = {
  list: (params?: any) => api.get('/users', { params }),
  get: (id: string) => api.get(`/users/${id}`),
  create: (data: any) => api.post('/users', data),
  update: (id: string, data: any) => api.put(`/users/${id}`, data),
  remove: (id: string) => api.delete(`/users/${id}`),
};

// ============================================
// SETTINGS API
// ============================================

export const settingsApi = {
  /** Exporter details printed on every outgoing document */
  getCompany: () => api.get('/settings/company'),
  updateCompany: (data: any) => api.put('/settings/company', data),
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
  downloadPdf: (id: string) => api.get(`/invoices/${id}/pdf`, { responseType: 'blob' }),
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
