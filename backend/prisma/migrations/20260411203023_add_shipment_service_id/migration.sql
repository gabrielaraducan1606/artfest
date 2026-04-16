-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "serviceId" TEXT;

-- CreateIndex
CREATE INDEX "Shipment_serviceId_idx" ON "Shipment"("serviceId");

-- CreateIndex
CREATE INDEX "ship_vendor_service_created_idx" ON "Shipment"("vendorId", "serviceId", "createdAt");

-- CreateIndex
CREATE INDEX "ship_vendor_service_status_created_idx" ON "Shipment"("vendorId", "serviceId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "VendorService"("id") ON DELETE SET NULL ON UPDATE CASCADE;
