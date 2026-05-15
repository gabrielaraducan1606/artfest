-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "stripeAutoCharge" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripeCheckoutSessionId" VARCHAR(255),
ADD COLUMN     "stripeLastPaymentError" TEXT,
ADD COLUMN     "stripePaymentIntentId" VARCHAR(255),
ADD COLUMN     "stripePaymentStatus" VARCHAR(64);

-- AlterTable
ALTER TABLE "VendorBilling" ADD COLUMN     "autoBillingDisabledAt" TIMESTAMP(3),
ADD COLUMN     "autoBillingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoBillingEnabledAt" TIMESTAMP(3),
ADD COLUMN     "stripeCustomerId" VARCHAR(255),
ADD COLUMN     "stripePaymentMethodId" VARCHAR(255);

-- CreateIndex
CREATE INDEX "Invoice_stripeCheckoutSessionId_idx" ON "Invoice"("stripeCheckoutSessionId");

-- CreateIndex
CREATE INDEX "Invoice_stripePaymentIntentId_idx" ON "Invoice"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "Invoice_stripePaymentStatus_idx" ON "Invoice"("stripePaymentStatus");

-- CreateIndex
CREATE INDEX "VendorBilling_stripeCustomerId_idx" ON "VendorBilling"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "VendorBilling_stripePaymentMethodId_idx" ON "VendorBilling"("stripePaymentMethodId");

-- CreateIndex
CREATE INDEX "VendorBilling_autoBillingEnabled_idx" ON "VendorBilling"("autoBillingEnabled");
