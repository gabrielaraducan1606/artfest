-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "returnedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Shipment_returnedAt_idx" ON "Shipment"("returnedAt");
