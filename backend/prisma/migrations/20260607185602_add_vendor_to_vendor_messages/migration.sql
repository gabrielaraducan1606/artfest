-- CreateEnum
CREATE TYPE "MessageThreadType" AS ENUM ('CUSTOMER', 'VENDOR_TO_VENDOR');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "senderVendorId" TEXT;

-- AlterTable
ALTER TABLE "MessageThread" ADD COLUMN     "deletedByRecipientVendorAt" TIMESTAMP(3),
ADD COLUMN     "recipientVendorId" TEXT,
ADD COLUMN     "recipientVendorLastReadAt" TIMESTAMP(3),
ADD COLUMN     "type" "MessageThreadType" NOT NULL DEFAULT 'CUSTOMER';

-- CreateIndex
CREATE INDEX "Message_senderVendorId_createdAt_idx" ON "Message"("senderVendorId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageThread_type_idx" ON "MessageThread"("type");

-- CreateIndex
CREATE INDEX "MessageThread_recipientVendorId_lastAt_idx" ON "MessageThread"("recipientVendorId", "lastAt");

-- CreateIndex
CREATE INDEX "MessageThread_recipientVendorId_deletedByRecipientVendorAt_idx" ON "MessageThread"("recipientVendorId", "deletedByRecipientVendorAt");

-- CreateIndex
CREATE INDEX "MessageThread_vendorId_recipientVendorId_idx" ON "MessageThread"("vendorId", "recipientVendorId");

-- AddForeignKey
ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_recipientVendorId_fkey" FOREIGN KEY ("recipientVendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderVendorId_fkey" FOREIGN KEY ("senderVendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
