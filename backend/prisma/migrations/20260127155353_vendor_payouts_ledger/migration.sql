-- CreateEnum
CREATE TYPE "VendorEarningType" AS ENUM ('SALE', 'REFUND', 'ADJUSTMENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InvoiceDirection" ADD VALUE 'PLATFORM_TO_VENDOR';
ALTER TYPE "InvoiceDirection" ADD VALUE 'VENDOR_TO_CLIENT';

-- CreateTable
CREATE TABLE "VendorEarningEntry" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "shipmentId" TEXT,
    "orderId" TEXT,
    "type" "VendorEarningType" NOT NULL DEFAULT 'SALE',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currency" VARCHAR(8) NOT NULL DEFAULT 'RON',
    "itemsNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "commissionNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vendorNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "payoutId" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorEarningEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorPayout" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "currency" VARCHAR(8) NOT NULL DEFAULT 'RON',
    "totalItemsNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalCommissionNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalVendorNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "invoiceId" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'UNPAID',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorEarningEntry_shipmentId_key" ON "VendorEarningEntry"("shipmentId");

-- CreateIndex
CREATE INDEX "VendorEarningEntry_vendorId_occurredAt_idx" ON "VendorEarningEntry"("vendorId", "occurredAt");

-- CreateIndex
CREATE INDEX "VendorEarningEntry_vendorId_payoutId_idx" ON "VendorEarningEntry"("vendorId", "payoutId");

-- CreateIndex
CREATE INDEX "VendorEarningEntry_orderId_idx" ON "VendorEarningEntry"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorPayout_invoiceId_key" ON "VendorPayout"("invoiceId");

-- CreateIndex
CREATE INDEX "VendorPayout_vendorId_periodFrom_periodTo_idx" ON "VendorPayout"("vendorId", "periodFrom", "periodTo");

-- AddForeignKey
ALTER TABLE "VendorEarningEntry" ADD CONSTRAINT "VendorEarningEntry_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorEarningEntry" ADD CONSTRAINT "VendorEarningEntry_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorEarningEntry" ADD CONSTRAINT "VendorEarningEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorEarningEntry" ADD CONSTRAINT "VendorEarningEntry_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "VendorPayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPayout" ADD CONSTRAINT "VendorPayout_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPayout" ADD CONSTRAINT "VendorPayout_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
