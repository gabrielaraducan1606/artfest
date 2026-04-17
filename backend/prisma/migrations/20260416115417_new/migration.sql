/*
  Warnings:

  - The primary key for the `StoreRatingStats` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - A unique constraint covering the columns `[serviceId,userId]` on the table `StoreReview` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `serviceId` to the `StoreRatingStats` table without a default value. This is not possible if the table is not empty.
  - Added the required column `serviceId` to the `StoreReview` table without a default value. This is not possible if the table is not empty.
  - Added the required column `serviceId` to the `StoreReviewReply` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `VendorAcceptance` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "VendorDoc" ADD VALUE 'VENDOR_PRIVACY_NOTICE';

-- DropIndex
DROP INDEX "public"."StoreReview_vendorId_userId_key";

-- AlterTable
ALTER TABLE "StoreRatingStats" DROP CONSTRAINT "StoreRatingStats_pkey",
ADD COLUMN     "serviceId" TEXT NOT NULL,
ADD CONSTRAINT "StoreRatingStats_pkey" PRIMARY KEY ("serviceId");

-- AlterTable
ALTER TABLE "StoreReview" ADD COLUMN     "serviceId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "StoreReviewReply" ADD COLUMN     "serviceId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "VendorAcceptance" ADD COLUMN     "ip" TEXT,
ADD COLUMN     "serviceId" TEXT,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "ua" TEXT,
ADD COLUMN     "userId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "StoreRatingStats_vendorId_idx" ON "StoreRatingStats"("vendorId");

-- CreateIndex
CREATE INDEX "StoreReview_serviceId_idx" ON "StoreReview"("serviceId");

-- CreateIndex
CREATE INDEX "store_review_service_status_idx" ON "StoreReview"("serviceId", "status");

-- CreateIndex
CREATE INDEX "store_review_service_status_created_idx" ON "StoreReview"("serviceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "store_review_vendor_status_created_idx" ON "StoreReview"("vendorId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StoreReview_serviceId_userId_key" ON "StoreReview"("serviceId", "userId");

-- CreateIndex
CREATE INDEX "StoreReviewReply_vendorId_idx" ON "StoreReviewReply"("vendorId");

-- CreateIndex
CREATE INDEX "StoreReviewReply_serviceId_idx" ON "StoreReviewReply"("serviceId");

-- CreateIndex
CREATE INDEX "VendorAcceptance_userId_acceptedAt_idx" ON "VendorAcceptance"("userId", "acceptedAt");

-- CreateIndex
CREATE INDEX "VendorAcceptance_serviceId_document_idx" ON "VendorAcceptance"("serviceId", "document");

-- AddForeignKey
ALTER TABLE "StoreReview" ADD CONSTRAINT "StoreReview_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "VendorService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreReviewReply" ADD CONSTRAINT "StoreReviewReply_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "VendorService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreRatingStats" ADD CONSTRAINT "StoreRatingStats_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "VendorService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorAcceptance" ADD CONSTRAINT "VendorAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorAcceptance" ADD CONSTRAINT "VendorAcceptance_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "VendorService"("id") ON DELETE SET NULL ON UPDATE CASCADE;
