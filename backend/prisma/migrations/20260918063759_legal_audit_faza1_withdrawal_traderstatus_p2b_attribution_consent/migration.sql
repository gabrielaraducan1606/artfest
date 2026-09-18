-- CreateEnum
CREATE TYPE "WithdrawalRequestStatus" AS ENUM ('SUBMITTED', 'FORWARDED_TO_VENDOR', 'CLOSED');

-- CreateEnum
CREATE TYPE "TraderStatus" AS ENUM ('PROFESSIONAL', 'NON_PROFESSIONAL');

-- AlterTable
ALTER TABLE "CookieConsent" ADD COLUMN     "attribution" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "statusChangedAt" TIMESTAMP(3),
ADD COLUMN     "statusReason" TEXT;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "terminationEffectiveAt" TIMESTAMP(3),
ADD COLUMN     "terminationExceptionReason" TEXT,
ADD COLUMN     "terminationFinalizedAt" TIMESTAMP(3),
ADD COLUMN     "terminationNoticeAt" TIMESTAMP(3),
ADD COLUMN     "terminationReason" TEXT;

-- AlterTable
ALTER TABLE "VendorBilling" ADD COLUMN     "traderStatus" "TraderStatus";

-- CreateTable
CREATE TABLE "WithdrawalRequest" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT,
    "shipmentIds" TEXT[],
    "clientName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "declarationText" TEXT NOT NULL,
    "status" "WithdrawalRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" VARCHAR(500),
    "confirmationSentAt" TIMESTAMP(3),
    "notifiedVendorIds" TEXT[],
    "forwardedToVendorAt" TIMESTAMP(3),

    CONSTRAINT "WithdrawalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WithdrawalRequest_orderId_submittedAt_idx" ON "WithdrawalRequest"("orderId", "submittedAt");

-- CreateIndex
CREATE INDEX "WithdrawalRequest_userId_submittedAt_idx" ON "WithdrawalRequest"("userId", "submittedAt");

-- AddForeignKey
ALTER TABLE "WithdrawalRequest" ADD CONSTRAINT "WithdrawalRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WithdrawalRequest" ADD CONSTRAINT "WithdrawalRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
