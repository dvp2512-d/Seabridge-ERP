# SeaBridge ERP - Comprehensive Audit Details

**Version:** Master Enterprise Edition V1.0  
**Audit Date:** September 2026  
**Purpose:** Complete system documentation for comprehensive codebase audit

---

## 1. SYSTEM OVERVIEW

### 1.1 Business Purpose
SeaBridge ERP is a complete business management system built for **Indian export trading companies**. It manages the entire export workflow from customer inquiry to payment collection.

### 1.2 Core Business Flow
```
Buyer → Inquiry → Quotation → Export Order → Procurement → Shipment → Invoice → Payment
```

### 1.3 Target Users
- Indian exporters (primarily commodity trading)
- Multi-currency operations (quote in foreign currency, store in INR)
- Port-based logistics (sea/air freight)

---

## 2. TECHNICAL ARCHITECTURE

### 2.1 Technology Stack

#### Backend (apps/api/)
| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | 18+ | Runtime |
| Express | 4.18 | API framework |
| Prisma | Latest | ORM & migrations |
| PostgreSQL | 15 | Database |
| Zod | 3.22 | Request validation |
| PDFKit | 0.14 | PDF generation |
| bcryptjs | 2.4 | Password hashing |
| JWT | Latest | Authentication |
| Helmet | 7.1 | Security headers |
| express-rate-limit | 7.1 | Rate limiting |

#### Frontend (apps/web/)
| Technology | Version | Purpose |
|------------|---------|---------|
| React | 18.2 | UI framework |
| TypeScript | 5.x | Type safety |
| Vite | Latest | Build tool |
| Tailwind CSS | 3.4 | Styling |
| React Router | 6.22 | Navigation |
| TanStack Query | 5.17 | Server state |
| Zustand | 4.5 | Client state |
| React Hook Form | 7.49 | Forms |
| Axios | Latest | HTTP client |
| Lucide React | 0.316 | Icons |
| react-hot-toast | 2.4 | Notifications |

#### Infrastructure
| Technology | Purpose |
|------------|---------|
| Docker | Containerization |
| Docker Compose | Multi-container orchestration |
| nginx | Reverse proxy (web container) |
| Redis | Optional - rate limiting store |

### 2.2 Project Structure
```
seabridge-ERP/
├── apps/
│   ├── api/                    # Express backend
│   │   ├── src/
│   │   │   ├── routes/         # 28 API route files
│   │   │   ├── services/       # 16 service files
│   │   │   ├── middleware/     # 3 middleware files
│   │   │   ├── utils/          # Utility functions
│   │   │   ├── __tests__/      # Unit tests
│   │   │   ├── index.ts        # Server entry point
│   │   │   └── app.ts          # Express app setup
│   │   └── Dockerfile
│   └── web/                    # React frontend
│       ├── src/
│       │   ├── pages/          # 25 page components
│       │   ├── components/     # Reusable components
│       │   ├── lib/            # Utilities & API client
│       │   ├── store/          # Zustand state
│       │   └── hooks/          # Custom hooks
│       └── Dockerfile
├── packages/
│   └── database/
│       └── prisma/
│           ├── schema.prisma   # 49 database models
│           ├── migrations/     # Database migrations
│           └── seed.ts         # Seed data
├── scripts/                    # Verification scripts
├── e2e/                        # Playwright E2E tests
├── docker-compose.yml
└── deploy.cmd                  # Windows deployment script
```

---

## 3. DATABASE SCHEMA (49 Models)

### 3.1 Authentication & Users
| Model | Purpose | Key Fields |
|-------|---------|------------|
| User | System users | email, passwordHash, role, status |
| Session | Active sessions | userId, token, expiresAt |
| RefreshToken | JWT refresh tokens | userId, token, family, revokedAt |

### 3.2 Master Data - Geography
| Model | Purpose | Key Fields |
|-------|---------|------------|
| Country | Countries | code (ISO), name, region |
| Port | Shipping ports | code, name, countryId, type (SEA/AIR/LAND) |
| Currency | Currencies | code (ISO 4217), name, symbol |
| Incoterm | Trade terms | code, name, description |

