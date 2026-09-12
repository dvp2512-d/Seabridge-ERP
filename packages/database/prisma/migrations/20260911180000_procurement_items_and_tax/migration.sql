--
-- Purchase order line items, priced from the supplier's own price list, with GST.
--
-- The purchase order had no lines of its own: `procurements` stored a single
-- `total_amount` that was typed in by hand. The printed PO therefore listed the
-- EXPORT ORDER's items, which carry the price quoted to the buyer with the margin
-- already in it. Two consequences:
--
--   1. Every purchase order showed the supplier the price we sell at. A line costing
--      180.00 from the supplier printed at 210.50.
--   2. The item column summed to the order value while the TOTAL box showed the
--      agreed supplier figure, so the two disagreed on the same page.
--
-- A purchase order now carries its own lines at supplier rates, and its total is
-- computed as rate x quantity plus tax rather than typed.
--
-- Everything is additive. Existing purchase orders keep their agreed total and
-- simply have no lines; their subtotal is backfilled from that total so no figure
-- reads as zero.

-- ---------------------------------------------------------------------------
-- 1. GST rate per product.
--
--    Rates follow the HSN code and differ by product, so the rate belongs on the
--    product rather than being one figure per purchase order. Nullable, because an
--    unknown rate must stay visibly blank rather than default to zero and quietly
--    understate a total.
-- ---------------------------------------------------------------------------
ALTER TABLE "products" ADD COLUMN "gst_rate" DECIMAL(5,2);

-- ---------------------------------------------------------------------------
-- 2. Taxable value and tax on the purchase order.
--
--    total_amount already exists and keeps its meaning - what the supplier will be
--    paid. subtotal is the taxable value and tax_amount the GST on it, so the total
--    can be explained on the printed order instead of appearing as one figure.
--
--    Existing rows are backfilled with subtotal = total_amount and zero tax: that is
--    the only reading available for a figure that was entered as a single number,
--    and it keeps every historical total unchanged.
-- ---------------------------------------------------------------------------
ALTER TABLE "procurements" ADD COLUMN "subtotal" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "procurements" ADD COLUMN "tax_amount" DECIMAL(15,2) NOT NULL DEFAULT 0;

UPDATE "procurements" SET "subtotal" = "total_amount" WHERE "subtotal" = 0;

-- ---------------------------------------------------------------------------
-- 3. The lines themselves.
--
--    quantity carries three decimals because supplier quantities are agreed in
--    fractions of a tonne; rate and the money columns carry two.
--
--    Cascade on delete: a purchase order's lines have no meaning without the order,
--    and permanent deletion is already a Founder-only operation with a preview.
-- ---------------------------------------------------------------------------
CREATE TABLE "procurement_items" (
    "id" TEXT NOT NULL,
    "procurement_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'KG',
    "rate" DECIMAL(12,2) NOT NULL,
    "tax_percent" DECIMAL(5,2),
    "amount" DECIMAL(15,2) NOT NULL,
    "tax_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "procurement_items_procurement_id_idx" ON "procurement_items" ("procurement_id");

ALTER TABLE "procurement_items"
  ADD CONSTRAINT "procurement_items_procurement_id_fkey"
  FOREIGN KEY ("procurement_id") REFERENCES "procurements"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Restrict rather than cascade: a product that has been purchased must not be
-- removable in a way that silently rewrites a purchase order's history.
ALTER TABLE "procurement_items"
  ADD CONSTRAINT "procurement_items_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
