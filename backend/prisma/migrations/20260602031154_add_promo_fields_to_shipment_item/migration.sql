-- AlterTable
ALTER TABLE "ShipmentItem" ADD COLUMN     "discountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "originalPrice" DECIMAL(10,2),
ADD COLUMN     "promoCollectionId" TEXT,
ADD COLUMN     "promoFundingSource" TEXT;

-- CreateIndex
CREATE INDEX "ShipmentItem_promoCollectionId_idx" ON "ShipmentItem"("promoCollectionId");
