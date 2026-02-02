/*
  Warnings:

  - The values [PLATFORM_TO_VENDOR,VENDOR_TO_CLIENT] on the enum `InvoiceDirection` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the `PlatformBilling` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[direction,number]` on the table `Invoice` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "InvoiceLineType" AS ENUM ('PRODUCT', 'SHIPPING', 'COMMISSION', 'OTHER');

-- AlterEnum
BEGIN;
CREATE TYPE "InvoiceDirection_new" AS ENUM ('VENDOR_TO_PLATFORM', 'PLATFORM_TO_CLIENT');
ALTER TABLE "Invoice" ALTER COLUMN "direction" TYPE "InvoiceDirection_new" USING ("direction"::text::"InvoiceDirection_new");
ALTER TYPE "InvoiceDirection" RENAME TO "InvoiceDirection_old";
ALTER TYPE "InvoiceDirection_new" RENAME TO "InvoiceDirection";
DROP TYPE "public"."InvoiceDirection_old";
COMMIT;

-- DropIndex
DROP INDEX "public"."Invoice_vendorId_direction_status_issueDate_idx";

-- DropIndex
DROP INDEX "public"."Invoice_vendorId_number_key";

-- AlterTable
ALTER TABLE "Invoice" ALTER COLUMN "vendorId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "type" "InvoiceLineType" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "vendorId" TEXT;

-- DropTable
DROP TABLE "public"."PlatformBilling";

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "paymentMethod" "PaymentMethod" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "subtotal" DECIMAL(10,2) NOT NULL,
    "shippingTotal" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "shippingAddress" JSONB NOT NULL,
    "customerType" "CustomerType" NOT NULL DEFAULT 'PF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "vendorNotes" TEXT,
    "adminNotes" TEXT,
    "invoiceNumber" VARCHAR(64),
    "invoiceDate" TIMESTAMP(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Order_userId_createdAt_idx" ON "Order"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Invoice_vendorId_idx" ON "Invoice"("vendorId");

-- CreateIndex
CREATE INDEX "Invoice_direction_status_issueDate_idx" ON "Invoice"("direction", "status", "issueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_direction_number_key" ON "Invoice"("direction", "number");

-- CreateIndex
CREATE INDEX "InvoiceLine_vendorId_idx" ON "InvoiceLine"("vendorId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
