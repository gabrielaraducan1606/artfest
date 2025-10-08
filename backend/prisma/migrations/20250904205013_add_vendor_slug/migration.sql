/*
  Warnings:

  - A unique constraint covering the columns `[slug]` on the table `Vendor` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."Vendor" ADD COLUMN     "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_slug_key" ON "public"."Vendor"("slug");
