-- DropForeignKey
ALTER TABLE "public"."InfluencerEarningEntry" DROP CONSTRAINT "InfluencerEarningEntry_influencerId_fkey";

-- DropForeignKey
ALTER TABLE "public"."InfluencerPayout" DROP CONSTRAINT "InfluencerPayout_influencerId_fkey";

-- DropForeignKey
ALTER TABLE "public"."InfluencerPayoutProfile" DROP CONSTRAINT "InfluencerPayoutProfile_influencerId_fkey";

-- DropForeignKey
ALTER TABLE "public"."InfluencerProfile" DROP CONSTRAINT "InfluencerProfile_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Invoice" DROP CONSTRAINT "Invoice_influencerId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Invoice" DROP CONSTRAINT "Invoice_vendorId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Vendor" DROP CONSTRAINT "Vendor_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."VendorBilling" DROP CONSTRAINT "VendorBilling_vendorId_fkey";

-- DropForeignKey
ALTER TABLE "public"."VendorEarningEntry" DROP CONSTRAINT "VendorEarningEntry_vendorId_fkey";

-- DropForeignKey
ALTER TABLE "public"."VendorPayout" DROP CONSTRAINT "VendorPayout_vendorId_fkey";

-- AlterTable
ALTER TABLE "InfluencerProfile" ADD COLUMN     "anonymizedAt" TIMESTAMP(3),
ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "anonymizedAt" TIMESTAMP(3),
ALTER COLUMN "userId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBilling" ADD CONSTRAINT "VendorBilling_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "InfluencerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorEarningEntry" ADD CONSTRAINT "VendorEarningEntry_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPayout" ADD CONSTRAINT "VendorPayout_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfluencerProfile" ADD CONSTRAINT "InfluencerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfluencerPayoutProfile" ADD CONSTRAINT "InfluencerPayoutProfile_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "InfluencerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfluencerEarningEntry" ADD CONSTRAINT "InfluencerEarningEntry_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "InfluencerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfluencerPayout" ADD CONSTRAINT "InfluencerPayout_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "InfluencerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
