-- CreateEnum
CREATE TYPE "InvoiceProvider" AS ENUM ('LOCAL', 'SMARTBILL');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "provider" "InvoiceProvider" NOT NULL DEFAULT 'LOCAL',
ADD COLUMN     "providerInvoiceId" TEXT,
ADD COLUMN     "providerNumber" VARCHAR(64),
ADD COLUMN     "providerPayload" JSONB,
ADD COLUMN     "providerPdfUrl" TEXT,
ADD COLUMN     "providerSeries" VARCHAR(32),
ADD COLUMN     "providerStatus" VARCHAR(64),
ADD COLUMN     "providerSyncedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Invoice_provider_providerInvoiceId_idx" ON "Invoice"("provider", "providerInvoiceId");
