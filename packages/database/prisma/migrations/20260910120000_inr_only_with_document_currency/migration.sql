--
-- INR-only storage, with currency and exchange rate chosen per document.
--
-- Every monetary column in the schema is in INR. Previously each document carried
-- its own currency and the reporting layer converted to INR at READ time using a
-- single mutable rate on `currencies`. That meant editing one rate silently
-- re-priced every historical figure in the application: the same USD 5,000 payment
-- reported as 415,600 at a rate of 83.12 and 478,250 at 95.65.
--
-- Currency now applies only where it is actually needed - on the document a buyer
-- receives - and is recorded on that document together with the rate used, so a
-- reprint reproduces what was sent and no later edit can move a past total.
--
-- WARNING: existing quotation, order and invoice amounts were denominated in each
-- record's own currency. There is no safe automatic reinterpretation of those
-- figures as INR, so transactional rows are cleared. Expenses are already INR and
-- are preserved, as is all master data.

-- ---------------------------------------------------------------------------
-- 1. Clear transactional rows whose amounts are in an unknown currency.
--    Child rows first, to respect foreign keys.
-- ---------------------------------------------------------------------------
DELETE FROM "payments";
DELETE FROM "income" WHERE "linked_invoice_id" IS NOT NULL;
DELETE FROM "invoices";
DELETE FROM "documents";
DELETE FROM "shipments";
DELETE FROM "procurements";
DELETE FROM "order_items";
DELETE FROM "export_orders";
DELETE FROM "quotation_costs";
DELETE FROM "quotation_items";
DELETE FROM "quotations";
DELETE FROM "follow_ups";
DELETE FROM "inquiry_items";
DELETE FROM "inquiries";

-- Buyer revenue was accumulated from converted payments, so it no longer means
-- anything once those payments are gone.
UPDATE "buyers" SET "total_revenue" = 0, "total_orders" = 0;

-- ---------------------------------------------------------------------------
-- 2. Presentation currency + rate on the two documents that are printed.
--    Nullable: a document that has never been generated has no currency yet.
--    12,6 precision so a rate such as 0.556000 (JPY) survives intact.
-- ---------------------------------------------------------------------------
ALTER TABLE "quotations" ADD COLUMN "pdf_currency" TEXT;
ALTER TABLE "quotations" ADD COLUMN "pdf_exchange_rate" DECIMAL(12,6);
ALTER TABLE "quotations" ADD COLUMN "pdf_generated_at" TIMESTAMP(3);

ALTER TABLE "invoices" ADD COLUMN "pdf_currency" TEXT;
ALTER TABLE "invoices" ADD COLUMN "pdf_exchange_rate" DECIMAL(12,6);
ALTER TABLE "invoices" ADD COLUMN "pdf_generated_at" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- 3. Drop per-record currency. Amounts are INR by definition now.
-- ---------------------------------------------------------------------------
ALTER TABLE "quotations" DROP CONSTRAINT IF EXISTS "quotations_currency_id_fkey";
ALTER TABLE "quotations" DROP COLUMN IF EXISTS "currency_id";

ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_currency_id_fkey";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "currency_id";
-- Superseded by pdf_exchange_rate. The _ref/_date pair was never populated.
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "exchange_rate";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "exchange_rate_ref";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "exchange_rate_date";

ALTER TABLE "inquiries" DROP CONSTRAINT IF EXISTS "inquiries_currency_id_fkey";
ALTER TABLE "inquiries" DROP COLUMN IF EXISTS "currency_id";

ALTER TABLE "export_orders" DROP COLUMN IF EXISTS "currency";
ALTER TABLE "expenses" DROP COLUMN IF EXISTS "currency";
ALTER TABLE "payments" DROP COLUMN IF EXISTS "currency";
ALTER TABLE "payments" DROP COLUMN IF EXISTS "exchange_rate";

-- ---------------------------------------------------------------------------
-- 4. The global rate is gone. A currency is now just code, name and symbol.
--    `income` keeps its own original_amount/exchange_rate/amount_inr trio: it
--    records a receipt that genuinely arrived in a foreign currency, converts on
--    write, and already stores the INR result.
-- ---------------------------------------------------------------------------
ALTER TABLE "currencies" DROP COLUMN IF EXISTS "exchange_rate";
