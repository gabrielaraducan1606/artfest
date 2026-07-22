/*
  Warnings:

  - A unique constraint covering the columns `[guestAccessTokenHash]` on the table `Order` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "checkoutConsents" JSONB,
ADD COLUMN     "checkoutIp" VARCHAR(64),
ADD COLUMN     "checkoutUserAgent" VARCHAR(500),
ADD COLUMN     "customerEmail" VARCHAR(320),
ADD COLUMN     "customerName" VARCHAR(160),
ADD COLUMN     "customerPhone" VARCHAR(40),
ADD COLUMN     "guestAccessExpiresAt" TIMESTAMP(3),
ADD COLUMN     "guestAccessTokenHash" VARCHAR(64),
ADD COLUMN     "isGuestOrder" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Order_guestAccessTokenHash_key" ON "Order"("guestAccessTokenHash");

-- CreateIndex
CREATE INDEX "Order_customerEmail_createdAt_idx" ON "Order"("customerEmail", "createdAt");

-- CreateIndex
CREATE INDEX "Order_customerPhone_idx" ON "Order"("customerPhone");

-- CreateIndex
CREATE INDEX "Order_isGuestOrder_createdAt_idx" ON "Order"("isGuestOrder", "createdAt");

-- CreateIndex
CREATE INDEX "Order_guestAccessExpiresAt_idx" ON "Order"("guestAccessExpiresAt");
