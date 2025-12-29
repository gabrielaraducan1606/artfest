-- CreateTable
CREATE TABLE "Ad" (
    "id" TEXT NOT NULL,
    "placement" VARCHAR(64) NOT NULL,
    "title" TEXT,
    "ctaText" TEXT,
    "ctaUrl" TEXT,
    "imageDesktop" TEXT,
    "imageMobile" TEXT,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "impressionUrl" TEXT,
    "clickUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ad_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Ad_placement_isActive_idx" ON "Ad"("placement", "isActive");

-- CreateIndex
CREATE INDEX "Ad_startAt_idx" ON "Ad"("startAt");

-- CreateIndex
CREATE INDEX "Ad_endAt_idx" ON "Ad"("endAt");
