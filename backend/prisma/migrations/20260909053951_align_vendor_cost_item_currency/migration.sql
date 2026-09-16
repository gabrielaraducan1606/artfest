/*
  Warnings:

  - You are about to alter the column `currency` on the `VendorCostItem` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(8)`.

*/
-- AlterTable
ALTER TABLE "VendorCostItem" ALTER COLUMN "currency" SET DATA TYPE VARCHAR(8);
