--
-- Packing carried from the enquiry through to the packing list.
--
-- Packaging was recorded in two places: a default on the product, and the actual
-- figures on the order line. Nothing held it at the point it is actually agreed.
--
-- A buyer states how they want goods packed when they enquire - 25kg bags, 50kg
-- sacks, cartons for retail - and it changes the price, because filling a jumbo bag
-- costs differently from filling forty small ones. That requirement was captured in
-- free-text specifications at best, then re-derived from the product's generic
-- default when the order was created, so the packing list could contradict what the
-- buyer had agreed to.
--
-- The requirement now travels: inquiry line -> quotation line -> order line ->
-- packing list. Additive and nullable throughout; a line with nothing set falls back
-- to the product default exactly as it does today.

-- What the buyer asked for.
ALTER TABLE "inquiry_items" ADD COLUMN "package_type" TEXT;
ALTER TABLE "inquiry_items" ADD COLUMN "package_weight" DECIMAL(12,3);

-- What was quoted on. Part of the agreement: a price for 25kg bags is not a price
-- for jumbo bags, so it is held against the quoted line rather than inferred later.
ALTER TABLE "quotation_items" ADD COLUMN "package_type" TEXT;
ALTER TABLE "quotation_items" ADD COLUMN "package_weight" DECIMAL(12,3);
