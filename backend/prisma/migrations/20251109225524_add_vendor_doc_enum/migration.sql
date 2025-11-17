/*
  Warnings:

  - The values [RETURNS_POLICY_ACK] on the enum `VendorDoc` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "VendorDoc_new" AS ENUM ('VENDOR_TERMS', 'SHIPPING_ADDENDUM', 'RETURNS_POLICY');
ALTER TABLE "VendorPolicy" ALTER COLUMN "document" TYPE "VendorDoc_new" USING ("document"::text::"VendorDoc_new");
ALTER TABLE "VendorAcceptance" ALTER COLUMN "document" TYPE "VendorDoc_new" USING ("document"::text::"VendorDoc_new");
ALTER TYPE "VendorDoc" RENAME TO "VendorDoc_old";
ALTER TYPE "VendorDoc_new" RENAME TO "VendorDoc";
DROP TYPE "public"."VendorDoc_old";
COMMIT;
