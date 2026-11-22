-- Moderare AI asincronă (coadă persistentă) + idempotența creării de produs.
-- EXCLUSIV aditivă: un enum nou, două tabele noi, indexuri și chei străine.
-- Nu modifică / nu actualizează / nu șterge rânduri din tabelele existente.
-- NEaplicată în producție.

-- CreateEnum
CREATE TYPE "ProductModerationJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'SKIPPED', 'DEAD');

-- CreateTable
CREATE TABLE "ProductModerationJob" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "reason" VARCHAR(32) NOT NULL,
    "status" "ProductModerationJobStatus" NOT NULL DEFAULT 'QUEUED',
    "activeKey" VARCHAR(191),
    "contentHash" VARCHAR(64) NOT NULL,
    "statusSnapshot" JSONB NOT NULL,
    "previouslyRejectedByAdmin" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" VARCHAR(100),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "outcome" VARCHAR(40),
    "lastErrorCode" VARCHAR(64),
    "lastErrorMessage" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductModerationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCreateRequest" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "idempotencyKey" VARCHAR(100) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "productId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCreateRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductModerationJob_activeKey_key" ON "ProductModerationJob"("activeKey");

-- CreateIndex
CREATE INDEX "ProductModerationJob_status_runAfter_idx" ON "ProductModerationJob"("status", "runAfter");

-- CreateIndex
CREATE INDEX "ProductModerationJob_productId_status_idx" ON "ProductModerationJob"("productId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCreateRequest_productId_key" ON "ProductCreateRequest"("productId");

-- CreateIndex
CREATE INDEX "ProductCreateRequest_createdAt_idx" ON "ProductCreateRequest"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCreateRequest_vendorId_idempotencyKey_key" ON "ProductCreateRequest"("vendorId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "ProductModerationJob" ADD CONSTRAINT "ProductModerationJob_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCreateRequest" ADD CONSTRAINT "ProductCreateRequest_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
