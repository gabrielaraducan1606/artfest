-- CreateEnum
CREATE TYPE "VendorCostItemType" AS ENUM ('MATERIAL', 'PACKAGING', 'OTHER');

-- CreateEnum
CREATE TYPE "VendorCostItemSource" AS ENUM ('MANUAL', 'AI_SUGGESTED');

-- CreateEnum
CREATE TYPE "ProductCostingStatus" AS ENUM ('DRAFT', 'CONFIRMED');

-- CreateTable
CREATE TABLE "VendorCostItem" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "type" "VendorCostItemType" NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "unitCostCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" "VendorCostItemSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorCostItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCosting" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "laborHours" DOUBLE PRECISION,
    "hourlyRateCents" INTEGER,
    "desiredProfitPercent" DOUBLE PRECISION,
    "desiredProfitCents" INTEGER,
    "materialsCostCents" INTEGER NOT NULL DEFAULT 0,
    "laborCostCents" INTEGER NOT NULL DEFAULT 0,
    "packagingCostCents" INTEGER NOT NULL DEFAULT 0,
    "otherCostsCents" INTEGER NOT NULL DEFAULT 0,
    "totalRealCostCents" INTEGER NOT NULL DEFAULT 0,
    "minPriceCents" INTEGER NOT NULL DEFAULT 0,
    "recommendedPriceCents" INTEGER NOT NULL DEFAULT 0,
    "estimatedProfitCents" INTEGER NOT NULL DEFAULT 0,
    "vendorNetCents" INTEGER NOT NULL DEFAULT 0,
    "commissionBpsUsed" INTEGER NOT NULL DEFAULT 0,
    "status" "ProductCostingStatus" NOT NULL DEFAULT 'DRAFT',
    "needsRecalculation" BOOLEAN NOT NULL DEFAULT false,
    "aiDraft" JSONB,
    "aiSourceImages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "aiAnalyzedAt" TIMESTAMP(3),
    "aiConfidence" DOUBLE PRECISION,
    "lastCalculatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCosting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCostingItem" (
    "id" TEXT NOT NULL,
    "costingId" TEXT NOT NULL,
    "kind" "VendorCostItemType" NOT NULL,
    "label" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "unitCostCentsSnapshot" INTEGER NOT NULL,
    "costItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCostingItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VendorCostItem_vendorId_type_isActive_idx" ON "VendorCostItem"("vendorId", "type", "isActive");

-- CreateIndex
CREATE INDEX "VendorCostItem_vendorId_name_idx" ON "VendorCostItem"("vendorId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCosting_productId_key" ON "ProductCosting"("productId");

-- CreateIndex
CREATE INDEX "ProductCosting_needsRecalculation_idx" ON "ProductCosting"("needsRecalculation");

-- CreateIndex
CREATE INDEX "ProductCostingItem_costingId_idx" ON "ProductCostingItem"("costingId");

-- CreateIndex
CREATE INDEX "ProductCostingItem_costItemId_idx" ON "ProductCostingItem"("costItemId");

-- AddForeignKey
ALTER TABLE "VendorCostItem" ADD CONSTRAINT "VendorCostItem_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCosting" ADD CONSTRAINT "ProductCosting_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCostingItem" ADD CONSTRAINT "ProductCostingItem_costItemId_fkey" FOREIGN KEY ("costItemId") REFERENCES "VendorCostItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCostingItem" ADD CONSTRAINT "ProductCostingItem_costingId_fkey" FOREIGN KEY ("costingId") REFERENCES "ProductCosting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
