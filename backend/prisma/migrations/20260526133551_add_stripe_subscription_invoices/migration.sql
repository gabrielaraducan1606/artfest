/*
  Warnings:

  - A unique constraint covering the columns `[provider,providerInvoiceId]` on the table `Invoice` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "InvoiceLineType" ADD VALUE 'SUBSCRIPTION';

-- AlterEnum
ALTER TYPE "InvoiceProvider" ADD VALUE 'STRIPE';

-- DropIndex
DROP INDEX "public"."Invoice_provider_providerInvoiceId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_provider_providerInvoiceId_key" ON "Invoice"("provider", "providerInvoiceId");