### 3.3 Master Data - Products & Services
| Model | Purpose | Key Fields |
|-------|---------|------------|
| ProductCategory | Product categories | name, description |
| Product | Products | code, name, hsnCode, unit, gstRate, defaultPackageType |
| Supplier | Material suppliers | code, name, gstNumber, panNumber |
| SupplierPrice | Supplier pricing | supplierId, productId, price, validFrom/To |
| CHA | Customs agents | code, name, licenseNumber |
| CHARate | CHA rates | chaId, serviceType, rate, containerType |
| Transporter | Transport providers | code, name, serviceType |
| TransportRate | Transport rates | transporterId, origin, destination, rate |

### 3.4 CRM - Buyer Management
| Model | Purpose | Key Fields |
|-------|---------|------------|
| Buyer | Customers | code, companyName, status, creditLimit, creditDays |
| BuyerContact | Buyer contacts | buyerId, firstName, email, phone, isPrimary |
| Communication | Communication log | buyerId, type, direction, content |

### 3.5 Sales Pipeline
| Model | Purpose | Key Fields |
|-------|---------|------------|
| Inquiry | Sales inquiries | inquiryNumber, buyerId, stage, priority |
| InquiryItem | Inquiry line items | inquiryId, productId, quantity, targetPrice |
| FollowUp | Follow-up tasks | inquiryId, scheduledAt, type, outcome |

### 3.6 Quotations
| Model | Purpose | Key Fields |
|-------|---------|------------|
| Quotation | Price quotations | quotationNumber, buyerId, status, grandTotal |
| QuotationItem | Quote line items | quotationId, productId, unitCost, unitPrice, margin |
| QuotationCost | Additional costs | quotationId, costType, amount |
| QuotationHistory | Version history | quotationId, version, itemsSnapshot, costsSnapshot |

### 3.7 Export Operations
| Model | Purpose | Key Fields |
|-------|---------|------------|
| ExportOrder | Export orders | orderNumber, quotationId, status, totalValue |
| OrderItem | Order line items | orderId, productId, quantity, packageType, netWeight |
| Procurement | Purchase orders | orderId, supplierId, poNumber, totalAmount |
| ProcurementItem | PO line items | procurementId, productId, rate, taxPercent |
| Document | Order documents | orderId, documentType, status |
| Attachment | File attachments | entityType, entityId, fileName, filePath |
| Shipment | Shipment tracking | orderId, containerNumber, blNumber, etd, eta |

### 3.8 Finance
| Model | Purpose | Key Fields |
|-------|---------|------------|
| Invoice | Sales invoices | invoiceNumber, orderId, type, status, totalAmount |
| Payment | Incoming payments | invoiceId, amount, paymentDate, paymentMode |
| Expense | Business expenses | expenseNumber, category, amount, status |
| ExpensePayment | Outgoing payments | expenseId, amount, paymentDate, method |
| Income | Other income | incomeNumber, category, amountINR |

### 3.9 Team & Tasks
| Model | Purpose | Key Fields |
|-------|---------|------------|
| Employee | Employee records | userId, employeeCode, department |
| Task | Task management | title, assigneeId, priority, status, dueDate |

### 3.10 System & Audit
| Model | Purpose | Key Fields |
|-------|---------|------------|
| AuditLog | Change tracking | userId, action, entityType, entityId, oldValues, newValues |
| SystemSetting | System config | key, value, type, category |
| NumberSequence | Auto-numbering | entityType, prefix, currentNo |
| CompanyProfile | Company info | legalName, gstNumber, iecCode, bankDetails |

### 3.11 Automation
| Model | Purpose | Key Fields |
|-------|---------|------------|
| Webhook | Webhook config | name, url, events, isActive |
| WebhookLog | Webhook history | webhookId, event, status, response |
| Template | Document templates | name, type, content, variables |
| AutomationRule | Automation rules | trigger, conditions, actions |
| EmailQueue | Email queue | to, subject, body, status |
| ApiKey | API keys | name, key, permissions |

---

## 4. API ENDPOINTS (28 Route Files)

### 4.1 Authentication (/api/auth)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | /login | User login |
| POST | /logout | User logout |
| GET | /me | Get current user |
| PATCH | /me | Update profile |
| POST | /change-password | Change password |
| POST | /refresh | Refresh tokens |
| GET | /sessions | List sessions |
| DELETE | /sessions/:id | Revoke session |
| POST | /register | Create user (admin) |

