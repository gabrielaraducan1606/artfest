-- CreateEnum
CREATE TYPE "ProductModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "moderationMessage" TEXT,
ADD COLUMN     "moderationStatus" "ProductModerationStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedByUserId" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "product_moderation_created_idx" ON "Product"("moderationStatus", "createdAt");

-- CreateIndex
CREATE INDEX "product_service_moderation_visibility_idx" ON "Product"("serviceId", "moderationStatus", "isActive", "isHidden");

-- CreateIndex
CREATE INDEX "product_reviewedByUser_idx" ON "Product"("reviewedByUserId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
