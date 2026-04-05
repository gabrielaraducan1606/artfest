-- CreateEnum
CREATE TYPE "StripeConnectStatus" AS ENUM ('not_started', 'pending', 'enabled', 'restricted');

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "stripeConnectStatus" "StripeConnectStatus" NOT NULL DEFAULT 'not_started',
ADD COLUMN     "stripeDisabledReason" VARCHAR(255),
ADD COLUMN     "stripeRequirementsDue" JSONB;
