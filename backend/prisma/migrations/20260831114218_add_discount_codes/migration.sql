-- CreateEnum
CREATE TYPE "DiscountCodeOwnerType" AS ENUM ('PLATFORM', 'VENDOR', 'INFLUENCER');

-- CreateEnum
CREATE TYPE "DiscountCodeScope" AS ENUM ('ALL_PRODUCTS', 'VENDOR_ALL_PRODUCTS', 'SELECTED_PRODUCTS', 'INFLUENCER_COLLECTION');

-- CreateEnum
CREATE TYPE "DiscountCodeType" AS ENUM ('PERCENT', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "DiscountCodeFundingSource" AS ENUM ('PLATFORM', 'VENDOR', 'SHARED');

-- CreateEnum
CREATE TYPE "DiscountCodeStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- AlterTable
ALTER TABLE "ShipmentItem" ADD COLUMN     "discountCodeAmount" DECIMAL(10,2),
ADD COLUMN     "discountCodeFundingSource" TEXT,
ADD COLUMN     "discountCodeId" TEXT,
ADD COLUMN     "discountCodePercent" INTEGER,
ADD COLUMN     "discountCodeText" VARCHAR(64);

-- CreateTable
CREATE TABLE "DiscountCode" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(160),
    "description" TEXT,
    "ownerType" "DiscountCodeOwnerType" NOT NULL,
    "vendorId" TEXT,
    "influencerId" TEXT,
    "scope" "DiscountCodeScope" NOT NULL,
    "influencerCollectionId" TEXT,
    "discountType" "DiscountCodeType" NOT NULL DEFAULT 'PERCENT',
    "discountPercent" INTEGER,
    "discountAmountCents" INTEGER,
    "currency" VARCHAR(8) NOT NULL DEFAULT 'RON',
    "minimumOrderCents" INTEGER,
    "maxDiscountCents" INTEGER,
    "fundingSource" "DiscountCodeFundingSource" NOT NULL,
    "platformFundingBps" INTEGER NOT NULL DEFAULT 0,
    "vendorFundingBps" INTEGER NOT NULL DEFAULT 0,
    "status" "DiscountCodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "usageLimit" INTEGER,
    "usageLimitPerUser" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscountCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountCodeProduct" (
    "discountCodeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscountCodeProduct_pkey" PRIMARY KEY ("discountCodeId","productId")
);

-- CreateTable
CREATE TABLE "DiscountCodeRedemption" (
    "id" TEXT NOT NULL,
    "discountCodeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT,
    "customerEmail" VARCHAR(320),
    "discountAmountCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscountCodeRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscountCode_code_key" ON "DiscountCode"("code");

-- CreateIndex
CREATE INDEX "DiscountCode_code_isActive_idx" ON "DiscountCode"("code", "isActive");

-- CreateIndex
CREATE INDEX "DiscountCode_ownerType_isActive_idx" ON "DiscountCode"("ownerType", "isActive");

-- CreateIndex
CREATE INDEX "DiscountCode_vendorId_isActive_idx" ON "DiscountCode"("vendorId", "isActive");

-- CreateIndex
CREATE INDEX "DiscountCode_influencerId_isActive_idx" ON "DiscountCode"("influencerId", "isActive");

-- CreateIndex
CREATE INDEX "DiscountCode_influencerCollectionId_idx" ON "DiscountCode"("influencerCollectionId");

-- CreateIndex
CREATE INDEX "DiscountCode_startsAt_endsAt_idx" ON "DiscountCode"("startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "DiscountCode_createdByUserId_idx" ON "DiscountCode"("createdByUserId");

-- CreateIndex
CREATE INDEX "DiscountCodeProduct_productId_idx" ON "DiscountCodeProduct"("productId");

-- CreateIndex
CREATE INDEX "DiscountCodeRedemption_discountCodeId_createdAt_idx" ON "DiscountCodeRedemption"("discountCodeId", "createdAt");

-- CreateIndex
CREATE INDEX "DiscountCodeRedemption_userId_createdAt_idx" ON "DiscountCodeRedemption"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "DiscountCodeRedemption_customerEmail_createdAt_idx" ON "DiscountCodeRedemption"("customerEmail", "createdAt");

-- CreateIndex
CREATE INDEX "DiscountCodeRedemption_orderId_idx" ON "DiscountCodeRedemption"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountCodeRedemption_discountCodeId_orderId_key" ON "DiscountCodeRedemption"("discountCodeId", "orderId");

-- CreateIndex
CREATE INDEX "ShipmentItem_discountCodeId_idx" ON "ShipmentItem"("discountCodeId");

-- AddForeignKey
ALTER TABLE "DiscountCode" ADD CONSTRAINT "DiscountCode_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountCode" ADD CONSTRAINT "DiscountCode_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "InfluencerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountCode" ADD CONSTRAINT "DiscountCode_influencerCollectionId_fkey" FOREIGN KEY ("influencerCollectionId") REFERENCES "InfluencerCollection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountCode" ADD CONSTRAINT "DiscountCode_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountCodeProduct" ADD CONSTRAINT "DiscountCodeProduct_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "DiscountCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountCodeProduct" ADD CONSTRAINT "DiscountCodeProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountCodeRedemption" ADD CONSTRAINT "DiscountCodeRedemption_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "DiscountCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountCodeRedemption" ADD CONSTRAINT "DiscountCodeRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountCodeRedemption" ADD CONSTRAINT "DiscountCodeRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
