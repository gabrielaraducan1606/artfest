-- AlterTable
ALTER TABLE "Collection" ADD COLUMN     "promoEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "promoEndsAt" TIMESTAMP(3),
ADD COLUMN     "promoFundingSource" TEXT NOT NULL DEFAULT 'PLATFORM_COMMISSION',
ADD COLUMN     "promoLabel" TEXT,
ADD COLUMN     "promoPercent" INTEGER,
ADD COLUMN     "promoStartsAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Collection_promoEnabled_idx" ON "Collection"("promoEnabled");

-- CreateIndex
CREATE INDEX "Collection_promoStartsAt_idx" ON "Collection"("promoStartsAt");

-- CreateIndex
CREATE INDEX "Collection_promoEndsAt_idx" ON "Collection"("promoEndsAt");
