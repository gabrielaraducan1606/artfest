-- AlterTable
ALTER TABLE "InfluencerInvite" ALTER COLUMN "commissionBps" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "InfluencerProfile" ALTER COLUMN "commissionBps" SET DEFAULT 0;

-- CreateTable
CREATE TABLE "InfluencerCollection" (
    "id" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(180) NOT NULL,
    "description" TEXT,
    "coverImage" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sort" VARCHAR(32) NOT NULL DEFAULT 'curated',
    "visits" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InfluencerCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InfluencerCollectionItem" (
    "collectionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "position" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InfluencerCollectionItem_pkey" PRIMARY KEY ("collectionId","productId")
);

-- CreateIndex
CREATE UNIQUE INDEX "InfluencerCollection_slug_key" ON "InfluencerCollection"("slug");

-- CreateIndex
CREATE INDEX "InfluencerCollection_influencerId_createdAt_idx" ON "InfluencerCollection"("influencerId", "createdAt");

-- CreateIndex
CREATE INDEX "InfluencerCollection_influencerId_isActive_idx" ON "InfluencerCollection"("influencerId", "isActive");

-- CreateIndex
CREATE INDEX "InfluencerCollection_isActive_createdAt_idx" ON "InfluencerCollection"("isActive", "createdAt");

-- CreateIndex
CREATE INDEX "InfluencerCollectionItem_productId_idx" ON "InfluencerCollectionItem"("productId");

-- CreateIndex
CREATE INDEX "InfluencerCollectionItem_collectionId_position_idx" ON "InfluencerCollectionItem"("collectionId", "position");

-- AddForeignKey
ALTER TABLE "InfluencerCollection" ADD CONSTRAINT "InfluencerCollection_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "InfluencerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfluencerCollectionItem" ADD CONSTRAINT "InfluencerCollectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "InfluencerCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfluencerCollectionItem" ADD CONSTRAINT "InfluencerCollectionItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
