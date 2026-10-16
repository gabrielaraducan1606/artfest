-- CreateEnum
CREATE TYPE "ArtfestFairCancellationCause" AS ENUM ('ARTFEST_DECISION', 'VENDOR_REQUEST', 'VENDOR_BREACH');

-- CreateEnum
CREATE TYPE "ArtfestFairRegistrationEventType" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'REAPPROVED', 'WITHDRAWN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ArtfestFairReturnReason" AS ENUM ('PARTICIPATION_CANCELLED', 'FAIR_ENDED_UNSOLD', 'RECEPTION_REJECTED');

-- CreateEnum
CREATE TYPE "ArtfestFairReturnCostPayer" AS ENUM ('VENDOR', 'ARTFEST');

-- CreateEnum
CREATE TYPE "ArtfestFairReturnMethod" AS ENUM ('PICKUP', 'COURIER_BY_ARTFEST', 'COURIER_BY_VENDOR');

-- CreateEnum
CREATE TYPE "ArtfestFairReturnStatus" AS ENUM ('PREPARING', 'SHIPPED', 'CONFIRMED', 'CONFIRMED_WITH_DIFFERENCES', 'CANCELLED');

-- AlterEnum
ALTER TYPE "ArtfestFairRegistrationStatus" ADD VALUE 'CANCELLED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ArtfestInventoryEventType" ADD VALUE 'REGISTRATION_CANCELLED';
ALTER TYPE "ArtfestInventoryEventType" ADD VALUE 'RECEIVED_FOR_RETURN_ONLY';
ALTER TYPE "ArtfestInventoryEventType" ADD VALUE 'RETURN_CANCELLED';

-- AlterTable
ALTER TABLE "ArtfestFair" ADD COLUMN     "nextVendorReturnNumber" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ArtfestFairRegistration" ADD COLUMN     "cancellationCause" "ArtfestFairCancellationCause",
ADD COLUMN     "cancellationGoodsShipped" BOOLEAN,
ADD COLUMN     "cancellationMessageForVendor" TEXT,
ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT;

-- AlterTable
ALTER TABLE "ArtfestFairStockMovement" ADD COLUMN     "returnLineId" TEXT;

-- CreateTable
CREATE TABLE "ArtfestFairRegistrationEvent" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "fairId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "type" "ArtfestFairRegistrationEventType" NOT NULL,
    "actorUserId" TEXT,
    "reason" TEXT,
    "vendorMessage" TEXT,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtfestFairRegistrationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtfestFairReturn" (
    "id" TEXT NOT NULL,
    "fairId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "reason" "ArtfestFairReturnReason" NOT NULL,
    "costPayer" "ArtfestFairReturnCostPayer" NOT NULL,
    "method" "ArtfestFairReturnMethod" NOT NULL,
    "status" "ArtfestFairReturnStatus" NOT NULL DEFAULT 'PREPARING',
    "courierName" VARCHAR(80),
    "trackingNumber" VARCHAR(80),
    "shippingCostCents" INTEGER,
    "adminNotes" TEXT,
    "createdById" TEXT,
    "shippedAt" TIMESTAMP(3),
    "shippedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "confirmedByAdmin" BOOLEAN NOT NULL DEFAULT false,
    "confirmationNote" TEXT,
    "vendorNote" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtfestFairReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtfestFairReturnLine" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "qtyFromStock" INTEGER NOT NULL DEFAULT 0,
    "qtyRejected" INTEGER NOT NULL DEFAULT 0,
    "vendorReceivedQty" INTEGER,
    "restoreOnlineQty" INTEGER,
    "onlineRestoredQty" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtfestFairReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArtfestFairRegistrationEvent_registrationId_createdAt_idx" ON "ArtfestFairRegistrationEvent"("registrationId", "createdAt");

-- CreateIndex
CREATE INDEX "ArtfestFairRegistrationEvent_fairId_type_createdAt_idx" ON "ArtfestFairRegistrationEvent"("fairId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "ArtfestFairRegistrationEvent_vendorId_createdAt_idx" ON "ArtfestFairRegistrationEvent"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "ArtfestFairRegistrationEvent_actorUserId_idx" ON "ArtfestFairRegistrationEvent"("actorUserId");

-- CreateIndex
CREATE INDEX "ArtfestFairReturn_registrationId_status_idx" ON "ArtfestFairReturn"("registrationId", "status");

-- CreateIndex
CREATE INDEX "ArtfestFairReturn_fairId_status_createdAt_idx" ON "ArtfestFairReturn"("fairId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ArtfestFairReturn_vendorId_createdAt_idx" ON "ArtfestFairReturn"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "ArtfestFairReturn_createdById_idx" ON "ArtfestFairReturn"("createdById");

-- CreateIndex
CREATE INDEX "ArtfestFairReturn_shippedById_idx" ON "ArtfestFairReturn"("shippedById");

-- CreateIndex
CREATE INDEX "ArtfestFairReturn_confirmedById_idx" ON "ArtfestFairReturn"("confirmedById");

-- CreateIndex
CREATE INDEX "ArtfestFairReturn_cancelledById_idx" ON "ArtfestFairReturn"("cancelledById");

-- CreateIndex
CREATE UNIQUE INDEX "ArtfestFairReturn_fairId_number_key" ON "ArtfestFairReturn"("fairId", "number");

-- CreateIndex
CREATE INDEX "ArtfestFairReturnLine_inventoryItemId_idx" ON "ArtfestFairReturnLine"("inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtfestFairReturnLine_returnId_inventoryItemId_key" ON "ArtfestFairReturnLine"("returnId", "inventoryItemId");

-- CreateIndex
CREATE INDEX "ArtfestFairRegistration_cancelledById_idx" ON "ArtfestFairRegistration"("cancelledById");

-- CreateIndex
CREATE INDEX "ArtfestFairStockMovement_returnLineId_idx" ON "ArtfestFairStockMovement"("returnLineId");

-- AddForeignKey
ALTER TABLE "ArtfestFairRegistration" ADD CONSTRAINT "ArtfestFairRegistration_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairRegistrationEvent" ADD CONSTRAINT "ArtfestFairRegistrationEvent_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "ArtfestFairRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairRegistrationEvent" ADD CONSTRAINT "ArtfestFairRegistrationEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairReturn" ADD CONSTRAINT "ArtfestFairReturn_fairId_fkey" FOREIGN KEY ("fairId") REFERENCES "ArtfestFair"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairReturn" ADD CONSTRAINT "ArtfestFairReturn_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "ArtfestFairRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairReturn" ADD CONSTRAINT "ArtfestFairReturn_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairReturn" ADD CONSTRAINT "ArtfestFairReturn_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairReturn" ADD CONSTRAINT "ArtfestFairReturn_shippedById_fkey" FOREIGN KEY ("shippedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairReturn" ADD CONSTRAINT "ArtfestFairReturn_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairReturn" ADD CONSTRAINT "ArtfestFairReturn_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairReturnLine" ADD CONSTRAINT "ArtfestFairReturnLine_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "ArtfestFairReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairReturnLine" ADD CONSTRAINT "ArtfestFairReturnLine_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "ArtfestFairInventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairStockMovement" ADD CONSTRAINT "ArtfestFairStockMovement_returnLineId_fkey" FOREIGN KEY ("returnLineId") REFERENCES "ArtfestFairReturnLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
