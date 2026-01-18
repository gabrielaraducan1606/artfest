/*
  Warnings:

  - You are about to drop the `VendorEntityDeclaration` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."VendorEntityDeclaration" DROP CONSTRAINT "VendorEntityDeclaration_vendorId_fkey";

-- DropTable
DROP TABLE "public"."VendorEntityDeclaration";

-- CreateTable
CREATE TABLE "VendorStats" (
    "vendorId" TEXT NOT NULL,
    "followers" INTEGER NOT NULL DEFAULT 0,
    "productReviewsTotal" INTEGER NOT NULL DEFAULT 0,
    "storeReviewsTotal" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorStats_pkey" PRIMARY KEY ("vendorId")
);

-- CreateIndex
CREATE INDEX "VendorStats_updatedAt_idx" ON "VendorStats"("updatedAt");

-- CreateIndex
CREATE INDEX "review_status_product_idx" ON "Review"("status", "productId");

-- CreateIndex
CREATE INDEX "store_review_vendor_status_idx" ON "StoreReview"("vendorId", "status");

-- CreateIndex
CREATE INDEX "vendor_service_vendor_created_idx" ON "VendorService"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "vendor_sub_vendor_status_created_idx" ON "VendorSubscription"("vendorId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "VendorStats" ADD CONSTRAINT "VendorStats_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
