--
-- The document parameters that had no field behind them.
--
-- Each of the six documents in MASTER DRAFT.xlsx has boxes that printed blank, or
-- printed a constant compiled into the renderer, because nothing in the schema held
-- the value. This adds the fields so every parameter on a document can be entered
-- in the module it belongs to and tracked from there.
--
-- Everything is additive and nullable. No document output changes until a field is
-- filled in, and every existing record stays valid.

-- ---------------------------------------------------------------------------
-- 1. The party invoiced, when it is not the consignee receiving the goods.
--
--    Prints in the "Buyer ( If Other than Consinee )" box on all four
--    invoice-family sheets. A self-reference to buyers: the bill-to party is a
--    buyer in their own right, with their own address and tax registration, so
--    duplicating those columns onto the order would be a second copy to maintain.
--
--    ON DELETE SET NULL: removing a buyer must not take the order with it. The
--    order remains valid, and the box goes back to printing empty.
-- ---------------------------------------------------------------------------
ALTER TABLE "export_orders" ADD COLUMN "bill_to_buyer_id" TEXT;

CREATE INDEX "export_orders_bill_to_buyer_id_idx" ON "export_orders" ("bill_to_buyer_id");

ALTER TABLE "export_orders"
  ADD CONSTRAINT "export_orders_bill_to_buyer_id_fkey"
  FOREIGN KEY ("bill_to_buyer_id") REFERENCES "buyers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Why a sample shipment carries a declared value but no payment.
--
--    The Purpose box on the sample invoice. Was a string compiled into the PDF
--    renderer, so it could not be varied per shipment even though the reason
--    genuinely differs - laboratory testing, buyer evaluation, exhibition.
-- ---------------------------------------------------------------------------
ALTER TABLE "invoices" ADD COLUMN "purpose" TEXT;

-- ---------------------------------------------------------------------------
-- 3. The purchase order boxes.
--
--    Seven of these printed empty on every PO, and packing instructions had to be
--    written into `notes` because there was nowhere else to put them. A supplier
--    reading a PO needs the delivery point, the packing specification and the
--    quality requirement; those are the terms of the order, not a note.
-- ---------------------------------------------------------------------------
ALTER TABLE "procurements" ADD COLUMN "delivery_address" TEXT;
ALTER TABLE "procurements" ADD COLUMN "mode_of_delivery" TEXT;
ALTER TABLE "procurements" ADD COLUMN "payment_mode" TEXT;
ALTER TABLE "procurements" ADD COLUMN "pickup_location" TEXT;
ALTER TABLE "procurements" ADD COLUMN "destination" TEXT;
ALTER TABLE "procurements" ADD COLUMN "packing_instructions" TEXT;
ALTER TABLE "procurements" ADD COLUMN "quality_requirement" TEXT;
ALTER TABLE "procurements" ADD COLUMN "variation_percent" DECIMAL(5,2);

-- ---------------------------------------------------------------------------
-- 4. Purchase order terms, editable like quotation terms already are.
--
--    The six clauses on the PO sheet were hardcoded in the renderer, so changing a
--    jurisdiction or a COA requirement needed a deployment. They are the
--    exporter's own trading conditions and belong with the company profile.
-- ---------------------------------------------------------------------------
ALTER TABLE "company_profile" ADD COLUMN "purchase_order_terms" TEXT;
