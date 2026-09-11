--
-- Expenses generated from source records, with outgoing payment tracking.
--
-- Filling in a supplier procurement, or the freight, CHA and transport costs on a
-- shipment, now produces the matching expense automatically. Two things were
-- missing before this could work:
--
--   1. Nothing linked an expense to the record it came from, so a generated expense
--      and a hand-entered one for the same cost were indistinguishable and the
--      dashboard counted both.
--   2. An expense had a single PENDING/APPROVED/PAID flag and no payment records,
--      so a supplier paid 50% in advance could not be represented at all. Money
--      arriving was tracked properly through Payment; money leaving was not.
--
-- Everything here is additive and nullable, so it is safe on a populated database.
-- No existing expense changes meaning: they all become sourceType MANUAL, which is
-- what they are.

-- ---------------------------------------------------------------------------
-- 1. Where an expense came from.
--
--    The unique index on (source_type, source_id) is what makes generation
--    idempotent - saving a shipment twice updates the one expense rather than
--    inserting a second, enforced by the database rather than by the calling code.
--    Postgres treats NULLs as distinct in a unique index, so the many MANUAL rows
--    with a NULL source_id do not collide.
-- ---------------------------------------------------------------------------
ALTER TABLE "expenses" ADD COLUMN "source_type" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "expenses" ADD COLUMN "source_id" TEXT;
ALTER TABLE "expenses" ADD COLUMN "is_generated" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "expenses_source_type_source_id_key"
  ON "expenses" ("source_type", "source_id");

-- ---------------------------------------------------------------------------
-- 2. Outgoing payment tracking, mirroring Invoice.paidAmount / balanceAmount.
--
--    Existing rows are backfilled from their status: an expense already marked PAID
--    is treated as fully paid, anything else as fully outstanding. That is the only
--    reading the old single flag supports, and it keeps the payables figure honest
--    from the first day rather than showing every historical expense as unpaid.
-- ---------------------------------------------------------------------------
ALTER TABLE "expenses" ADD COLUMN "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "expenses" ADD COLUMN "balance_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

UPDATE "expenses"
   SET "paid_amount"    = CASE WHEN "status" = 'PAID' THEN "amount" ELSE 0 END,
       "balance_amount" = CASE WHEN "status" = 'PAID' THEN 0 ELSE "amount" END;

CREATE TABLE "expense_payments" (
    "id" TEXT NOT NULL,
    "expense_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_date" TIMESTAMP(3) NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "expense_payments_expense_id_idx" ON "expense_payments" ("expense_id");
CREATE INDEX "expense_payments_payment_date_idx" ON "expense_payments" ("payment_date");

-- Cascade: an expense's payment history has no meaning without the expense, and
-- permanent deletion is already a Founder-only operation with a cascade preview.
ALTER TABLE "expense_payments"
  ADD CONSTRAINT "expense_payments_expense_id_fkey"
  FOREIGN KEY ("expense_id") REFERENCES "expenses"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. Indexes the expense list and dashboard filter on.
-- ---------------------------------------------------------------------------
CREATE INDEX "expenses_category_idx" ON "expenses" ("category");
CREATE INDEX "expenses_status_idx" ON "expenses" ("status");
CREATE INDEX "expenses_expense_date_idx" ON "expenses" ("expense_date");

-- ---------------------------------------------------------------------------
-- 4. What the CHA and the transporter actually charged.
--
--    Freight already had a column. CHA and transport charges had nowhere to live:
--    cha_rates and transport_rates are rate cards used to price a quotation, and
--    quotation_costs holds the estimate quoted to the buyer. Neither is what is
--    owed, so there was no figure to raise an expense from.
-- ---------------------------------------------------------------------------
ALTER TABLE "shipments" ADD COLUMN "cha_charges" DECIMAL(12,2);
ALTER TABLE "shipments" ADD COLUMN "transport_charges" DECIMAL(12,2);
