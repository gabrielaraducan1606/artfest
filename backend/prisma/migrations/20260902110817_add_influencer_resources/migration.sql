-- CreateEnum
CREATE TYPE "InfluencerResourceType" AS ENUM ('PRODUCT_OF_DAY', 'ARTISAN_OF_WEEK', 'POST_IDEA', 'ARTFEST_FEATURE', 'CAMPAIGN', 'GENERIC');

-- CreateEnum
CREATE TYPE "InfluencerResourceMediaType" AS ENUM ('IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "InfluencerResourceStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "InfluencerResource" (
    "id" TEXT NOT NULL,
    "type" "InfluencerResourceType" NOT NULL DEFAULT 'GENERIC',
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "mediaType" "InfluencerResourceMediaType",
    "mediaUrl" TEXT,
    "thumbnailUrl" TEXT,
    "targetUrl" TEXT,
    "status" "InfluencerResourceStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InfluencerResource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InfluencerResource_status_publishedAt_idx" ON "InfluencerResource"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "InfluencerResource_type_status_publishedAt_idx" ON "InfluencerResource"("type", "status", "publishedAt");

-- CreateIndex
CREATE INDEX "InfluencerResource_expiresAt_idx" ON "InfluencerResource"("expiresAt");

-- CreateIndex
CREATE INDEX "InfluencerResource_createdAt_idx" ON "InfluencerResource"("createdAt");
