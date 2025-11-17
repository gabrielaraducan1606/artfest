-- DropForeignKey
ALTER TABLE "public"."Event" DROP CONSTRAINT "Event_vendorId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Search" DROP CONSTRAINT "Search_vendorId_fkey";

-- DropIndex
DROP INDEX "public"."Event_vendorId_pageUrl_idx";

-- DropIndex
DROP INDEX "public"."Search_vendorId_query_idx";

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Search" ADD CONSTRAINT "Search_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
