/*
  Warnings:

  - The primary key for the `LoginThrottle` table will be changed. If it partially fails, the table could be left without primary key constraint.


*/
-- AlterTable
CREATE EXTENSION IF NOT EXISTS citext;

ALTER TABLE "LoginThrottle" DROP CONSTRAINT "LoginThrottle_pkey",
ALTER COLUMN "email" SET DATA TYPE CITEXT,
ADD CONSTRAINT "LoginThrottle_pkey" PRIMARY KEY ("email");

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "email" SET DATA TYPE CITEXT;

-- CreateIndex
CREATE INDEX "EmailVerificationToken_expiresAt_usedAt_idx" ON "EmailVerificationToken"("expiresAt", "usedAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_ip_createdAt_idx" ON "LoginAttempt"("ip", "createdAt");

-- CreateIndex
CREATE INDEX "LoginThrottle_email_lockedUntil_idx" ON "LoginThrottle"("email", "lockedUntil");

-- CreateIndex
CREATE INDEX "LoginThrottle_email_windowStart_idx" ON "LoginThrottle"("email", "windowStart");

-- CreateIndex
CREATE INDEX "User_status_createdAt_idx" ON "User"("status", "createdAt");

-- CreateIndex
CREATE INDEX "User_lastLoginAt_idx" ON "User"("lastLoginAt");

-- CreateIndex
CREATE INDEX "User_scheduledDeletionAt_idx" ON "User"("scheduledDeletionAt");

-- CreateIndex
CREATE INDEX "User_inactiveNotifiedAt_idx" ON "User"("inactiveNotifiedAt");
