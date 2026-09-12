-- Quotation version tracking
-- Adds version field, revision metadata, and history table for quotation revisions

-- Add version tracking fields to quotations
ALTER TABLE "quotations" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "quotations" ADD COLUMN "revision_reason" TEXT;
ALTER TABLE "quotations" ADD COLUMN "revised_by_id" TEXT;
ALTER TABLE "quotations" ADD COLUMN "revised_at" TIMESTAMP(3);

-- Create quotation_history table for storing revision snapshots
CREATE TABLE "quotation_history" (
    "id" TEXT NOT NULL,
    "quotation_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "subtotal" DECIMAL(15,2) NOT NULL,
    "total_cost" DECIMAL(15,2) NOT NULL,
    "total_margin" DECIMAL(15,2) NOT NULL,
    "margin_percent" DECIMAL(5,2) NOT NULL,
    "grand_total" DECIMAL(15,2) NOT NULL,
    "valid_until" TIMESTAMP(3) NOT NULL,
    "payment_terms" TEXT,
    "delivery_terms" TEXT,
    "status" TEXT NOT NULL,
    "items_snapshot" JSONB NOT NULL,
    "costs_snapshot" JSONB NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "revision_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotation_history_pkey" PRIMARY KEY ("id")
);

-- Add indexes
CREATE INDEX "quotation_history_quotation_id_version_idx" ON "quotation_history"("quotation_id", "version");

-- Add foreign key constraints
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_revised_by_id_fkey" 
    FOREIGN KEY ("revised_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "quotation_history" ADD CONSTRAINT "quotation_history_quotation_id_fkey" 
    FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
