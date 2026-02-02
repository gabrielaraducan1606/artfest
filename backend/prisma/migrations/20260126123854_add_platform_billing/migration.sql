/*
  Warnings:

  - You are about to drop the `Order` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."Invoice" DROP CONSTRAINT "Invoice_orderId_fkey";

-- DropForeignKey
ALTER TABLE "public"."MessageThread" DROP CONSTRAINT "MessageThread_orderId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Order" DROP CONSTRAINT "Order_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Shipment" DROP CONSTRAINT "Shipment_orderId_fkey";

-- DropTable
DROP TABLE "public"."Order";

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