### 4.2 Buyers (/api/buyers)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | / | List buyers |
| GET | /:id | Get buyer |
| GET | /:id/defaults | Get buyer defaults for auto-fill |
| POST | / | Create buyer |
| PUT | /:id | Update buyer |
| DELETE | /:id | Delete buyer |
| POST | /:id/contacts | Add contact |
| PUT | /:id/contacts/:cid | Update contact |
| DELETE | /:id/contacts/:cid | Delete contact |
| POST | /:id/communications | Add communication |
| GET | /export/csv | Export CSV |

### 4.3 Products (/api/products)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | / | List products |
| GET | /:id | Get product |
| GET | /:id/latest-price | Get best supplier price |
| POST | / | Create product |
| PUT | /:id | Update product |

### 4.4 Suppliers (/api/suppliers)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | / | List suppliers |
| GET | /:id | Get supplier |
| POST | / | Create supplier |
| PUT | /:id | Update supplier |
| POST | /:id/prices | Add price |

### 4.5 CHA Agents (/api/cha)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | / | List CHAs |
| GET | /:id | Get CHA |
| POST | / | Create CHA |
| PUT | /:id | Update CHA |
| POST | /:id/rates | Add rate |

### 4.6 Transporters (/api/transporters)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | / | List transporters |
| GET | /:id | Get transporter |
| POST | / | Create transporter |
| PUT | /:id | Update transporter |
| POST | /:id/rates | Add rate |

### 4.7 Inquiries (/api/inquiries)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | / | List inquiries |
| GET | /:id | Get inquiry |
| POST | / | Create inquiry |
| PUT | /:id | Update inquiry |
| POST | /:id/items | Add item |
| DELETE | /:id/items/:iid | Delete item |
| POST | /:id/followups | Add follow-up |

### 4.8 Quotations (/api/quotations)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | / | List quotations |
| GET | /:id | Get quotation |
| POST | / | Create quotation |
| PUT | /:id | Update quotation |
| PATCH | /:id/status | Update status |
| POST | /:id/convert-to-order | Convert to order |
| GET | /:id/pdf | Download PDF |
| GET | /:id/history | Version history |
| POST | /:id/revise | Create revision |

### 4.9 Orders (/api/orders)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | / | List orders |
| GET | /:id | Get order |
| GET | /:id/shipment-defaults | Get shipment defaults from quotation costs |
| POST | / | Create order |
| PUT | /:id | Update order |
| POST | /:id/procurements | Add procurement |
| PUT | /:id/procurements/:pid | Update procurement |
| GET | /:id/procurements/:pid/pdf | Download PO PDF |
| GET | /:id/procurements/suggest | Suggest PO lines |
| POST | /:id/shipments | Add shipment |
| PUT | /:id/shipments/:sid | Update shipment |
| PUT | /:id/documents/:did | Update document |
| PUT | /:id/items/:iid | Update order item |
| POST | /:id/items/fill-packing | Auto-fill packing |
| GET | /:id/document-readiness | Check document readiness |

### 4.10 Invoices (/api/invoices)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | / | List invoices |
| GET | /:id | Get invoice |
| POST | / | Create invoice |
| PUT | /:id | Update invoice |
| POST | /:id/payments | Add payment |
| GET | /:id/pdf | Download PDF |
| GET | /reports/receivables | Receivables report |

### 4.11 Dashboard (/api/dashboard)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | / | Main dashboard KPIs |
| GET | /sales | Sales dashboard |
| GET | /operations | Operations dashboard |
| GET | /finance | Finance dashboard |

### 4.12 Expenses (/api/expenses)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | / | List expenses |
| GET | /:id | Get expense |
| POST | / | Create expense |
| PUT | /:id | Update expense |
| DELETE | /:id | Delete expense |
| PATCH | /:id/status | Update status |
| GET | /meta/options | Get options |
| GET | /meta/vendors | Search vendors |
| GET | /meta/linkable-records | Get linkable records |
| GET | /:id/payments | List payments |
| POST | /:id/payments | Add payment |
| DELETE | /:id/payments/:pid | Delete payment |
| POST | /sync | Sync from sources |

### 4.13 Income (/api/income)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | / | List income |
| GET | /:id | Get income |
| POST | / | Create income |
| PUT | /:id | Update income |
| DELETE | /:id | Delete income |
| PATCH | /:id/status | Update status |
| GET | /meta/options | Get options |
| GET | /forex-gain/:invoiceId | Calculate forex gain |

