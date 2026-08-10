-- CreateEnum
CREATE TYPE "PaymentDepositStatus" AS ENUM ('NOT_REQUESTED', 'PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED');

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "depositExpiresAt" TIMESTAMP(3),
ADD COLUMN     "depositPaidAmount" DECIMAL(10,2),
ADD COLUMN     "depositPaidAt" TIMESTAMP(3),
ADD COLUMN     "depositPaymentError" TEXT,
ADD COLUMN     "depositPercent" INTEGER,
ADD COLUMN     "depositRequestedAmount" DECIMAL(10,2),
ADD COLUMN     "depositRequestedAt" TIMESTAMP(3),
ADD COLUMN     "depositStatus" "PaymentDepositStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
ADD COLUMN     "remainingCodAmount" DECIMAL(10,2),
ADD COLUMN     "stripeDepositChargeId" VARCHAR(255),
ADD COLUMN     "stripeDepositPaymentIntentId" VARCHAR(255),
ADD COLUMN     "stripeDepositSessionId" VARCHAR(255);

-- CreateIndex
CREATE INDEX "Shipment_depositStatus_idx" ON "Shipment"("depositStatus");

-- CreateIndex
CREATE INDEX "Shipment_depositExpiresAt_idx" ON "Shipment"("depositExpiresAt");

-- CreateIndex
CREATE INDEX "Shipment_stripeDepositSessionId_idx" ON "Shipment"("stripeDepositSessionId");

-- CreateIndex
CREATE INDEX "Shipment_stripeDepositPaymentIntentId_idx" ON "Shipment"("stripeDepositPaymentIntentId");

-- CreateIndex
CREATE INDEX "Shipment_stripeDepositChargeId_idx" ON "Shipment"("stripeDepositChargeId");

-- CreateIndex
CREATE INDEX "ship_vendor_deposit_status_created_idx" ON "Shipment"("vendorId", "depositStatus", "createdAt");
