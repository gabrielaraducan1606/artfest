-- AlterTable
ALTER TABLE "InfluencerResource" ALTER COLUMN "title" SET DATA TYPE TEXT;

-- CreateTable
CREATE TABLE "InfluencerResourceActivity" (
    "id" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "lastPostedAt" TIMESTAMP(3),
    "postedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InfluencerResourceActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InfluencerResourceActivity_influencerId_lastPostedAt_idx" ON "InfluencerResourceActivity"("influencerId", "lastPostedAt");

-- CreateIndex
CREATE INDEX "InfluencerResourceActivity_resourceId_idx" ON "InfluencerResourceActivity"("resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "InfluencerResourceActivity_influencerId_resourceId_key" ON "InfluencerResourceActivity"("influencerId", "resourceId");

-- AddForeignKey
ALTER TABLE "InfluencerResourceActivity" ADD CONSTRAINT "InfluencerResourceActivity_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "InfluencerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfluencerResourceActivity" ADD CONSTRAINT "InfluencerResourceActivity_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "InfluencerResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
