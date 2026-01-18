-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('NEW', 'CONTACTED', 'CONVERTED', 'SPAM');

-- CreateTable
CREATE TABLE "MarketplaceWaitlistSubscriber" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "source" TEXT,
    "name" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "contactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceWaitlistSubscriber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceWaitlistSubscriber_email_key" ON "MarketplaceWaitlistSubscriber"("email");

-- CreateIndex
CREATE INDEX "MarketplaceWaitlistSubscriber_createdAt_idx" ON "MarketplaceWaitlistSubscriber"("createdAt");

-- CreateIndex
CREATE INDEX "MarketplaceWaitlistSubscriber_status_idx" ON "MarketplaceWaitlistSubscriber"("status");

-- CreateIndex
CREATE INDEX "MarketplaceWaitlistSubscriber_source_idx" ON "MarketplaceWaitlistSubscriber"("source");
