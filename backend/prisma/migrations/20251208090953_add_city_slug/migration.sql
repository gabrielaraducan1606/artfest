-- AlterTable
ALTER TABLE "ServiceProfile" ADD COLUMN     "citySlug" VARCHAR(64);

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "citySlug" VARCHAR(64);

-- CreateIndex
CREATE INDEX "service_profile_citySlug_idx" ON "ServiceProfile"("citySlug");

-- CreateIndex
CREATE INDEX "vendor_citySlug_idx" ON "Vendor"("citySlug");
