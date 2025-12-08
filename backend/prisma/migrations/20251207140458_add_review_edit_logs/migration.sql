-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReviewStatus" ADD VALUE 'HIDDEN';
ALTER TYPE "ReviewStatus" ADD VALUE 'DELETED';

-- CreateTable
CREATE TABLE "ProductReviewEditLog" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "editorId" TEXT,
    "oldRating" INTEGER,
    "newRating" INTEGER,
    "oldComment" TEXT,
    "newComment" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductReviewEditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreReviewEditLog" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "editorId" TEXT,
    "oldRating" INTEGER,
    "newRating" INTEGER,
    "oldComment" TEXT,
    "newComment" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreReviewEditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductReviewEditLog_reviewId_createdAt_idx" ON "ProductReviewEditLog"("reviewId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductReviewEditLog_editorId_createdAt_idx" ON "ProductReviewEditLog"("editorId", "createdAt");

-- CreateIndex
CREATE INDEX "StoreReviewEditLog_reviewId_createdAt_idx" ON "StoreReviewEditLog"("reviewId", "createdAt");

-- CreateIndex
CREATE INDEX "StoreReviewEditLog_editorId_createdAt_idx" ON "StoreReviewEditLog"("editorId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProductReviewEditLog" ADD CONSTRAINT "ProductReviewEditLog_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReviewEditLog" ADD CONSTRAINT "ProductReviewEditLog_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreReviewEditLog" ADD CONSTRAINT "StoreReviewEditLog_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "StoreReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreReviewEditLog" ADD CONSTRAINT "StoreReviewEditLog_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
