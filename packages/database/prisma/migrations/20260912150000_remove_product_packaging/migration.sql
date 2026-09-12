-- Remove default packaging fields from products table
-- These fields were used to auto-fill order line packing details but are no longer needed.

ALTER TABLE "products" DROP COLUMN IF EXISTS "package_type";
ALTER TABLE "products" DROP COLUMN IF EXISTS "package_net_weight";
ALTER TABLE "products" DROP COLUMN IF EXISTS "package_gross_weight";
