-- AlterTable
ALTER TABLE "User" ADD COLUMN     "vendorDeactivateExpiresAt" TIMESTAMP(3),
ADD COLUMN     "vendorDeactivateToken" TEXT;

-- CreateIndex
CREATE INDEX "User_vendorDeactivateToken_idx" ON "User"("vendorDeactivateToken");
