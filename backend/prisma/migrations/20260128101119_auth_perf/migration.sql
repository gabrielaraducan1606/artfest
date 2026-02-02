-- AlterTable
ALTER TABLE "PasswordHistory" ADD COLUMN     "fingerprint" VARCHAR(64);

-- CreateTable
CREATE TABLE "LoginThrottle" (
    "email" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "fails" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginThrottle_pkey" PRIMARY KEY ("email")
);

-- CreateIndex
CREATE INDEX "LoginThrottle_lockedUntil_idx" ON "LoginThrottle"("lockedUntil");

-- CreateIndex
CREATE INDEX "LoginThrottle_windowStart_idx" ON "LoginThrottle"("windowStart");

-- CreateIndex
CREATE INDEX "PasswordHistory_userId_fingerprint_idx" ON "PasswordHistory"("userId", "fingerprint");
