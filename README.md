# SeaBridge

**Master Enterprise Edition V1.0**

A complete business management system for SeaBridge Exports — managing buyers, inquiries, quotations, orders, shipments, and finances in one connected platform.

## 🎯 Features

- **360° Buyer View** - Complete customer history and relationship management
- **Sales Pipeline** - Inquiry to order workflow with follow-up tracking
- **Automatic Costing** - Pull pricing from suppliers, CHA, and transporters
- **PDF Quotations & Invoices** - Professional branded documents
- **Export Operations** - Order, procurement, documentation, and shipment tracking
- **Finance Module** - Invoices, receivables, payables, and profitability
- **Founder Dashboard** - Real-time KPIs and business analytics
- **Role-Based Access** - Founder, Sales, Operations, Finance roles

## 🏗️ Tech Stack

- **Frontend**: React, TypeScript, Tailwind CSS, React Query, Zustand
- **Backend**: Node.js, Express, Prisma ORM
- **Database**: PostgreSQL
- **PDF**: PDFKit
- **Deployment**: Docker

> A Redis container is included in `docker-compose.yml` and `REDIS_URL` is passed
> to the API, but **no application code uses Redis yet**. It is reserved for
> future caching/sessions. You can safely comment the `redis` service out if you
> want one less container running.

## 🚀 Quick Start

### Option A — one command (recommended)

The only thing you need installed is **Docker Desktop**. Node.js, npm and Prisma
are *not* required on the host — every build, migration and seed step runs inside
a container.

From a terminal in the project folder (or just double-click the file):

```
deploy.cmd
```

The script will:

1. Check Docker is installed and running
2. Create `.env` from the template, generating a strong random database password
   and JWT secret if the file doesn't exist yet
3. Build the API and web images
4. Start PostgreSQL, wait until it accepts connections, then verify the password
5. Apply the database migrations (falling back to `db push` if the schema was
   created that way) and seed the starter data
6. Start the API and web containers and wait for the health check

Then open **http://localhost:3000**.

Other commands:

| Command | What it does |
|---|---|
| `deploy.cmd` | Deploy or update. Safe to re-run. |
| `deploy.cmd reset` | Wipe the database and start clean (asks you to type `DELETE`) |
| `deploy.cmd noseed` | Deploy without inserting starter data |
| `deploy.cmd stop` | Stop the stack, keep all data |
| `deploy.cmd logs` | Follow container logs |
| `deploy.cmd status` | Show what's running |
| `deploy.cmd help` | List the options |

After deploying, confirm it actually works:

```
powershell -ExecutionPolicy Bypass -File scripts\smoke-test.ps1
```

This logs in and drives the whole flow — buyer → product → quotation → order →
invoice → payment — plus PDF generation and the auth checks. It creates test
records, so run it against a fresh database.

> **Linux / macOS:** there is no shell equivalent of `deploy.cmd` yet. Use the
> manual steps in Option B, or run the same sequence by hand:
> `docker compose up -d postgres`, then
> `docker compose run --rm --no-deps api sh -c "cd /app/packages/database && npx prisma migrate deploy && npx ts-node prisma/seed.ts"`,
> then `docker compose up -d`.

### Option B — manual setup (for development)

Use this if you want to run the dev servers with hot reload. This path **does**
require Node.js 18+ on the host.

#### Prerequisites
- Docker Desktop (for PostgreSQL)
- Node.js 18+

#### Steps

1. **Install dependencies** (run from the repo root — this is an npm workspace)
```bash
npm install
```

2. **Create your environment file**
```bash
cp .env.example .env          # macOS/Linux
copy .env.example .env        # Windows CMD
Copy-Item .env.example .env   # Windows PowerShell
```

Then open `.env` and set at least these two — Docker Compose reads them and will
refuse to start with a clear message if they are missing:

| Variable | Why it matters |
|---|---|
| `POSTGRES_PASSWORD` | Your database password. Must match the one inside `DATABASE_URL`. |
| `JWT_SECRET` | Signs login tokens. Anyone who knows it can log in as any user. Use a long random string. |

> `.env` is gitignored and must never be committed. `.env.example` is the
> template that *is* committed — keep it free of real values.

> Leave `VITE_API_URL` empty for local development. The Vite dev server proxies
> `/api` to the API on port 4000, which avoids CORS entirely. Only set it if the
> frontend must call an API on a different host — and include the `/api` suffix.

3. **Start the database services**
```bash
docker compose up -d postgres redis
```

4. **Generate the Prisma client and build the shared database package**
```bash
npm run db:generate
npm run build -w packages/database
```

> The build step is required. `apps/api` imports `@seabridge/database`, whose
> entry point is `packages/database/dist/index.js`, so the API cannot start
> until that package has been compiled at least once.

5. **Create the schema and seed starting data**

For a brand-new empty database:
```bash
npm run db:deploy   # applies packages/database/prisma/migrations
npm run db:seed
```

> **If `db:deploy` fails with `P3005: The database schema is not empty`**, the
> database was created with `db:push` rather than migrations. Either use
> `npm run db:push` from then on, or reset it (this **destroys all data**):
> ```bash
> docker compose down -v postgres   # deletes the database volume
> docker compose up -d postgres
> npm run db:deploy
> npm run db:seed
> ```
> Use `db:deploy` consistently if you want a reproducible schema history.
> Use `db:push` only for throwaway local databases.

