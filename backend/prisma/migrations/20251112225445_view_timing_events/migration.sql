-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EventType" ADD VALUE 'VIEW_START';
ALTER TYPE "EventType" ADD VALUE 'VIEW_PING';
ALTER TYPE "EventType" ADD VALUE 'VIEW_END';

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "viewId" TEXT;

-- CreateIndex
CREATE INDEX "Event_vendorId_pageUrl_createdAt_idx" ON "Event"("vendorId", "pageUrl", "createdAt");

-- CreateIndex
CREATE INDEX "Event_vendorId_sessionId_viewId_createdAt_idx" ON "Event"("vendorId", "sessionId", "viewId", "createdAt");