### 4.14 Tasks (/api/tasks)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | / | List tasks |
| GET | /:id | Get task |
| POST | / | Create task |
| PUT | /:id | Update task |
| DELETE | /:id | Delete task |
| GET | /meta/options | Get options |

### 4.15 Users (/api/users)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | / | List users |
| GET | /:id | Get user |
| PUT | /:id | Update user |
| DELETE | /:id | Deactivate user |
| POST | /:id/reactivate | Reactivate user |

### 4.16 Master Data (/api/master)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /dropdowns | Get all dropdown data |
| GET/POST/PUT | /countries | Country CRUD |
| GET/POST/PUT | /ports | Port CRUD |
| GET/POST/PUT | /currencies | Currency CRUD |
| GET/POST/PUT | /incoterms | Incoterm CRUD |
| GET/POST/PUT | /product-categories | Category CRUD |

### 4.17 Settings (/api/settings)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /company | Get company profile |
| PUT | /company | Update company profile |

### 4.18 Automation (/api/automation)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET/POST/PUT/DELETE | /webhooks | Webhook CRUD |
| POST | /webhooks/:id/test | Test webhook |
| GET | /webhook-events | Available events |
| GET/POST/PUT/DELETE | /templates | Template CRUD |
| GET | /template-variables | Available variables |
| GET/POST/PUT/DELETE | /automations | Automation rule CRUD |

### 4.19 Audit (/api/audit)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | / | List audit entries |
| GET | /entity/:type/:id | Entity history |
| GET | /stats | Audit statistics |
| GET | /options | Filter options |

### 4.20 Record Deletion (/api/records)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /:resource/:id/preview | Preview cascade delete |
| DELETE | /:resource/:id | Permanent delete (Founder only) |
| GET | /types | Deletable resource types |

### 4.21 Lifecycle (/api/lifecycle)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | /deactivate | Soft delete master data |
| POST | /reactivate | Restore master data |

### 4.22 Exchange Rates (/api/exchange-rates)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /market-check | Advisory market rate lookup |

### 4.23 Search (/api/search)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | / | Global search across all modules |

### 4.24 Export (/api/export)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /invoices | Export invoices CSV |
| GET | /orders | Export orders CSV |
| GET | /buyers | Export buyers CSV |
| GET | /expenses | Export expenses CSV |
| GET | /receivables | Export receivables CSV |
| GET | /quotations | Export quotations CSV |
| GET | /audit | Export audit log CSV |

### 4.25 Timeline (/api/timeline)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /buyers/:id | Buyer activity timeline |
| GET | /orders/:id | Order activity timeline |
| GET | /invoices/:id | Invoice activity timeline |

### 4.26 Bulk Operations (/api/bulk)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| PUT | /orders/status | Bulk update order status |
| PUT | /invoices/status | Bulk update invoice status |
| PUT | /expenses/approve | Bulk approve expenses |
| PUT | /inquiries/stage | Bulk update inquiry stage |
| PUT | /products/deactivate | Bulk deactivate products |
| PUT | /tasks/complete | Bulk complete tasks |

### 4.27 Email (/api/email)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /status | Email service status |
| GET | / | List queued emails |
| POST | /test | Send test email |
| POST | /process | Process email queue |
| POST | /retry-failed | Retry failed emails |

### 4.28 Attachments (/api/attachments)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | / | List attachments |
| POST | /upload | Upload file (base64) |
| GET | /:id/download | Download file |
| DELETE | /:id | Delete attachment |

---

## 5. FRONTEND PAGES (25 Pages)

### 5.1 Core Pages
| Page | File | Purpose |
|------|------|---------|
| Login | Login.tsx | User authentication |
| Dashboard | Dashboard.tsx | KPIs, charts, alerts |
| Buyers | Buyers.tsx | Buyer list & management |
| BuyerDetail | BuyerDetail.tsx | 360° buyer view |
| Inquiries | Inquiries.tsx | Sales pipeline |
| InquiryDetail | InquiryDetail.tsx | Inquiry management |
| Quotations | Quotations.tsx | Quotation list |
| QuotationDetail | QuotationDetail.tsx | Quotation editing |
| NewQuotation | NewQuotation.tsx | Create quotation |
| Orders | Orders.tsx | Order list |
| OrderDetail | OrderDetail.tsx | Order management |
| Invoices | Invoices.tsx | Invoice list |
| InvoiceDetail | InvoiceDetail.tsx | Invoice management |
| NewInvoice | NewInvoice.tsx | Create invoice |

