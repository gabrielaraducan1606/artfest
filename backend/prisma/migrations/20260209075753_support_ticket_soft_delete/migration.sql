-- AlterTable
ALTER TABLE "SupportTicket" ADD COLUMN     "archivedByAdminAt" TIMESTAMP(3),
ADD COLUMN     "archivedByRequesterAt" TIMESTAMP(3),
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT;

-- CreateIndex
CREATE INDEX "SupportTicket_deletedAt_idx" ON "SupportTicket"("deletedAt");

-- CreateIndex
CREATE INDEX "SupportTicket_archivedByRequesterAt_idx" ON "SupportTicket"("archivedByRequesterAt");

-- CreateIndex
CREATE INDEX "SupportTicket_archivedByAdminAt_idx" ON "SupportTicket"("archivedByAdminAt");

-- CreateIndex
CREATE INDEX "SupportTicket_deletedById_idx" ON "SupportTicket"("deletedById");

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