6. **Start the dev servers**
```bash
npm run dev
```

- Frontend: http://localhost:3000
- API: http://localhost:4000
- API health check: http://localhost:4000/health

7. **Log in, then immediately change the passwords** — see [Default Login](#-default-login).

### Verifying the project

These checks run entirely offline — no server or database required:

```bash
npm run typecheck        # TypeScript for api + web, zero errors expected
npm run verify:contract  # every frontend API call maps to a real backend route
npm run verify:pdf       # generates quotation/invoice PDFs from mock data
npm run verify:logic     # currency, date and margin calculations
npm run verify           # all of the above
npm run db:validate      # Prisma schema validity
```

### Production build

Run the steps in this order — the API will serve errors if it starts before the
schema exists.

```bash
# 1. Make sure .env holds a strong POSTGRES_PASSWORD and JWT_SECRET
# 2. Start only the database first
docker compose up -d postgres

# 3. Apply the schema and seed (uses DATABASE_URL from .env, host port 5432)
npm run db:deploy
npm run db:seed

# 4. Build and start the API + web containers
docker compose up -d --build
```

- Web: http://localhost:3000
- API: http://localhost:4000

Then:

- Log in and change both seeded passwords immediately.
- Confirm `JWT_SECRET` in `.env` is a long random value. Generate one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  ```
- `.env` is read automatically by Docker Compose. Secrets are **not** stored in
  `docker-compose.yml` — it only references `${VARIABLE}` names.

To stop everything: `docker compose down` (add `-v` to also delete the database
volume, which erases all data).

## 📁 Project Structure

```
seabridge-ERP/
├── apps/
│   ├── api/          # Express backend
│   │   ├── src/
│   │   │   ├── routes/       # API routes
│   │   │   ├── middleware/   # Auth, error handling
│   │   │   ├── services/     # PDF generation, etc.
│   │   │   └── utils/        # Helpers
│   │   └── Dockerfile
│   └── web/          # React frontend
│       ├── src/
│       │   ├── components/   # Reusable components
│       │   ├── pages/        # Route pages
│       │   ├── store/        # Zustand state
│       │   └── lib/          # API client, utils
│       └── Dockerfile
├── packages/
│   └── database/     # Prisma schema & migrations
├── docker-compose.yml
└── package.json
```

## 🔐 Default Login

The seed creates **two** accounts, both with the password `admin123`:

| Email | Role | Purpose |
|---|---|---|
| `founder@seabridge.com` | FOUNDER | Full access |
| `hiren@seabridge.com` | SALES | Example sales user |

**Change both passwords the first time you log in.** These credentials are in the
public source code, so anyone who can reach your instance can log in until you do.

To change a password: log in → **Settings → Profile → Change Password**.

There is no user-management screen yet, so to add or remove staff accounts you
currently need the API (`POST /api/users`, requires a FOUNDER or ADMIN token) or
edit `packages/database/prisma/seed.ts` before seeding.

## 🎨 Brand Colors

- **Navy**: #1e3a5f
- **Gold**: #c9a227

## 📊 Core Modules

| Module | Description |
|--------|-------------|
| Dashboard | KPIs, alerts, pending tasks |
| CRM/Buyers | Buyer database with 360° view |
| Sales | Inquiries, pipeline, follow-ups |
| Quotations | Costing, pricing, PDF export |
| Orders | Export order management |
| Operations | Procurement, documents, shipments |
| Finance | Invoices, payments, receivables |
| Master Data | Countries, currencies, Incoterms, categories, ports |
| Settings | Profile, company defaults, document templates |

## ✅ Implementation Status

Fully working end to end:

- Buyers, Products, Suppliers (with per-product pricing), CHA agents, Transporters
- Inquiries with pipeline stages and follow-ups
- Quotations with automatic supplier-price costing, margin calculation and PDF
- Quotation → Order conversion (transactional)
- Orders with procurement, document checklist and shipments
- Invoices with payments, balances, overdue tracking and PDF
- Founder dashboard, role-based access, master data

Present but **not finished** — do not depend on these yet:

| Area | State |
|---|---|
| Automation rules | Stored by the API, but no visual builder and rules never fire |
| Webhooks | Can be created and test-pinged, but business events do not trigger them |
| API keys | Settings tab shows sample data only; not wired to real keys |
| Expenses | Database table exists; no API routes or screen, so profitability excludes costs entered here |
| Tasks | Shown on the dashboard; no screen to create or complete them |
| User management | API works; no UI |
| Audit log | Table exists; nothing writes to it yet |
| Redis | Container runs; no code uses it |

## 🔄 Business Flow

```
Buyer → Inquiry → Quotation → Order → Shipment → Invoice → Payment → Profitability
```

All data flows automatically — enter once, use everywhere.

## 🛡️ User Roles

| Role | Access |
|------|--------|
| Founder | Full system access |
| Admin | Full system access |
| Sales | Buyers, inquiries, quotations |
| Operations | Orders, shipments, documents |
| Finance | Invoices, payments, reports |

## 📝 License

Proprietary - SeaBridge Exports © 2024
