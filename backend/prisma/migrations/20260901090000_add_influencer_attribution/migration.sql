-- CreateEnum
CREATE TYPE "InfluencerEarningType" AS ENUM ('SALE', 'REFUND');

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "influencerAttributedAt" TIMESTAMP(3),
ADD COLUMN     "influencerCommissionBpsSnapshot" INTEGER,
ADD COLUMN     "influencerId" TEXT,
ADD COLUMN     "influencerReferralCodeSnapshot" TEXT;

-- CreateTable
CREATE TABLE "InfluencerEarningEntry" (
    "id" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "shipmentId" TEXT,
    "orderId" TEXT,
    "type" "InfluencerEarningType" NOT NULL DEFAULT 'SALE',
    "commissionBpsSnapshot" INTEGER NOT NULL,
    "currency" VARCHAR(8) NOT NULL DEFAULT 'RON',
    "eligibleItemsNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "artfestCommissionNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "earningNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta" JSONB,

    CONSTRAINT "InfluencerEarningEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InfluencerEarningEntry_shipmentId_key" ON "InfluencerEarningEntry"("shipmentId");

-- CreateIndex
CREATE INDEX "InfluencerEarningEntry_influencerId_occurredAt_idx" ON "InfluencerEarningEntry"("influencerId", "occurredAt");

-- CreateIndex
CREATE INDEX "InfluencerEarningEntry_orderId_idx" ON "InfluencerEarningEntry"("orderId");

-- CreateIndex
CREATE INDEX "Shipment_influencerId_idx" ON "Shipment"("influencerId");

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "InfluencerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfluencerEarningEntry" ADD CONSTRAINT "InfluencerEarningEntry_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "InfluencerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfluencerEarningEntry" ADD CONSTRAINT "InfluencerEarningEntry_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfluencerEarningEntry" ADD CONSTRAINT "InfluencerEarningEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
