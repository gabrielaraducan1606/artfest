-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "vendorId" TEXT;

-- CreateIndex
CREATE INDEX "Comment_vendorId_idx" ON "Comment"("vendorId");

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