### 5.2 Finance Pages
| Page | File | Purpose |
|------|------|---------|
| Expenses | Expenses.tsx | Expense management |
| Income | Income.tsx | Income management |
| Tasks | Tasks.tsx | Task management |

### 5.3 Master Data Pages
| Page | File | Purpose |
|------|------|---------|
| Products | Products.tsx | Product management |
| Suppliers | Suppliers.tsx | Supplier management |
| CHAs | CHAs.tsx | CHA agent management |
| Transporters | Transporters.tsx | Transporter management |
| MasterData | MasterData.tsx | Countries, ports, currencies |
| Users | Users.tsx | User management |

### 5.4 System Pages
| Page | File | Purpose |
|------|------|---------|
| Settings | Settings.tsx | Company profile, webhooks |
| AuditLog | AuditLog.tsx | System audit trail |

---

## 6. SERVICES (16 Service Files)

### 6.1 Core Services
| Service | File | Purpose |
|---------|------|---------|
| PDF Service | pdfService.ts | Generate all PDF documents |
| Order Service | orderService.ts | Order conversion, validation |
| Exchange Rate | exchangeRateService.ts | Market rate lookup |
| Email Service | emailService.ts | Email queue processing |
| Event Service | eventService.ts | Webhook dispatch & retry |

### 6.2 Financial Services
| Service | File | Purpose |
|---------|------|---------|
| Expense Sync | expenseSyncService.ts | Auto-create expenses from operations |
| Procurement Pricing | procurementPricing.ts | PO line pricing |
| Inclusive Pricing | inclusivePricing.ts | Tax-inclusive calculations |

### 6.3 Document Services
| Service | File | Purpose |
|---------|------|---------|
| Document Layout | documentLayout.ts | PDF layout helpers |
| Document Readiness | documentReadiness.ts | Check document completeness |
| Export Service | exportService.ts | CSV generation |

### 6.4 System Services
| Service | File | Purpose |
|---------|------|---------|
| Cache Service | cacheService.ts | In-memory caching |
| Redis Service | redisService.ts | Redis connection |
| Refresh Token | refreshTokenService.ts | Token rotation |
| Search Service | searchService.ts | Global search |
| Timeline Service | timelineService.ts | Activity aggregation |
| Deactivation Service | deactivationService.ts | Soft delete logic |

---

## 7. MIDDLEWARE (3 Files)

| Middleware | File | Purpose |
|------------|------|---------|
| Auth | auth.ts | JWT authentication, role checking |
| Audit Log | auditLog.ts | Automatic change tracking |
| Error Handler | errorHandler.ts | Centralized error handling |

---

## 8. USER ROLES & PERMISSIONS

### 8.1 Role Hierarchy
| Role | Level | Description |
|------|-------|-------------|
| FOUNDER | 1 | Full access + permanent deletion |
| ADMIN | 2 | Full access + audit log |
| SALES | 3 | CRM, inquiries, quotations |
| OPERATIONS | 4 | Orders, shipments, procurement |
| FINANCE | 5 | Invoices, payments, expenses |

### 8.2 Permission Matrix
| Feature | FOUNDER | ADMIN | SALES | OPERATIONS | FINANCE |
|---------|---------|-------|-------|------------|---------|
| Dashboard | ✅ | ✅ | ✅ | ✅ | ✅ |
| Buyers | ✅ | ✅ | ✅ | ❌ | ❌ |
| Inquiries | ✅ | ✅ | ✅ | ❌ | ❌ |
| Quotations | ✅ | ✅ | ✅ | ❌ | ❌ |
| Orders | ✅ | ✅ | ❌ | ✅ | ❌ |
| Shipments | ✅ | ✅ | ❌ | ✅ | ❌ |
| Invoices | ✅ | ✅ | ❌ | ❌ | ✅ |
| Payments | ✅ | ✅ | ❌ | ❌ | ✅ |
| Expenses | ✅ | ✅ | ❌ | ❌ | ✅ |
| Users | ✅ | ✅ | ❌ | ❌ | ❌ |
| Audit Log | ✅ | ✅ | ❌ | ❌ | ❌ |
| Permanent Delete | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## 9. KEY BUSINESS RULES

