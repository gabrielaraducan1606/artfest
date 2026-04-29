-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "serviceId" TEXT;

-- AlterTable
ALTER TABLE "Search" ADD COLUMN     "serviceId" TEXT;

-- CreateIndex
CREATE INDEX "Event_serviceId_createdAt_idx" ON "Event"("serviceId", "createdAt");

-- CreateIndex
CREATE INDEX "Event_vendorId_serviceId_createdAt_idx" ON "Event"("vendorId", "serviceId", "createdAt");

-- CreateIndex
CREATE INDEX "Search_serviceId_createdAt_idx" ON "Search"("serviceId", "createdAt");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "VendorService"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Search" ADD CONSTRAINT "Search_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "VendorService"("id") ON DELETE SET NULL ON UPDATE CASCADE;
