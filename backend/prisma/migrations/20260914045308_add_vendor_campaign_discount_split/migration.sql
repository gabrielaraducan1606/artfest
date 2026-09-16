-- AlterTable
ALTER TABLE "VendorCampaign" ADD COLUMN     "fundingSource" "DiscountCodeFundingSource",
ADD COLUMN     "platformFundingBps" INTEGER,
ADD COLUMN     "vendorFundingBps" INTEGER;
