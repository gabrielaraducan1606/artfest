-- AlterTable
ALTER TABLE "VendorService" ADD COLUMN     "estimatedShippingFeeCents" INTEGER,
ADD COLUMN     "freeShippingThresholdCents" INTEGER,
ADD COLUMN     "shippingNotes" TEXT;
