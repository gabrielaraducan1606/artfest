/*
  Warnings:

  - The values [RETURNS_POLICY] on the enum `VendorDoc` will be removed. If these variants are still used in the database, this will fail.

*/
-- CreateEnum
CREATE TYPE "ProductAvailability" AS ENUM ('READY', 'MADE_TO_ORDER', 'PREORDER', 'SOLD_OUT');

-- AlterEnum
BEGIN;
CREATE TYPE "VendorDoc_new" AS ENUM ('VENDOR_TERMS', 'SHIPPING_ADDENDUM', 'RETURNS_POLICY_ACK');
ALTER TABLE "VendorPolicy" ALTER COLUMN "document" TYPE "VendorDoc_new" USING ("document"::text::"VendorDoc_new");
ALTER TABLE "VendorAcceptance" ALTER COLUMN "document" TYPE "VendorDoc_new" USING ("document"::text::"VendorDoc_new");
ALTER TYPE "VendorDoc" RENAME TO "VendorDoc_old";
ALTER TYPE "VendorDoc_new" RENAME TO "VendorDoc";
DROP TYPE "public"."VendorDoc_old";
COMMIT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "acceptsCustom" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "availability" "ProductAvailability" NOT NULL DEFAULT 'READY',
ADD COLUMN     "isHidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "leadTimeDays" INTEGER,
ADD COLUMN     "limitedEditionNumber" INTEGER,
ADD COLUMN     "limitedEditionOf" INTEGER,
ADD COLUMN     "nextShipDate" TIMESTAMP(3),
ADD COLUMN     "readyQty" INTEGER DEFAULT 0;

-- CreateIndex
CREATE INDEX "Product_isHidden_isActive_availability_createdAt_idx" ON "Product"("isHidden", "isActive", "availability", "createdAt");
