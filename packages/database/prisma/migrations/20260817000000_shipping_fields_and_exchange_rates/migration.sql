-- Quotation shipping details, order ports, and the notified exchange rate history.
--
-- These columns were added to schema.prisma without a matching migration, so a
-- fresh `prisma migrate deploy` produced a database the application could not
-- query. Everything here is additive and nullable, so it is safe to apply to a
-- database that already holds data.

-- ---------------------------------------------------------------------------
-- Quotation: the shipping block printed in rows 6 and 7 of every document
-- ---------------------------------------------------------------------------
ALTER TABLE "quotations" ADD COLUMN     "dispatch_method" TEXT,
ADD COLUMN     "shipment_type" TEXT,
ADD COLUMN     "port_of_loading_id" TEXT,
ADD COLUMN     "port_of_discharge_id" TEXT;

ALTER TABLE "quotations" ADD CONSTRAINT "quotations_port_of_loading_id_fkey" FOREIGN KEY ("port_of_loading_id") REFERENCES "ports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_port_of_discharge_id_fkey" FOREIGN KEY ("port_of_discharge_id") REFERENCES "ports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Export order: ports carried over from the quotation, so invoices and packing
-- lists can name them before a shipment record exists
-- ---------------------------------------------------------------------------
ALTER TABLE "export_orders" ADD COLUMN     "port_of_loading_id" TEXT,
ADD COLUMN     "port_of_discharge_id" TEXT;

ALTER TABLE "export_orders" ADD CONSTRAINT "export_orders_port_of_loading_id_fkey" FOREIGN KEY ("port_of_loading_id") REFERENCES "ports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "export_orders" ADD CONSTRAINT "export_orders_port_of_discharge_id_fkey" FOREIGN KEY ("port_of_discharge_id") REFERENCES "ports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Inquiry: expected value had no currency, which made the pipeline total
-- impossible to convert or even interpret
-- ---------------------------------------------------------------------------
ALTER TABLE "inquiries" ADD COLUMN     "currency_id" TEXT;

ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Currency: mark the company's own reporting currency so aggregates convert
-- into it rather than assuming a hardcoded USD
-- ---------------------------------------------------------------------------
ALTER TABLE "currencies" ADD COLUMN     "is_base_currency" BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Invoice: record which notified rate was used, so a customs document stays
-- reproducible after a later notification supersedes it
-- ---------------------------------------------------------------------------
ALTER TABLE "invoices" ADD COLUMN     "exchange_rate_ref" TEXT,
ADD COLUMN     "exchange_rate_date" DATE;

-- ---------------------------------------------------------------------------
-- Notified exchange rate history.
--
-- CBIC notifies 22 currencies twice a month, effective from midnight of the
-- following day, with separate rates for imports and exports. Rates are kept as
-- a dated history because customs values a shipping bill using the rate in
-- force on the relevant date.
-- ---------------------------------------------------------------------------
CREATE TABLE "exchange_rates" (
    "id" TEXT NOT NULL,
    "currency_id" TEXT NOT NULL,
    "import_rate" DECIMAL(12,4) NOT NULL,
    "export_rate" DECIMAL(12,4) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "source" TEXT NOT NULL DEFAULT 'CBIC',
    "notification_ref" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "exchange_rates_currency_id_effective_from_idx" ON "exchange_rates"("currency_id", "effective_from");
CREATE INDEX "exchange_rates_effective_from_idx" ON "exchange_rates"("effective_from");
CREATE UNIQUE INDEX "exchange_rates_currency_id_source_effective_from_key" ON "exchange_rates"("currency_id", "source", "effective_from");

ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