### 9.1 Currency Handling
- **All amounts stored in INR** (base currency)
- PDF currency and rate chosen at document generation time
- Market rate lookup is advisory only (from open.er-api.com)
- Exchange rate recorded on each document for audit trail

### 9.2 Quotation Rules
- Margin = Subtotal - Item Costs
- Grand Total = Subtotal + Additional Costs
- Status flow: DRAFT → SENT → ACCEPTED/REJECTED/REVISED
- Only ACCEPTED quotations can be converted to orders
- Version tracking on revisions

### 9.3 Order Rules
- One order per quotation (unique constraint)
- Status flow: CONFIRMED → IN_PRODUCTION → READY_TO_SHIP → SHIPPED → DELIVERED
- Packing figures (packages, weights) filled from quotation or product defaults
- Document checklist auto-created

### 9.4 Invoice Rules
- Types: COMMERCIAL, PROFORMA, SAMPLE, PACKING_LIST
- Due date auto-calculated from buyer creditDays
- Status derived from payment state
- Forex gain/loss tracked on foreign payments

### 9.5 Expense Rules
- Auto-generated from procurements and shipment costs
- Source tracking (MANUAL, PROCUREMENT, SHIPMENT_*)
- Partial payment tracking with balance
- Status: PENDING → APPROVED → PAID

---

## 10. AUTOMATION FEATURES

### 10.1 Auto-Fill Behaviors
| Trigger | Auto-Fill | Source |
|---------|-----------|--------|
| Select buyer on quotation | Payment terms, port | Buyer defaults |
| Select product on quotation item | Best supplier price | Latest SupplierPrice |
| Create shipment on order | All cost fields | QuotationCost mapping |
| Create invoice | Due date | Buyer creditDays |
| Create procurement | PO line prices | SupplierPrice with GST |

### 10.2 Expense Sync
| Operation | Creates Expense | Category |
|-----------|-----------------|----------|
| Create procurement | ✅ | SUPPLIER_PAYMENT |
| Update procurement amount | ✅ Updates | SUPPLIER_PAYMENT |
| Set shipment freight | ✅ | FREIGHT |
| Set shipment CHA charges | ✅ | CHA |
| Set shipment transport | ✅ | TRANSPORT |
| Set shipment packaging | ✅ | PACKAGING |
| Set shipment insurance | ✅ | INSURANCE |
| Set shipment inspection | ✅ | INSPECTION |
| Set shipment commission | ✅ | COMMISSION |
| Set shipment other | ✅ | OTHER |

### 10.3 Scheduled Tasks
| Task | Interval | Purpose |
|------|----------|---------|
| Token cleanup | 24 hours | Remove expired refresh tokens |
| Webhook retry | 15 minutes | Retry failed webhooks with backoff |
| Email queue | 5 minutes | Process pending emails |

### 10.4 Webhook Events
- inquiry.created, inquiry.updated, inquiry.stage_changed
- quotation.created, quotation.updated, quotation.status_changed
- order.created, order.updated, order.status_changed
- invoice.created, invoice.updated, invoice.status_changed
- payment.received

---

## 11. PDF DOCUMENTS (7 Types)

| Document | Generated From | Key Sections |
|----------|----------------|--------------|
| Quotation | Quotation | Items, costs, terms, validity |
| Purchase Order | Procurement | Supplier items, delivery, payment |
| Commercial Invoice | Invoice (COMMERCIAL) | Items, totals, bank details |
| Proforma Invoice | Invoice (PROFORMA) | Items, totals, purpose |
| Sample Invoice | Invoice (SAMPLE) | Items, declared value, purpose |
| Packing List | Invoice (PACKING_LIST) | Packages, weights, marks |
| (Invoice PDF) | Any invoice type | Type-specific rendering |

---

## 12. SECURITY FEATURES

### 12.1 Authentication
- JWT with short-lived access tokens (15 min)
- Refresh token rotation with family tracking
- Session management with revocation
- Brute force protection (20 attempts/15 min)

### 12.2 Authorization
- Role-based access control on all routes
- Resource-level permissions
- Founder-only permanent deletion

### 12.3 API Security
- Helmet.js security headers
- Rate limiting (500 req/15 min general, 20 req/15 min auth)
- Request ID tracking (X-Request-ID)
- SSRF protection on webhooks
- Input validation with Zod

