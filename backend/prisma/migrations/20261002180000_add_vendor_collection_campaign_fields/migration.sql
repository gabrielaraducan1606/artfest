-- Consolidare VendorCampaign -> VendorCollection („Colecții” unice) - FAZA 1.
-- Strict aditiv: coloane noi cu default / nullable + index unic pe legacyCampaignId.
-- Fără DROP, fără ALTER destructiv, fără FK, fără backfill (datele se migrează
-- separat, cu scripts/migrateVendorCampaignsToCollections.js). VendorCollection
-- existente primesc: discountPercent=0, allOwnProducts=false, restul NULL.

-- AlterTable
ALTER TABLE "VendorCollection" ADD COLUMN "discountPercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "startsAt" TIMESTAMP(3),
ADD COLUMN "endsAt" TIMESTAMP(3),
ADD COLUMN "allOwnProducts" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "legacyCampaignId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "VendorCollection_legacyCampaignId_key" ON "VendorCollection"("legacyCampaignId");
