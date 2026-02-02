-- AlterTable
ALTER TABLE "VendorSubscription" ADD COLUMN     "trialDays" INTEGER,
ADD COLUMN     "trialEndsAt" TIMESTAMP(3),
ADD COLUMN     "trialStartsAt" TIMESTAMP(3);
