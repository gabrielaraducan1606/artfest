/*
  Warnings:

  - You are about to drop the column `cif` on the `Vendor` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."Vendor" DROP COLUMN "cif",
ADD COLUMN     "bank" TEXT,
ADD COLUMN     "cui" TEXT;
