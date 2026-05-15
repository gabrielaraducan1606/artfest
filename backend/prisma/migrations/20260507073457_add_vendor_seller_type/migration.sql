-- AlterTable
ALTER TABLE "VendorBilling" ADD COLUMN     "independentTermsConfirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "independentTermsConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "sellerType" VARCHAR(32) NOT NULL DEFAULT 'verified_business',
ADD COLUMN     "taxResponsibilityConfirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taxResponsibilityConfirmedAt" TIMESTAMP(3),
ALTER COLUMN "legalType" DROP NOT NULL,
ALTER COLUMN "companyName" DROP NOT NULL,
ALTER COLUMN "cui" DROP NOT NULL,
ALTER COLUMN "regCom" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "VendorBilling_sellerType_idx" ON "VendorBilling"("sellerType");
