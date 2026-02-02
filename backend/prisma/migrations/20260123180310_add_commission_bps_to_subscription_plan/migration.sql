/*
  Warnings:

  - You are about to drop the column `productLimitOverride` on the `Vendor` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "SubscriptionPlan" ADD COLUMN     "commissionBps" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Vendor" DROP COLUMN "productLimitOverride";
