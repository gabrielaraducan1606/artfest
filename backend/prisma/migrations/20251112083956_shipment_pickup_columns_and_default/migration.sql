-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "consents" JSONB,
ADD COLUMN     "courierProvider" TEXT,
ADD COLUMN     "courierService" TEXT,
ADD COLUMN     "heightCm" INTEGER,
ADD COLUMN     "lengthCm" INTEGER,
ADD COLUMN     "parcels" INTEGER,
ADD COLUMN     "pickupDate" TIMESTAMP(3),
ADD COLUMN     "pickupScheduledAt" TIMESTAMP(3),
ADD COLUMN     "pickupSlotEnd" TIMESTAMP(3),
ADD COLUMN     "pickupSlotStart" TIMESTAMP(3),
ADD COLUMN     "trackingUrl" TEXT,
ADD COLUMN     "weightKg" DECIMAL(7,2),
ADD COLUMN     "widthCm" INTEGER,
ALTER COLUMN "status" SET DEFAULT 'PREPARING';

-- CreateIndex
CREATE INDEX "Shipment_status_pickupDate_idx" ON "Shipment"("status", "pickupDate");
