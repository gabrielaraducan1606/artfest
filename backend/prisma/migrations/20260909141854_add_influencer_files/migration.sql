-- CreateEnum
CREATE TYPE "InfluencerFileType" AS ENUM ('CONTRACT', 'BRIEF', 'DOCUMENT', 'OTHER');

-- CreateTable
CREATE TABLE "InfluencerFile" (
    "id" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "type" "InfluencerFileType" NOT NULL DEFAULT 'OTHER',
    "title" TEXT,
    "originalFilename" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InfluencerFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InfluencerFile_influencerId_createdAt_idx" ON "InfluencerFile"("influencerId", "createdAt");

-- CreateIndex
CREATE INDEX "InfluencerFile_influencerId_type_idx" ON "InfluencerFile"("influencerId", "type");

-- AddForeignKey
ALTER TABLE "InfluencerFile" ADD CONSTRAINT "InfluencerFile_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "InfluencerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