### 12.4 Data Protection
- Password hashing with bcrypt
- Audit logging of all changes
- Soft delete by default

---

## 13. VERIFICATION SCRIPTS

| Script | Purpose | Command |
|--------|---------|---------|
| check-api-contract.mjs | Frontend→Backend route mapping | npm run verify:contract |
| verify-pdf.ts | PDF generation from mock data | npm run verify:pdf |
| verify-logic.ts | Business calculation tests | npm run verify:logic |
| typecheck | TypeScript compilation | npm run typecheck |
| db:validate | Prisma schema validation | npm run db:validate |

---

## 14. DEPLOYMENT

### 14.1 Single Command
```cmd
deploy.cmd
```

### 14.2 Deploy Options
| Command | Purpose |
|---------|---------|
| deploy.cmd | Deploy/update |
| deploy.cmd reset | Wipe database |
| deploy.cmd noseed | Skip seed data |
| deploy.cmd stop | Stop services |
| deploy.cmd logs | View logs |
| deploy.cmd status | Check status |

### 14.3 Container Architecture
```
┌─────────────────────────────────────────────────┐
│                   nginx (web)                    │
│                   Port 3000                      │
└──────────────────────┬──────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
        ▼              ▼              ▼
   ┌─────────┐   ┌─────────┐   ┌─────────┐
   │   API   │   │   Web   │   │Postgres │
   │Port 4000│   │  Build  │   │Port 5432│
   └─────────┘   └─────────┘   └─────────┘
```

---

## 15. CURRENT IMPLEMENTATION STATUS

### 15.1 Fully Implemented ✅
- All 49 database models
- All 28 API route files
- All 25 frontend pages
- All 7 PDF document types
- JWT authentication with refresh rotation
- Role-based access control
- Full audit logging
- Webhook automation
- Bulk operations
- CSV exports
- Global search
- Activity timelines

### 15.2 Partial / Not Complete ⚠️
| Feature | Status |
|---------|--------|
| Automation Rules | CREATE_TASK works, other actions not implemented |
| Email Notifications | Queue exists, SMTP not configured |
| API Keys | Not implemented |
| Tally Export | Not implemented |
| GST e-Invoice | Not implemented |

---

## 16. AUDIT CHECKLIST

### 16.1 Code Quality
- [ ] TypeScript strict mode compliance
- [ ] No any types in critical paths
- [ ] Consistent error handling
- [ ] Input validation on all endpoints
- [ ] SQL injection prevention (Prisma)

### 16.2 Security
- [ ] Authentication on all protected routes
- [ ] Role checks before operations
- [ ] Rate limiting effectiveness
- [ ] SSRF protection on webhooks
- [ ] Secrets not exposed in logs

### 16.3 Data Integrity
- [ ] Foreign key constraints
- [ ] Unique constraints where needed
- [ ] Cascade delete behavior
- [ ] Transaction usage for multi-step operations

### 16.4 Business Logic
- [ ] Currency calculations correct
- [ ] Margin calculations correct
- [ ] Status transitions valid
- [ ] Auto-fill logic complete

### 16.5 Performance
- [ ] Database indexes on query fields
- [ ] Pagination on list endpoints
- [ ] N+1 query prevention
- [ ] Response size limits

---

## 17. FILE SIZES (For Scope Reference)

### Largest Backend Files
| File | Size | Lines (approx) |
|------|------|----------------|
| pdfService.ts | 61KB | 1,800 |
| orders.ts | 41KB | 1,200 |
| expenses.ts | 39KB | 1,100 |
| invoices.ts | 33KB | 950 |
| dashboard.ts | 28KB | 800 |
| quotations.ts | 25KB | 700 |

### Largest Frontend Files
| File | Size | Lines (approx) |
|------|------|----------------|
| OrderDetail.tsx | 101KB | 2,800 |
| schema.prisma | 58KB | 1,500 |
| QuotationDetail.tsx | 53KB | 1,500 |
| InvoiceDetail.tsx | 52KB | 1,400 |
| Settings.tsx | 47KB | 1,300 |
| NewQuotation.tsx | 44KB | 1,200 |

---

*This document provides comprehensive details for performing a thorough audit of the SeaBridge ERP codebase.*
