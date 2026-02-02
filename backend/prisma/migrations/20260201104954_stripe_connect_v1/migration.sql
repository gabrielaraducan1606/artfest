/*
  Warnings:

  - A unique constraint covering the columns `[stripeAccountId]` on the table `Vendor` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "stripeChargeId" VARCHAR(255),
ADD COLUMN     "stripeCheckoutSessionId" VARCHAR(255),
ADD COLUMN     "stripePaymentIntentId" VARCHAR(255);

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "stripeAccountId" TEXT,
ADD COLUMN     "stripeChargesEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripeDetailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripeOnboardedAt" TIMESTAMP(3),
ADD COLUMN     "stripePayoutsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "VendorEarningEntry" ADD COLUMN     "stripeTransferId" VARCHAR(255);

-- AlterTable
ALTER TABLE "VendorSubscription" ADD COLUMN     "stripeCustomerId" VARCHAR(255),
ADD COLUMN     "stripeSubscriptionId" VARCHAR(255);

-- CreateTable
CREATE TABLE "StripeEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StripeEvent_eventId_key" ON "StripeEvent"("eventId");

-- CreateIndex
CREATE INDEX "StripeEvent_type_receivedAt_idx" ON "StripeEvent"("type", "receivedAt");

-- CreateIndex
CREATE INDEX "StripeEvent_processedAt_idx" ON "StripeEvent"("processedAt");

-- CreateIndex
CREATE INDEX "Order_stripePaymentIntentId_idx" ON "Order"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "Order_stripeCheckoutSessionId_idx" ON "Order"("stripeCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_stripeAccountId_key" ON "Vendor"("stripeAccountId");

-- CreateIndex
CREATE INDEX "VendorEarningEntry_stripeTransferId_idx" ON "VendorEarningEntry"("stripeTransferId");

-- CreateIndex
CREATE INDEX "VendorSubscription_stripeCustomerId_idx" ON "VendorSubscription"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "VendorSubscription_stripeSubscriptionId_idx" ON "VendorSubscription"("stripeSubscriptionId");
