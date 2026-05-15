/*
  Warnings:

  - A unique constraint covering the columns `[vendorId,type,periodFrom,periodTo]` on the table `Invoice` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paymentUrl" TEXT;

-- CreateIndex
CREATE INDEX "Invoice_dueDate_status_idx" ON "Invoice"("dueDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_vendorId_type_periodFrom_periodTo_key" ON "Invoice"("vendorId", "type", "periodFrom", "periodTo");
