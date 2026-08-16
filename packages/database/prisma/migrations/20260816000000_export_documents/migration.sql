-- Export document support: company profile, packaging/weights and dispatch fields.
--
-- Needed by the Quotation, Sample Invoice, Proforma Invoice, Packing List and
-- Commercial Invoice templates. All changes are additive and nullable, so this
-- migration is safe to apply to a database that already holds data.

-- The exporter's own details, printed on every outgoing document.
CREATE TABLE "company_profile" (
    "id" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "trade_name" TEXT,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postal_code" TEXT,
    "country" TEXT NOT NULL DEFAULT 'INDIA',
    "origin_country" TEXT NOT NULL DEFAULT 'India',
    "gst_number" TEXT,
    "iec_code" TEXT,
    "phone" TEXT,
    "contact_person" TEXT,
    "email" TEXT,
    "website" TEXT,
    "bank_name" TEXT,
    "bank_branch" TEXT,
    "bank_account_no" TEXT,
    "bank_beneficiary" TEXT,
    "bank_swift_code" TEXT,
    "bank_ifsc_code" TEXT,
    "bank_charges_note" TEXT,
    "quotation_terms" TEXT,
    "invoice_declaration" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_profile_pkey" PRIMARY KEY ("id")
);

-- Default packaging per product, used to prefill order lines.
ALTER TABLE "products" ADD COLUMN     "package_type" TEXT,
ADD COLUMN     "package_net_weight" DECIMAL(12,3),
ADD COLUMN     "package_gross_weight" DECIMAL(12,3);

-- Packing figures per order line; these drive the Packing List.
ALTER TABLE "order_items" ADD COLUMN     "number_of_packages" INTEGER,
ADD COLUMN     "package_weight" DECIMAL(12,3),
ADD COLUMN     "net_weight" DECIMAL(12,3),
ADD COLUMN     "gross_weight" DECIMAL(12,3);

-- Header fields printed on every export document.
ALTER TABLE "export_orders" ADD COLUMN     "dispatch_method" TEXT,
ADD COLUMN     "shipment_type" TEXT,
ADD COLUMN     "variation_percent" DECIMAL(5,2);
