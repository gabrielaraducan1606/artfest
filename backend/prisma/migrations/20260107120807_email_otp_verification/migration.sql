-- AlterTable
ALTER TABLE "EmailVerificationToken" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_usedAt_createdAt_idx" ON "EmailVerificationToken"("userId", "usedAt", "createdAt");
