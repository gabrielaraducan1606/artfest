/*
  Warnings:

  - The primary key for the `LoginThrottle` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - Added the required column `vendorId` to the `Message` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "public"."EmailVerificationToken_expiresAt_usedAt_idx";

-- DropIndex
DROP INDEX "public"."LoginAttempt_ip_createdAt_idx";

-- DropIndex
DROP INDEX "public"."LoginThrottle_email_lockedUntil_idx";

-- DropIndex
DROP INDEX "public"."LoginThrottle_email_windowStart_idx";

-- DropIndex
DROP INDEX "public"."User_inactiveNotifiedAt_idx";

-- DropIndex
DROP INDEX "public"."User_lastLoginAt_idx";

-- DropIndex
DROP INDEX "public"."User_scheduledDeletionAt_idx";

-- DropIndex
DROP INDEX "public"."User_status_createdAt_idx";

-- AlterTable
ALTER TABLE "LoginThrottle" DROP CONSTRAINT "LoginThrottle_pkey",
ALTER COLUMN "email" SET DATA TYPE TEXT,
ADD CONSTRAINT "LoginThrottle_pkey" PRIMARY KEY ("email");

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "vendorId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "email" SET DATA TYPE TEXT;

-- CreateTable
CREATE TABLE "ChatUsage" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "threadCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatUsage_period_idx" ON "ChatUsage"("period");

-- CreateIndex
CREATE INDEX "ChatUsage_vendorId_updatedAt_idx" ON "ChatUsage"("vendorId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatUsage_vendorId_period_key" ON "ChatUsage"("vendorId", "period");

-- CreateIndex
CREATE INDEX "Message_vendorId_authorType_createdAt_idx" ON "Message"("vendorId", "authorType", "createdAt");

-- AddForeignKey
ALTER TABLE "ChatUsage" ADD CONSTRAINT "ChatUsage_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
