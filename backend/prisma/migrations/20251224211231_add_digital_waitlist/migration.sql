-- CreateTable
CREATE TABLE "DigitalWaitlistSubscriber" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "source" TEXT,
    "name" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "notes" TEXT,
    "contactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigitalWaitlistSubscriber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DigitalWaitlistSubscriber_email_key" ON "DigitalWaitlistSubscriber"("email");

-- CreateIndex
CREATE INDEX "DigitalWaitlistSubscriber_createdAt_idx" ON "DigitalWaitlistSubscriber"("createdAt");

-- CreateIndex
CREATE INDEX "DigitalWaitlistSubscriber_status_idx" ON "DigitalWaitlistSubscriber"("status");
