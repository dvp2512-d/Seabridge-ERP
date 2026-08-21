-- Payment idempotency key for duplicate prevention
-- Allows safe retry of payment requests without double-recording

-- Add nullable idempotency_key column to payments table
ALTER TABLE "payments" ADD COLUMN "idempotency_key" TEXT;

-- Create unique index for idempotency lookups
-- Allows multiple NULL values (payments without idempotency key) but enforces
-- uniqueness when a key is provided
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");
