-- Add default packaging fields to products table
-- These fields prefill quotation lines when no buyer-specific packing was requested,
-- and serve as fallback for fillOrderPacking when the quotation itself had no packing set.

ALTER TABLE "products" ADD COLUMN "default_package_type" TEXT;
ALTER TABLE "products" ADD COLUMN "default_package_weight" DECIMAL(12,3);
