-- AlterTable
ALTER TABLE "ShipmentItem" ADD COLUMN     "discountSource" TEXT,
ADD COLUMN     "homepageFeatureId" TEXT,
ADD COLUMN     "platformDiscountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "platformDiscountPercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "vendorDiscountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "vendorDiscountPercent" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "ShipmentItem_homepageFeatureId_idx" ON "ShipmentItem"("homepageFeatureId");

-- CreateIndex
CREATE INDEX "ShipmentItem_discountSource_idx" ON "ShipmentItem"("discountSource");
