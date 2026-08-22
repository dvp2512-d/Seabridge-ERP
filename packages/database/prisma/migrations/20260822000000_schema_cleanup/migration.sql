-- Schema cleanup: align database with simplified Prisma schema.
--
-- The exchange_rates table and is_base_currency column were added in a previous
-- migration but never reflected in schema.prisma. The application code has been
-- updated to work without these features (using a simpler approach where each
-- currency stores its own exchange rate and INR is implicitly the base currency).
--
-- This migration drops the unused structures and adds missing tables.

-- Drop exchange_rates table (unused - rate stored on currency.exchange_rate)
DROP TABLE IF EXISTS "exchange_rates";

-- Remove is_base_currency column from currencies (INR is implicitly base)
ALTER TABLE "currencies" DROP COLUMN IF EXISTS "is_base_currency";

-- ---------------------------------------------------------------------------
-- Company Profile: the exporter's own details for documents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "company_profile" (
    "id" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "trade_name" TEXT,
    "address_line_1" TEXT,
    "address_line_2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postal_code" TEXT,
    "country" TEXT NOT NULL DEFAULT 'India',
    "origin_country" TEXT NOT NULL DEFAULT 'India',
    "gst_number" TEXT,
    "iec_code" TEXT,
    "phone" TEXT,
    "contact_person" TEXT,
    "email" TEXT,
    "website" TEXT,
    "bank_name" TEXT,
    "bank_branch" TEXT,
    "bank_account_no" TEXT,
    "bank_beneficiary" TEXT,
    "bank_swift_code" TEXT,
    "bank_ifsc_code" TEXT,
    "bank_charges_note" TEXT,
    "quotation_terms" TEXT,
    "invoice_declaration" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_profile_pkey" PRIMARY KEY ("id")
);
