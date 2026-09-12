# SeaBridge ERP

**Master Enterprise Edition V1.0**

A complete business management system for Indian export trading companies — managing buyers, inquiries, quotations, orders, shipments, and finances in one connected platform. Built specifically for exporters with CBIC exchange rates, multi-currency support, and port-based logistics.

---

## 📋 Table of Contents

- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Quick Start](#-quick-start)
- [Project Structure](#-project-structure)
- [Default Login](#-default-login)
- [Core Modules](#-core-modules)
- [Business Flow](#-business-flow)
- [API Reference](#-api-reference)
- [User Roles](#-user-roles)
- [Implementation Status](#-implementation-status)
- [Brand Colors](#-brand-colors)

---

## 🎯 Features

### CRM & Sales
- **360° Buyer View** — Complete customer history, contacts, and communication log
- **Sales Pipeline** — Inquiry → Quotation → Order workflow with stage tracking
- **Follow-up Management** — Scheduled reminders and task tracking
- **Buyer Communications** — Email, phone, and meeting history

### Quotations & Pricing
- **Auto Costing** — Pull pricing from supplier rates, CHA charges, and transport rates
- **Multi-currency** — Quote in USD, EUR, GBP, or any currency with live CBIC rates
- **Margin Analysis** — Real-time margin and grand total calculations
- **Port Selection** — Port of Loading and Port of Discharge on quotations
- **PDF Generation** — Professional branded quotation documents

### Export Operations
- **Order Management** — Full lifecycle from order creation to shipment
- **Procurement Tracking** — Supplier purchase orders and delivery tracking
- **Document Checklist** — BL, Certificate of Origin, packing list, LC, etc.
- **Shipment Tracking** — Container details, vessel, ETD/ETA

### Finance
- **Invoice Management** — Create, send, and track invoices with PDF
- **Payment Recording** — Partial payments, forex gain tracking
- **Receivables Report** — Multi-currency receivables converted to base currency
- **Expenses & Income** — Full P&L visibility
- **Exchange Rates** — CBIC notification-based rates with market comparison

### Administration
- **Audit Log** — Full system activity log with filtering (who did what, when)
- **Record Deletion** — Founder-only permanent deletion with cascade preview
- **Role-Based Access** — Founder, Admin, Sales, Operations, Finance roles
- **Webhook Automation** — Event-driven integrations
- **Master Data** — Countries, ports, currencies, Incoterms, product categories

---

## 🏗️ Tech Stack

### Backend
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

### Frontend
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
| Recharts | 2.10 | Charts & graphs |
| Lucide React | 0.316 | Icons |
| react-hot-toast | 2.4 | Notifications |

### Infrastructure
| Technology | Purpose |
|------------|---------|
| Docker | Containerization |
| Docker Compose | Multi-container orchestration |
| Redis | Reserved for caching (not yet active) |
| nginx | Reverse proxy (web container) |

---

## 🚀 Quick Start

### Option A — One Command (Recommended)

The only requirement is **Docker Desktop**. Node.js, npm, and Prisma are **not** needed on the host — every build, migration, and seed step runs inside a container.

```cmd
deploy.cmd
```

The script automatically:
1. Pulls latest code from GitHub
2. Checks Docker is installed and running
3. Creates `.env` with secure random credentials if it doesn't exist
4. Builds API and web Docker images
5. Starts PostgreSQL, waits for health check, verifies credentials
6. Applies database migrations and seeds starter data
7. Starts all containers and waits for API health check

Then open **http://localhost:3000**

#### Deploy Commands

| Command | What it does |
|---------|-------------|
| `deploy.cmd` | Deploy or update (pulls latest code first) |
| `deploy.cmd reset` | Wipe database and start clean (type `DELETE` to confirm) |
| `deploy.cmd noseed` | Deploy without inserting starter data |
| `deploy.cmd nopull` | Deploy without pulling from GitHub |
| `deploy.cmd stop` | Stop the stack, keep all data |
| `deploy.cmd logs` | Follow container logs |
| `deploy.cmd status` | Show what's running |
| `deploy.cmd fixenv` | Regenerate `.env` file |
| `deploy.cmd help` | List all options |

> **Linux / macOS:** Use the manual setup steps below. `deploy.cmd` is Windows only.

---

### Option B — Manual Setup (Development)

Use this for hot-reload dev servers. Requires Node.js 18+ on the host.

#### Prerequisites
- Docker Desktop (for PostgreSQL)
- Node.js 18+

#### Steps

**1. Install dependencies**
```bash
npm install
```

**2. Create environment file**
```bash
cp .env.example .env          # macOS/Linux
copy .env.example .env        # Windows CMD
```

Set these required variables in `.env`:

| Variable | Description |
|----------|-------------|
| `POSTGRES_PASSWORD` | Database password (must match `DATABASE_URL`) |
| `JWT_SECRET` | Token signing secret (min 32 chars, keep secret) |

> `.env` is gitignored and must never be committed.

**3. Start database**
```bash
docker compose up -d postgres redis
```

**4. Build database package**
```bash
npm run db:generate
npm run build -w packages/database
```

**5. Apply schema and seed data**
```bash
npm run db:deploy
npm run db:seed
```

**6. Start dev servers**
```bash
npm run dev
```

- Frontend: http://localhost:3000
- API: http://localhost:4000
- Health check: http://localhost:4000/health

---

### Verification

Run these checks without a server:

```bash
npm run typecheck        # TypeScript — zero errors expected
npm run verify:contract  # Every frontend API call maps to a real backend route
npm run verify:pdf       # Generates quotation/invoice PDFs from mock data
npm run verify:logic     # Currency, date, margin, and financial calculations
npm run verify           # All of the above
npm run db:validate      # Prisma schema validity
```

The verification scripts live in `scripts/`:
- `check-api-contract.mjs` — Cross-references frontend API calls against backend routes
- `verify-pdf.ts` — Renders all 7 document types from mock data
- `verify-logic.ts` — Tests pure calculation functions (30 tests)

---

## 📁 Project Structure

```
seabridge-ERP/
├── apps/
│   ├── api/                    # Express backend
│   │   ├── src/
│   │   │   ├── routes/         # 22 API route files
│   │   │   │   ├── auth.ts
│   │   │   │   ├── buyers.ts
│   │   │   │   ├── quotations.ts
│   │   │   │   ├── orders.ts
│   │   │   │   ├── invoices.ts
│   │   │   │   ├── exchangeRates.ts
│   │   │   │   ├── audit.ts
│   │   │   │   ├── recordDeletion.ts
│   │   │   │   ├── lifecycle.ts
│   │   │   │   └── ... (13 more)
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts     # JWT authentication
│   │   │   │   ├── auditLog.ts # Automatic change tracking
│   │   │   │   └── errorHandler.ts
│   │   │   ├── services/
│   │   │   │   ├── pdfService.ts         # Quotation/Invoice PDFs
│   │   │   │   ├── exchangeRateService.ts # Currency conversion
│   │   │   │   ├── deactivationService.ts # Soft delete logic
│   │   │   │   └── eventService.ts       # Webhook dispatcher
│   │   │   └── utils/
│   │   └── Dockerfile
│   └── web/                    # React frontend
│       ├── src/
│       │   ├── components/
│       │   │   ├── Layout.tsx              # Sidebar navigation
│       │   │   ├── DeleteRecordButton.tsx  # Permanent delete (Founder)
│       │   │   ├── modals/
│       │   │   └── ui/                     # Reusable UI components
│       │   ├── pages/          # 25 page components
│       │   │   ├── Dashboard.tsx
│       │   │   ├── AuditLog.tsx
│       │   │   ├── QuotationDetail.tsx
│       │   │   └── ... (23 more)
│       │   ├── store/          # Zustand state
│       │   ├── hooks/          # Custom hooks
│       │   └── lib/
│       │       ├── api.ts      # All API client methods
│       │       ├── utils.ts    # Helpers
│       │       └── permissions.ts
│       └── Dockerfile
├── packages/
│   └── database/
│       └── prisma/
│           ├── schema.prisma   # 46 database models
│           ├── migrations/
│           └── seed.ts
├── scripts/                    # Verification scripts
├── docker-compose.yml
├── docker-compose.dev.yml
├── deploy.cmd                  # Windows deployment script
├── deploy.ps1                  # PowerShell deployment script
└── package.json
```

---

## 🔐 Default Login

The seed creates two accounts with password `admin123`:

| Email | Role | Purpose |
|-------|------|---------|
| `founder@seabridge.com` | FOUNDER | Full access including permanent deletion |
| `hiren@seabridge.com` | SALES | Example sales user |

> **Change both passwords immediately after first login.**
> Settings → Profile → Change Password

---

## 📊 Core Modules

### 1. Dashboard
- Real-time KPIs: revenue, orders, receivables, overdue invoices
- Sales funnel chart
- Recent activity feed
- Pending tasks and alerts
- Multi-currency totals in base currency (INR)

### 2. CRM — Buyers
- Buyer profile with GSTIN, IEC code, shipping address
- Contact management (multiple contacts per buyer)
- Communication history (calls, emails, meetings)
- Full inquiry and order history

### 3. Sales — Inquiries
- Pipeline stages: New → Requirements → Pricing → Quoted → Negotiation → Won/Lost
- Product-level inquiry items with target price
- Follow-up scheduling and reminders
- Direct quotation creation from inquiry

### 4. Quotations
- Line items with supplier pricing, margin, and unit price
- Additional costs (CHA, transport, freight)
- Port of Loading and Port of Discharge selection
- Correct margin calculation: `margin = subtotal - itemsCost`
- Correct grand total: `grandTotal = subtotal + additionalCosts`
- Status workflow: Draft → Sent → Accepted/Rejected/Revised
- One-click conversion to Export Order
- PDF download

### 5. Orders
- Full lifecycle: Confirmed → Processing → Ready → Shipped → Delivered
- Procurement management (supplier POs)
- Document checklist with status tracking
- Shipment details (vessel, container, BL, ETD/ETA)
- Invoice creation from order

### 6. Invoices
- Create from order or standalone
- Payment recording with date and reference
- Partial payment tracking
- Overdue detection and alerts
- Forex gain calculation on payments
- Multi-currency receivables report (converted to INR)
- PDF download

### 7. Exchange Rates
- CBIC notification-based rate entry
- Import and Export rates separately
- Market rate comparison (advisory, from open.er-api.com)
- Difference percentage with warning for >5% variance
- Rate history per currency
- Coverage check — which currencies lack rates

### 8. Finance
- **Expenses** — Record and categorize business expenses
- **Income** — Other income with forex tracking
- **Receivables Report** — All outstanding invoices in base currency

### 9. Audit Log *(Admin/Founder only)*
- Full activity history — every create, update, delete
- Filter by entity type, action, user, date range
- Statistics: today's activity, weekly, total
- Detailed entry view with change diff (JSON)

### 10. Master Data
- Countries (with currency assignment)
- Ports (with code and type)
- Currencies (with exchange rates)
- Incoterms
- Product Categories

### 11. Settings
- Company profile (name, address, GST, IEC, bank details)
- User management (invite, roles, deactivate)
- Number sequences (quotation, order, invoice prefixes)
- Webhook configuration

---

## 🔄 Business Flow

```
Buyer
  └── Inquiry (requirements, target price)
        └── Quotation (costing, margins, PDF)
              └── Export Order (confirmed)
                    ├── Procurement (supplier POs)
                    ├── Documents (BL, CoO, packing list)
                    └── Shipment
                          └── Invoice
                                └── Payment → Profitability
```

All data flows automatically — enter once, use everywhere.

---

## 🌐 API Reference

### Base URL
```
http://localhost:4000/api
```

### Authentication
All endpoints (except `/api/auth/login`) require:
```
Authorization: Bearer <JWT_TOKEN>
```

### Endpoints

| Module | Prefix | Key Operations |
|--------|--------|----------------|
| Auth | `/auth` | login, logout, me |
| Buyers | `/buyers` | CRUD, contacts, communications |
| Products | `/products` | CRUD, categories |
| Suppliers | `/suppliers` | CRUD, pricing |
| CHA | `/cha` | CRUD, rates |
| Transporters | `/transporters` | CRUD, rates |
| Inquiries | `/inquiries` | CRUD, items, follow-ups, stage updates |
| Quotations | `/quotations` | CRUD, PDF, status updates, convert to order |
| Orders | `/orders` | CRUD, shipments, documents, procurement |
| Invoices | `/invoices` | CRUD, payments, PDF, receivables report |
| Exchange Rates | `/exchange-rates` | current, history, notification entry, market check |
| Dashboard | `/dashboard` | main, sales, operations, finance |
| Expenses | `/expenses` | CRUD, status |
| Income | `/income` | CRUD, forex gain |
| Tasks | `/tasks` | CRUD, complete, reopen |
| Users | `/users` | CRUD, deactivate, reactivate |
| Master Data | `/master` | countries, currencies, ports, incoterms, dropdowns |
| Settings | `/settings` | company profile, number sequences |
| Audit | `/audit` | list, entity history, stats, options |
| Records | `/records` | preview delete, permanent delete (Founder only) |
| Lifecycle | `/lifecycle` | deactivate, reactivate master data |
| Automation | `/automation` | webhooks, rules |

### Health Check
```
GET /health
→ { status: "ok", timestamp: "..." }
```

---

## 🛡️ User Roles

| Role | Permissions |
|------|-------------|
| **FOUNDER** | Full access + permanent record deletion + audit log |
| **ADMIN** | Full access + audit log (no permanent deletion) |
| **SALES** | Buyers, inquiries, quotations |
| **OPERATIONS** | Orders, shipments, documents, procurement |
| **FINANCE** | Invoices, payments, expenses, income, exchange rates |

---

## ✅ Implementation Status

### Fully Working ✅
| Feature | Notes |
|---------|-------|
| Authentication (JWT) | Login, logout, sessions, password change |
| Role-based access control | 5 roles, permission guards on all routes |
| Buyers & Contacts | CRUD, communication log, full history |
| Products & Categories | CRUD with HSN code, default packaging |
| Suppliers & Pricing | Per-product price lists |
| CHA Agents & Rates | Port-based rate management |
| Transporters & Rates | Distance/route-based rates |
| Inquiries & Follow-ups | Full pipeline, stage tracking |
| Quotations | Costing, margin, ports, PDF, status workflow |
| Order Management | Full lifecycle, procurement, documents, shipments |
| Invoices & Payments | Multi-type (Commercial, Proforma, Sample, Packing List), PDF, receivables |
| Exchange Rates | Market comparison (advisory only — all amounts stored in INR) |
| Dashboard | KPIs, charts, multi-currency totals, role-scoped views |
| Expenses & Income | CRUD with categorization, payment tracking |
| Tasks | CRUD, complete, reopen, role-scoped visibility |
| Users | CRUD, roles, deactivate/reactivate |
| Master Data | Countries, ports, currencies, Incoterms with deactivate/reactivate |
| Master Data Lifecycle | Soft delete with cascade preview, reactivation |
| Audit Log | Full activity tracking with UI viewer |
| Record Deletion | Founder-only permanent delete with cascade preview |
| Webhooks | Create, test, SSRF-protected |
| PDF Generation | Quotation, Purchase Order, Invoice (4 types), Packing List |
| Deployment | Single `deploy.cmd` script (Windows) |
| Verification Scripts | TypeScript, API contract, PDF, and logic verification |
| Error Handling | Friendly error states with retry on all major pages |
| Smart Defaults | Auto-fill from buyer (payment terms), order (ports), creditDays (due date) |
| Seeded Ports | 27 major Indian and international ports pre-loaded |

### Partial / Not Yet Complete ⚠️
| Feature | Status |
|---------|--------|
| Automation Rules | Stored in DB, no visual builder, rules don't fire yet |
| Email Notifications | `EmailQueue` model exists, SMTP not configured |
| API Keys | Settings UI shows mock data, not wired to real keys |
| Redis | Container runs, no application code uses it yet |
| Tally Export | Not implemented |
| GST e-Invoice | Not implemented |
| Mobile App | Web-only |

---

## 🎨 Brand Colors

| Color | Hex | Usage |
|-------|-----|-------|
| Navy | `#1e3a5f` | Primary, backgrounds, headings |
| Gold | `#c9a227` | Accents, CTAs, highlights |

---

## 🗄️ Database

**46 Prisma models** across these domains:

| Domain | Models |
|--------|--------|
| Auth | User, Session, ApiKey |
| Master | Country, Port, Currency, Incoterm, ProductCategory |
| Products | Product, Supplier, SupplierPrice |
| Logistics | CHA, CHARate, Transporter, TransportRate |
| CRM | Buyer, BuyerContact, Communication |
| Sales | Inquiry, InquiryItem, FollowUp |
| Quotations | Quotation, QuotationItem, QuotationCost |
| Orders | ExportOrder, OrderItem, Procurement, ProcurementItem, Document, Shipment |
| Finance | Invoice, Payment, Expense, ExpensePayment, Income |
| System | CompanyProfile, Employee, Task, AuditLog, SystemSetting |
| Sequences | NumberSequence |
| Automation | Webhook, WebhookLog, Template, AutomationRule, EmailQueue |

---

## 📝 License

Proprietary — SeaBridge Exports © 2026. All rights reserved.
