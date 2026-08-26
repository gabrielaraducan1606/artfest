-- CreateEnum
CREATE TYPE "InfluencerStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'INFLUENCER';

-- CreateTable
CREATE TABLE "InfluencerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT,
    "referralCode" TEXT NOT NULL,
    "commissionBps" INTEGER NOT NULL DEFAULT 800,
    "status" "InfluencerStatus" NOT NULL DEFAULT 'ACTIVE',
    "instagramUrl" TEXT,
    "tiktokUrl" TEXT,
    "facebookUrl" TEXT,
    "websiteUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InfluencerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InfluencerInvite" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "referralCode" TEXT NOT NULL,
    "commissionBps" INTEGER NOT NULL DEFAULT 800,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "acceptedUserId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InfluencerInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InfluencerClick" (
    "id" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "sessionId" TEXT,
    "pageUrl" TEXT,
    "referrer" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InfluencerClick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InfluencerProfile_userId_key" ON "InfluencerProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "InfluencerProfile_referralCode_key" ON "InfluencerProfile"("referralCode");

-- CreateIndex
CREATE INDEX "InfluencerProfile_referralCode_idx" ON "InfluencerProfile"("referralCode");

-- CreateIndex
CREATE INDEX "InfluencerProfile_status_idx" ON "InfluencerProfile"("status");

-- CreateIndex
CREATE INDEX "InfluencerProfile_createdAt_idx" ON "InfluencerProfile"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InfluencerInvite_referralCode_key" ON "InfluencerInvite"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "InfluencerInvite_tokenHash_key" ON "InfluencerInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "InfluencerInvite_email_idx" ON "InfluencerInvite"("email");

-- CreateIndex
CREATE INDEX "InfluencerInvite_expiresAt_idx" ON "InfluencerInvite"("expiresAt");

-- CreateIndex
CREATE INDEX "InfluencerInvite_usedAt_idx" ON "InfluencerInvite"("usedAt");

-- CreateIndex
CREATE INDEX "InfluencerInvite_acceptedUserId_idx" ON "InfluencerInvite"("acceptedUserId");

-- CreateIndex
CREATE INDEX "InfluencerInvite_createdByUserId_idx" ON "InfluencerInvite"("createdByUserId");

-- CreateIndex
CREATE INDEX "InfluencerInvite_createdAt_idx" ON "InfluencerInvite"("createdAt");

-- CreateIndex
CREATE INDEX "InfluencerClick_influencerId_createdAt_idx" ON "InfluencerClick"("influencerId", "createdAt");

-- CreateIndex
CREATE INDEX "InfluencerClick_sessionId_idx" ON "InfluencerClick"("sessionId");

-- CreateIndex
CREATE INDEX "InfluencerClick_createdAt_idx" ON "InfluencerClick"("createdAt");

-- AddForeignKey
ALTER TABLE "InfluencerProfile" ADD CONSTRAINT "InfluencerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfluencerInvite" ADD CONSTRAINT "InfluencerInvite_acceptedUserId_fkey" FOREIGN KEY ("acceptedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfluencerInvite" ADD CONSTRAINT "InfluencerInvite_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfluencerClick" ADD CONSTRAINT "InfluencerClick_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "InfluencerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
