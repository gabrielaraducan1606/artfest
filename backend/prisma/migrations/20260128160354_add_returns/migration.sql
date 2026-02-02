-- CreateEnum
CREATE TYPE "ShipmentDirection" AS ENUM ('OUTBOUND', 'RETURN');

-- CreateEnum
CREATE TYPE "ReturnRequestStatus" AS ENUM ('NEW', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'PICKUP_REQUESTED', 'CLOSED');

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "direction" "ShipmentDirection" NOT NULL DEFAULT 'OUTBOUND',
ADD COLUMN     "returnRequestId" TEXT;

-- CreateTable
CREATE TABLE "ReturnRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "orderId" TEXT NOT NULL,
    "originalShipmentId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "status" "ReturnRequestStatus" NOT NULL DEFAULT 'NEW',
    "reasonCode" TEXT NOT NULL,
    "reasonText" TEXT,
    "faultParty" TEXT,
    "resolutionWanted" TEXT,
    "notesUser" TEXT,
    "photos" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnRequestItem" (
    "id" TEXT NOT NULL,
    "returnRequestId" TEXT NOT NULL,
    "shipmentItemId" TEXT,
    "productId" TEXT,
    "title" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "ReturnRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReturnRequest_orderId_createdAt_idx" ON "ReturnRequest"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "ReturnRequest_vendorId_createdAt_idx" ON "ReturnRequest"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "ReturnRequest_status_createdAt_idx" ON "ReturnRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ReturnRequest_originalShipmentId_idx" ON "ReturnRequest"("originalShipmentId");

-- CreateIndex
CREATE INDEX "ReturnRequestItem_returnRequestId_idx" ON "ReturnRequestItem"("returnRequestId");

-- CreateIndex
CREATE INDEX "ReturnRequestItem_productId_idx" ON "ReturnRequestItem"("productId");

-- CreateIndex
CREATE INDEX "Shipment_direction_idx" ON "Shipment"("direction");

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_originalShipmentId_fkey" FOREIGN KEY ("originalShipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequestItem" ADD CONSTRAINT "ReturnRequestItem_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
