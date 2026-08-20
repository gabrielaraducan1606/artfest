-- CreateEnum
CREATE TYPE "VendorCampaignScope" AS ENUM ('ALL_PRODUCTS', 'SELECTED_PRODUCTS');

-- CreateEnum
CREATE TYPE "VendorCampaignCreativeType" AS ENUM ('INSTAGRAM_POST', 'INSTAGRAM_STORY', 'FACEBOOK_POST', 'TIKTOK_CAPTION', 'WHATSAPP_MESSAGE', 'GENERIC');

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "campaignAttributedAt" TIMESTAMP(3),
ADD COLUMN     "campaignCommissionBps" INTEGER,
ADD COLUMN     "campaignDiscountPercent" INTEGER,
ADD COLUMN     "campaignId" TEXT;

-- CreateTable
CREATE TABLE "VendorCampaign" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "scope" "VendorCampaignScope" NOT NULL DEFAULT 'ALL_PRODUCTS',
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "commissionBps" INTEGER NOT NULL DEFAULT 600,
    "attributionWindowHours" INTEGER NOT NULL DEFAULT 168,
    "visits" INTEGER NOT NULL DEFAULT 0,
    "attributedOrdersCount" INTEGER NOT NULL DEFAULT 0,
    "attributedRevenueCents" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorCampaignProduct" (
    "campaignId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorCampaignProduct_pkey" PRIMARY KEY ("campaignId","productId")
);

-- CreateTable
CREATE TABLE "VendorCampaignCreative" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "type" "VendorCampaignCreativeType" NOT NULL,
    "text" TEXT,
    "imageUrl" TEXT,
    "mediaUrl" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorCampaignCreative_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorCampaign_slug_key" ON "VendorCampaign"("slug");

-- CreateIndex
CREATE INDEX "VendorCampaign_vendorId_createdAt_idx" ON "VendorCampaign"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "VendorCampaign_vendorId_isActive_idx" ON "VendorCampaign"("vendorId", "isActive");

-- CreateIndex
CREATE INDEX "VendorCampaign_isActive_startsAt_endsAt_idx" ON "VendorCampaign"("isActive", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "VendorCampaignProduct_productId_idx" ON "VendorCampaignProduct"("productId");

-- CreateIndex
CREATE INDEX "VendorCampaignCreative_campaignId_createdAt_idx" ON "VendorCampaignCreative"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "VendorCampaignCreative_campaignId_type_idx" ON "VendorCampaignCreative"("campaignId", "type");

-- CreateIndex
CREATE INDEX "Shipment_campaignId_idx" ON "Shipment"("campaignId");

-- CreateIndex
CREATE INDEX "ship_vendor_campaign_created_idx" ON "Shipment"("vendorId", "campaignId", "createdAt");

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "VendorCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorCampaign" ADD CONSTRAINT "VendorCampaign_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorCampaignProduct" ADD CONSTRAINT "VendorCampaignProduct_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "VendorCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorCampaignProduct" ADD CONSTRAINT "VendorCampaignProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorCampaignCreative" ADD CONSTRAINT "VendorCampaignCreative_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "VendorCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
