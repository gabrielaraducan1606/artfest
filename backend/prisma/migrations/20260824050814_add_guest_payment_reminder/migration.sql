-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "guestPaymentReminderSentAt" TIMESTAMP(3),
ADD COLUMN     "guestPaymentReminderTokenHash" VARCHAR(64);

-- CreateIndex
CREATE INDEX "Order_guestPaymentReminderTokenHash_idx" ON "Order"("guestPaymentReminderTokenHash");

-- CreateIndex
CREATE INDEX "Order_guestPaymentReminderSentAt_idx" ON "Order"("guestPaymentReminderSentAt");

-- CreateIndex
CREATE INDEX "Order_isGuestOrder_paymentMethod_status_createdAt_idx" ON "Order"("isGuestOrder", "paymentMethod", "status", "createdAt");
