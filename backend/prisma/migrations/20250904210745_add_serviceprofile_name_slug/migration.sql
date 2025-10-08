/*
  Warnings:

  - You are about to drop the column `slug` on the `Vendor` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[slug]` on the table `ServiceProfile` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "public"."Vendor_slug_key";

-- AlterTable
ALTER TABLE "public"."ServiceProfile" ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "slug" TEXT;

-- AlterTable
ALTER TABLE "public"."Vendor" DROP COLUMN "slug";

-- CreateIndex
CREATE UNIQUE INDEX "ServiceProfile_slug_key" ON "public"."ServiceProfile"("slug");
