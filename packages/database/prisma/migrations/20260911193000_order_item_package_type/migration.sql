--
-- Package type on the order line.
--
-- `products.package_type` already held a default, but the order line did not, so a
-- product normally shipped in 25kg bags could not be recorded as shipping in cartons
-- on one particular order - the line silently inherited the product's default.
--
-- It also meant the packing list printed a bare package count. A reader could not
-- tell 40 bags from 40 cartons, and the two are weighed, stacked and handled
-- differently. The type is what makes the count actionable.
--
-- Additive and nullable: a line with no type prints exactly as it does today, and
-- new lines inherit the product's default when the order is created.

ALTER TABLE "order_items" ADD COLUMN "package_type" TEXT;
