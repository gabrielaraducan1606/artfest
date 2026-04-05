-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "deletedByUserAt" TIMESTAMP(3),
ADD COLUMN     "deletedByVendorAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "MessageThread" ADD COLUMN     "deletedByUserAt" TIMESTAMP(3),
ADD COLUMN     "deletedByVendorAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Message_threadId_deletedByUserAt_idx" ON "Message"("threadId", "deletedByUserAt");

-- CreateIndex
CREATE INDEX "Message_threadId_deletedByVendorAt_idx" ON "Message"("threadId", "deletedByVendorAt");

-- CreateIndex
CREATE INDEX "MessageThread_userId_deletedByUserAt_idx" ON "MessageThread"("userId", "deletedByUserAt");

-- CreateIndex
CREATE INDEX "MessageThread_vendorId_deletedByVendorAt_idx" ON "MessageThread"("vendorId", "deletedByVendorAt");
