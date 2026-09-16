/*
  Warnings:

  - A unique constraint covering the columns `[influencerId,number]` on the table `Invoice` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[influencerId,type,periodFrom,periodTo]` on the table `Invoice` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "InvoiceDirection" ADD VALUE 'INFLUENCER_TO_PLATFORM';

-- AlterEnum
ALTER TYPE "InvoiceType" ADD VALUE 'INFLUENCER_COMMISSION';

-- AlterTable
ALTER TABLE "InfluencerEarningEntry" ADD COLUMN     "payoutId" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "influencerId" TEXT,
ALTER COLUMN "vendorId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "InfluencerPayout" (
    "id" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "currency" VARCHAR(8) NOT NULL DEFAULT 'RON',
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "invoiceId" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'UNPAID',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "paymentReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InfluencerPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InfluencerPayout_invoiceId_key" ON "InfluencerPayout"("invoiceId");

-- CreateIndex
CREATE INDEX "InfluencerPayout_influencerId_periodFrom_periodTo_idx" ON "InfluencerPayout"("influencerId", "periodFrom", "periodTo");

-- CreateIndex
CREATE INDEX "InfluencerPayout_influencerId_status_idx" ON "InfluencerPayout"("influencerId", "status");

-- CreateIndex
CREATE INDEX "InfluencerEarningEntry_influencerId_payoutId_idx" ON "InfluencerEarningEntry"("influencerId", "payoutId");

-- CreateIndex
CREATE INDEX "Invoice_influencerId_direction_status_issueDate_idx" ON "Invoice"("influencerId", "direction", "status", "issueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_influencerId_number_key" ON "Invoice"("influencerId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_influencerId_type_periodFrom_periodTo_key" ON "Invoice"("influencerId", "type", "periodFrom", "periodTo");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "InfluencerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfluencerEarningEntry" ADD CONSTRAINT "InfluencerEarningEntry_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "InfluencerPayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfluencerPayout" ADD CONSTRAINT "InfluencerPayout_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "InfluencerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfluencerPayout" ADD CONSTRAINT "InfluencerPayout_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Ensure every invoice belongs to exactly one owner:
-- either a vendor OR an influencer, never both and never neither.
ALTER TABLE "Invoice"
ADD CONSTRAINT "Invoice_owner_check"
CHECK (
  ("vendorId" IS NOT NULL AND "influencerId" IS NULL)
  OR
  ("vendorId" IS NULL AND "influencerId" IS NOT NULL)
);