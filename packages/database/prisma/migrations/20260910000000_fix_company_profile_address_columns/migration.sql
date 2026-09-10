--
-- Align company_profile with schema.prisma.
--
-- company_profile was first created by 20260816000000_export_documents with the
-- columns "address_line1"/"address_line2". 20260822000000_schema_cleanup then
-- declared the same table with "address_line_1"/"address_line_2", but guarded it
-- with CREATE TABLE IF NOT EXISTS - so on any database that had already run the
-- earlier migration the statement was a no-op and the rename never happened.
--
-- schema.prisma maps addressLine1/addressLine2 to "address_line_1"/"address_line_2",
-- so every Prisma query against CompanyProfile failed with
--   The column `company_profile.address_line_1` does not exist in the current database
-- which returned 400 from GET/PUT /api/settings/company and left the Settings
-- company profile unusable.
--
-- Renames are used rather than add-and-drop so any existing address data is kept.
-- Each step is guarded so this migration is safe on a database that already has
-- the correct column names (e.g. one created from scratch after the cleanup).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'company_profile' AND column_name = 'address_line1'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'company_profile' AND column_name = 'address_line_1'
  ) THEN
    ALTER TABLE "company_profile" RENAME COLUMN "address_line1" TO "address_line_1";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'company_profile' AND column_name = 'address_line2'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'company_profile' AND column_name = 'address_line_2'
  ) THEN
    ALTER TABLE "company_profile" RENAME COLUMN "address_line2" TO "address_line_2";
  END IF;
END $$;
