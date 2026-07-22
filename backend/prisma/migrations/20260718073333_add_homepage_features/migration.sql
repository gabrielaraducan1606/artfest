-- CreateEnum
CREATE TYPE "HomepageFeatureType" AS ENUM ('PRODUCT_OF_DAY', 'ARTISAN_OF_WEEK');

-- CreateEnum
CREATE TYPE "HomepageFeatureSource" AS ENUM ('AUTOMATIC', 'MANUAL', 'SPONSORED');

-- CreateTable
CREATE TABLE "HomepageFeature" (
    "id" TEXT NOT NULL,
    "type" "HomepageFeatureType" NOT NULL,
    "dateKey" VARCHAR(20) NOT NULL,
    "source" "HomepageFeatureSource" NOT NULL DEFAULT 'AUTOMATIC',
    "productId" TEXT,
    "serviceId" TEXT,
    "vendorId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomepageFeature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HomepageFeature_type_startsAt_endsAt_idx" ON "HomepageFeature"("type", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "HomepageFeature_productId_idx" ON "HomepageFeature"("productId");

-- CreateIndex
CREATE INDEX "HomepageFeature_serviceId_idx" ON "HomepageFeature"("serviceId");

-- CreateIndex
CREATE INDEX "HomepageFeature_vendorId_idx" ON "HomepageFeature"("vendorId");

-- CreateIndex
CREATE INDEX "HomepageFeature_source_startsAt_endsAt_idx" ON "HomepageFeature"("source", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "HomepageFeature_type_dateKey_key" ON "HomepageFeature"("type", "dateKey");

-- AddForeignKey
ALTER TABLE "HomepageFeature" ADD CONSTRAINT "HomepageFeature_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomepageFeature" ADD CONSTRAINT "HomepageFeature_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "VendorService"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomepageFeature" ADD CONSTRAINT "HomepageFeature_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
