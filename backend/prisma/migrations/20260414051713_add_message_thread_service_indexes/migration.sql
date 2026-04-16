-- CreateIndex
CREATE INDEX "thread_user_service_deleted_idx" ON "MessageThread"("userId", "serviceId", "deletedByUserAt");

-- CreateIndex
CREATE INDEX "thread_vendor_service_deleted_idx" ON "MessageThread"("vendorId", "serviceId", "deletedByVendorAt");
