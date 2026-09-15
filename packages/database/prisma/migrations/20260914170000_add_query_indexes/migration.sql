-- Add indexes for commonly filtered columns to improve query performance.

-- Quotation: pipeline and buyer-scoped lookups
CREATE INDEX "quotations_status_buyer_id_idx" ON "quotations"("status", "buyer_id");
CREATE INDEX "quotations_buyer_id_idx" ON "quotations"("buyer_id");
CREATE INDEX "quotations_inquiry_id_idx" ON "quotations"("inquiry_id");

-- Payment: receivables/invoice payment lookups
CREATE INDEX "payments_invoice_id_idx" ON "payments"("invoice_id");
