-- Add additional cost fields to shipments table
-- These match the quotation additional cost types for auto-fill functionality

ALTER TABLE "shipments" ADD COLUMN "packaging_charges" DECIMAL(12,2);
ALTER TABLE "shipments" ADD COLUMN "insurance_charges" DECIMAL(12,2);
ALTER TABLE "shipments" ADD COLUMN "inspection_charges" DECIMAL(12,2);
ALTER TABLE "shipments" ADD COLUMN "commission_charges" DECIMAL(12,2);
ALTER TABLE "shipments" ADD COLUMN "other_charges" DECIMAL(12,2);
