-- DropIndex
DROP INDEX "public"."Invoice_provider_providerInvoiceId_key";

-- CreateIndex
CREATE INDEX "Invoice_provider_providerInvoiceId_idx" ON "Invoice"("provider", "providerInvoiceId");
