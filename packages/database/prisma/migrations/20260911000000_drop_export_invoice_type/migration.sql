--
-- Drop the EXPORT invoice type.
--
-- The document formats this system issues are the invoice-family sheets in
-- MASTER DRAFT.xlsx: Commercial Invoice, Proforma Invoice, Sample Invoice and
-- Packing List. "EXPORT" was a fifth type with no format of its own - it was the
-- column default, so every invoice created without an explicit type became an
-- "Export Invoice" and printed a heading that appears on none of the master
-- sheets.
--
-- On an Indian export shipment the commercial invoice IS the export invoice: it is
-- the document presented for customs assessment, filed against the shipping bill
-- and negotiated with the bank. Two names for one document meant a user choosing
-- between them had no way to know which was correct.
--
-- Existing rows are retyped to COMMERCIAL rather than deleted. The retype is safe
-- for the money figures: EXPORT was never in DOCUMENT_ONLY_INVOICE_TYPES and
-- neither is COMMERCIAL, so these invoices counted as receivables before and count
-- as receivables after. No balance, payment or receivable total moves.

UPDATE "invoices" SET "type" = 'COMMERCIAL' WHERE "type" = 'EXPORT';

ALTER TABLE "invoices" ALTER COLUMN "type" SET DEFAULT 'COMMERCIAL';
