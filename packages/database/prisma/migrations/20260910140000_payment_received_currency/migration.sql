--
-- Record what a remittance looked like before conversion.
--
-- A payment is stored in INR, because the rupee sum the bank credited is the only
-- figure that is actually realised, and it is what every total uses. But when the
-- money arrives as USD 5,000 at 94.10, losing those two numbers makes the entry
-- impossible to reconcile against the bank advice.
--
-- These three columns are REFERENCE ONLY. Nothing sums them, and `amount` remains
-- the sole authoritative figure, so they cannot drift out of step with a report.

ALTER TABLE "payments" ADD COLUMN "received_currency" TEXT;
ALTER TABLE "payments" ADD COLUMN "received_amount" DECIMAL(15,2);
ALTER TABLE "payments" ADD COLUMN "exchange_rate" DECIMAL(12,6);
