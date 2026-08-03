-- CreateEnum
CREATE TYPE "HomepageFeatureDiscountStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- AlterTable
ALTER TABLE "HomepageFeature" ADD COLUMN     "platformDiscountPercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "vendorDiscountPercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "vendorDiscountRespondedAt" TIMESTAMP(3),
ADD COLUMN     "vendorDiscountStatus" "HomepageFeatureDiscountStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "vendorEmailError" VARCHAR(1000),
ADD COLUMN     "vendorEmailedAt" TIMESTAMP(3),
ADD COLUMN     "vendorNotifiedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "HomepageFeature_vendorId_vendorDiscountStatus_endsAt_idx" ON "HomepageFeature"("vendorId", "vendorDiscountStatus", "endsAt");

-- CreateIndex
CREATE INDEX "HomepageFeature_vendorNotifiedAt_idx" ON "HomepageFeature"("vendorNotifiedAt");

-- CreateIndex
CREATE INDEX "HomepageFeature_vendorEmailedAt_idx" ON "HomepageFeature"("vendorEmailedAt");
