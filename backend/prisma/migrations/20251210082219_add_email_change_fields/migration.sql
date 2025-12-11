-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailChangeExpiresAt" TIMESTAMP(3),
ADD COLUMN     "emailChangeNewEmail" TEXT,
ADD COLUMN     "emailChangeToken" TEXT;

-- CreateIndex
CREATE INDEX "User_emailChangeToken_idx" ON "User"("emailChangeToken");
