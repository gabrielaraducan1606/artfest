-- AlterTable
ALTER TABLE "MessageThread" ADD COLUMN     "serviceId" TEXT;

-- CreateIndex
CREATE INDEX "MessageThread_serviceId_idx" ON "MessageThread"("serviceId");

-- CreateIndex
CREATE INDEX "MessageThread_vendorId_serviceId_lastAt_idx" ON "MessageThread"("vendorId", "serviceId", "lastAt");

-- CreateIndex
CREATE INDEX "MessageThread_userId_serviceId_lastAt_idx" ON "MessageThread"("userId", "serviceId", "lastAt");

-- AddForeignKey
ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "VendorService"("id") ON DELETE SET NULL ON UPDATE CASCADE;
