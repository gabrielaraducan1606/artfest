-- AlterTable
ALTER TABLE "SupportTicket" ADD COLUMN     "lastAdminReplyEmailAt" TIMESTAMP(3),
ADD COLUMN     "lastRequesterMessageAt" TIMESTAMP(3),
ADD COLUMN     "notifyEmailOnAdminReply" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "SupportTicket_lastAdminReplyEmailAt_idx" ON "SupportTicket"("lastAdminReplyEmailAt");

-- CreateIndex
CREATE INDEX "SupportTicket_lastRequesterMessageAt_idx" ON "SupportTicket"("lastRequesterMessageAt");
