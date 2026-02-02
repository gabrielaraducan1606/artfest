/*
  Warnings:

  - Made the column `lastAt` on table `MessageThread` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "public"."MessageThread_vendorId_leadStatus_idx";

-- DropIndex
DROP INDEX "public"."vendor_service_filters_idx";

-- AlterTable
ALTER TABLE "MessageThread" ALTER COLUMN "lastAt" SET NOT NULL,
ALTER COLUMN "lastAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "VendorService" ADD COLUMN     "citySlug" VARCHAR(64);

-- CreateIndex
CREATE INDEX "notif_user_arch_read_created_idx" ON "Notification"("userId", "archived", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "notif_vendor_arch_read_created_idx" ON "Notification"("vendorId", "archived", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "product_service_active_hidden_pop_idx" ON "Product"("serviceId", "isActive", "isHidden", "popularityScore");

-- CreateIndex
CREATE INDEX "ship_vendor_status_created_idx" ON "Shipment"("vendorId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ship_vendor_created_idx" ON "Shipment"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "vendor_service_filters_idx" ON "VendorService"("typeId", "isActive", "status", "citySlug");

-- CreateIndex
CREATE INDEX "vs_city_active_status_type_created_idx" ON "VendorService"("citySlug", "isActive", "status", "typeId", "createdAt");

-- RenameIndex
ALTER INDEX "MessageThread_vendorId_archived_lastAt_idx" RENAME TO "thread_vendor_arch_lastAt_idx";
