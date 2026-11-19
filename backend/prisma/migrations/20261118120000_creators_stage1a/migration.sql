-- Artfest Creators, etapa 1a: profil, rețele sociale, portofoliu, oferte (versiuni imuabile), istoric.
-- Doar tabele / enum-uri NOI (fără modificări pe tabelele existente). NEaplicată în producție.

-- CreateEnum
CREATE TYPE "CreatorProfileStatus" AS ENUM ('DRAFT', 'PENDING', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CreatorSocialPlatform" AS ENUM ('INSTAGRAM', 'TIKTOK', 'FACEBOOK', 'YOUTUBE');

-- CreateEnum
CREATE TYPE "CreatorPortfolioKind" AS ENUM ('IMAGE', 'LINK');

-- CreateEnum
CREATE TYPE "CreatorOfferType" AS ENUM ('BARTER', 'PAID', 'MIXED');

-- CreateEnum
CREATE TYPE "CreatorProfileEventType" AS ENUM ('CREATED', 'SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'SUSPENDED', 'UNSUSPENDED', 'PAUSED', 'RESUMED', 'OFFER_DEACTIVATED_BY_ADMIN');

-- CreateEnum
CREATE TYPE "CreatorEmailStatus" AS ENUM ('NONE', 'PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "CreatorProfile" (
    "id" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "status" "CreatorProfileStatus" NOT NULL DEFAULT 'DRAFT',
    "displayName" VARCHAR(80),
    "slug" VARCHAR(80) NOT NULL,
    "bio" TEXT,
    "avatarUrl" VARCHAR(500),
    "city" VARCHAR(120),
    "niches" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferredCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contentLanguages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "acceptsProducts" BOOLEAN NOT NULL DEFAULT false,
    "acceptsPaid" BOOLEAN NOT NULL DEFAULT false,
    "typicalTurnaroundDays" INTEGER,
    "availableForCollabs" BOOLEAN NOT NULL DEFAULT true,
    "approvedSnapshot" JSONB,
    "approvedAt" TIMESTAMP(3),
    "hasUnpublishedChanges" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "moderationMessage" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "suspendedById" TEXT,
    "suspendedReason" TEXT,
    "pausedAt" TIMESTAMP(3),
    "onboardingCompletedAt" TIMESTAMP(3),
    "tourSeenVersion" INTEGER NOT NULL DEFAULT 0,
    "tourSeenAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorSocialAccount" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "platform" "CreatorSocialPlatform" NOT NULL,
    "url" VARCHAR(300) NOT NULL,
    "handle" VARCHAR(100) NOT NULL,
    "followersDeclared" INTEGER NOT NULL,
    "avgViewsDeclared" INTEGER,
    "engagementBps" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorSocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorPortfolioItem" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "kind" "CreatorPortfolioKind" NOT NULL,
    "imageUrl" VARCHAR(500),
    "linkUrl" VARCHAR(300),
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorPortfolioItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorOffer" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "disabledByAdminAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorOfferVersion" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "platform" "CreatorSocialPlatform" NOT NULL,
    "contentType" VARCHAR(40) NOT NULL,
    "deliverables" JSONB NOT NULL,
    "turnaroundDays" INTEGER NOT NULL,
    "type" "CreatorOfferType" NOT NULL,
    "creatorFeeCents" INTEGER,
    "acceptsProduct" BOOLEAN NOT NULL DEFAULT false,
    "conditions" TEXT,
    "contentHash" VARCHAR(64) NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorOfferVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorProfileEvent" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "type" "CreatorProfileEventType" NOT NULL,
    "actorUserId" TEXT,
    "actorRole" VARCHAR(20),
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "emailStatus" "CreatorEmailStatus" NOT NULL DEFAULT 'NONE',
    "emailAttempts" INTEGER NOT NULL DEFAULT 0,
    "emailError" VARCHAR(200),
    "emailSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorProfileEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreatorProfile_influencerId_key" ON "CreatorProfile"("influencerId");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorProfile_slug_key" ON "CreatorProfile"("slug");

-- CreateIndex
CREATE INDEX "CreatorProfile_status_updatedAt_idx" ON "CreatorProfile"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "CreatorProfile_status_suspendedAt_pausedAt_idx" ON "CreatorProfile"("status", "suspendedAt", "pausedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorSocialAccount_profileId_platform_key" ON "CreatorSocialAccount"("profileId", "platform");

-- CreateIndex
CREATE INDEX "CreatorPortfolioItem_profileId_sort_idx" ON "CreatorPortfolioItem"("profileId", "sort");

-- CreateIndex
CREATE INDEX "CreatorOffer_profileId_isActive_idx" ON "CreatorOffer"("profileId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorOfferVersion_offerId_version_key" ON "CreatorOfferVersion"("offerId", "version");

-- CreateIndex
CREATE INDEX "CreatorProfileEvent_profileId_createdAt_idx" ON "CreatorProfileEvent"("profileId", "createdAt");

-- CreateIndex
CREATE INDEX "CreatorProfileEvent_emailStatus_createdAt_idx" ON "CreatorProfileEvent"("emailStatus", "createdAt");

-- AddForeignKey
ALTER TABLE "CreatorProfile" ADD CONSTRAINT "CreatorProfile_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "InfluencerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorSocialAccount" ADD CONSTRAINT "CreatorSocialAccount_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorPortfolioItem" ADD CONSTRAINT "CreatorPortfolioItem_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorOffer" ADD CONSTRAINT "CreatorOffer_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorOfferVersion" ADD CONSTRAINT "CreatorOfferVersion_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "CreatorOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorProfileEvent" ADD CONSTRAINT "CreatorProfileEvent_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

