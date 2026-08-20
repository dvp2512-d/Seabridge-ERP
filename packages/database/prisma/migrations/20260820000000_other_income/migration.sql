-- Other Income: non-export-sale receipts.
--
-- Duty drawback, RoDTEP scrips, interest, forex gain, commission, scrap sales and
-- recovered sample charges had nowhere to go, so none of it appeared in any total.
--
-- Additive only: one new table and its indexes. Invoice, Payment, Expense and
-- every existing calculation are untouched, so this is safe to apply to a
-- database already holding data.
--
-- amount_inr is stored rather than derived at read time so that reports remain
-- reproducible: a rate corrected later does not silently restate history, and the
-- rate actually used stays visible on the row beside the converted figure.

CREATE TABLE "income" (
    "id" TEXT NOT NULL,
    "income_number" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "original_amount" DECIMAL(15,2) NOT NULL,
    "original_currency" TEXT NOT NULL DEFAULT 'INR',
    "exchange_rate" DECIMAL(12,4) NOT NULL DEFAULT 1.0000,
    "amount_inr" DECIMAL(15,2) NOT NULL,
    "reference" TEXT,
    "linked_invoice_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "received_date" DATE NOT NULL,
    "notes" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "income_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "income_income_number_key" ON "income"("income_number");
CREATE INDEX "income_received_date_idx" ON "income"("received_date");
CREATE INDEX "income_category_idx" ON "income"("category");
CREATE INDEX "income_status_idx" ON "income"("status");

-- SET NULL rather than RESTRICT: deleting an invoice should not be blocked by a
-- forex gain entry, but the entry must not point at a row that no longer exists.
ALTER TABLE "income" ADD CONSTRAINT "income_linked_invoice_id_fkey" FOREIGN KEY ("linked_invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RESTRICT on the recorder: who booked a receipt is part of the audit trail, so a
-- user cannot be removed while their entries exist. Users are deactivated rather
-- than deleted, so this does not block normal operation.
ALTER TABLE "income" ADD CONSTRAINT "income_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
