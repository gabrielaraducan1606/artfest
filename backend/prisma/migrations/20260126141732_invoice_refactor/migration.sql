/*
  Warnings:

  - A unique constraint covering the columns `[vendorId,number]` on the table `Invoice` will be added. If there are existing duplicate values, this will fail.
  - Made the column `vendorId` on table `Invoice` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "public"."Invoice_direction_number_key";

-- DropIndex
DROP INDEX "public"."Invoice_direction_status_issueDate_idx";

-- DropIndex
DROP INDEX "public"."Invoice_vendorId_idx";

-- AlterTable
ALTER TABLE "Invoice" ALTER COLUMN "vendorId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "handedOverAt" TIMESTAMP(3),
ADD COLUMN     "handedOverById" TEXT;

-- CreateTable
CREATE TABLE "PlatformBilling" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "legalType" TEXT,
    "cui" TEXT NOT NULL,
    "regCom" TEXT,
    "address" TEXT NOT NULL,
    "iban" TEXT,
    "bank" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "vatPayer" BOOLEAN NOT NULL DEFAULT true,
    "invoiceSeries" VARCHAR(16),
    "lastInvoiceSeq" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformBilling_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Invoice_vendorId_direction_status_issueDate_idx" ON "Invoice"("vendorId", "direction", "status", "issueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_vendorId_number_key" ON "Invoice"("vendorId", "number");

-- CreateIndex
CREATE INDEX "Shipment_handedOverAt_idx" ON "Shipment"("handedOverAt");

-- CreateIndex
CREATE INDEX "Shipment_handedOverById_idx" ON "Shipment"("handedOverById");

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_handedOverById_fkey" FOREIGN KEY ("handedOverById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
