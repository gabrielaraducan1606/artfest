-- AlterEnum
ALTER TYPE "ShipmentStatus" ADD VALUE 'REFUSED';

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "refusedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Shipment_deliveredAt_idx" ON "Shipment"("deliveredAt");

-- CreateIndex
CREATE INDEX "Shipment_refusedAt_idx" ON "Shipment"("refusedAt");
