/*
  Warnings:

  - You are about to drop the column `stripePaymentMethodId` on the `VendorBilling` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "public"."VendorBilling_stripePaymentMethodId_idx";

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "stripeChargeId" VARCHAR(255);

-- AlterTable
ALTER TABLE "VendorBilling" DROP COLUMN "stripePaymentMethodId",
ADD COLUMN     "stripeDefaultPaymentMethodId" VARCHAR(255);

-- CreateIndex
CREATE INDEX "Invoice_stripeChargeId_idx" ON "Invoice"("stripeChargeId");

-- CreateIndex
CREATE INDEX "VendorBilling_stripeDefaultPaymentMethodId_idx" ON "VendorBilling"("stripeDefaultPaymentMethodId");
