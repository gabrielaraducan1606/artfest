-- DropIndex
DROP INDEX "public"."VendorSubscription_extRef_idx";

-- DropIndex
DROP INDEX "public"."vendor_sub_vendor_status_created_idx";

-- AlterTable
ALTER TABLE "SubscriptionPlan" ADD COLUMN     "stripePriceMonthId" VARCHAR(255),
ADD COLUMN     "stripePriceYearId" VARCHAR(255),
ADD COLUMN     "stripeProductId" VARCHAR(255);

-- AlterTable
ALTER TABLE "VendorSubscription" ADD COLUMN     "stripeCheckoutSessionId" VARCHAR(255);

-- CreateIndex
CREATE INDEX "SubscriptionPlan_stripeProductId_idx" ON "SubscriptionPlan"("stripeProductId");

-- CreateIndex
CREATE INDEX "SubscriptionPlan_stripePriceMonthId_idx" ON "SubscriptionPlan"("stripePriceMonthId");

-- CreateIndex
CREATE INDEX "SubscriptionPlan_stripePriceYearId_idx" ON "SubscriptionPlan"("stripePriceYearId");
