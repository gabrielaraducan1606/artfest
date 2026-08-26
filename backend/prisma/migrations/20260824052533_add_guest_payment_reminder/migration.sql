/*
  Warnings:

  - You are about to drop the column `guestPaymentReminderTokenHash` on the `Order` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "public"."Order_guestPaymentReminderTokenHash_idx";

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "guestPaymentReminderTokenHash";
