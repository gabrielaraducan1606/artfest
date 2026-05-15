/*
  Warnings:

  - A unique constraint covering the columns `[stripeSubscriptionId]` on the table `VendorSubscription` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[stripeCheckoutSessionId]` on the table `VendorSubscription` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "public"."VendorSubscription_stripeSubscriptionId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "VendorSubscription_stripeSubscriptionId_key" ON "VendorSubscription"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorSubscription_stripeCheckoutSessionId_key" ON "VendorSubscription"("stripeCheckoutSessionId");

-- CreateIndex
CREATE INDEX "VendorSubscription_vendorId_stripeCustomerId_idx" ON "VendorSubscription"("vendorId", "stripeCustomerId");
