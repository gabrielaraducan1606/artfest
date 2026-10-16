-- CreateEnum
CREATE TYPE "ArtfestFairParticipationType" AS ENUM ('PARTICIPARE_FIZICA', 'PARTICIPARE_LA_DISTANTA');

-- CreateEnum
CREATE TYPE "ArtfestFairRegistrationStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ArtfestDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "ArtfestFair" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "subtitle" VARCHAR(300),
    "city" VARCHAR(120),
    "venue" VARCHAR(200),
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "registrationOpen" BOOLEAN NOT NULL DEFAULT true,
    "termsVersion" VARCHAR(40),
    "termsUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtfestFair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtfestFairRegistration" (
    "id" TEXT NOT NULL,
    "fairId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "submittedByUserId" TEXT NOT NULL,
    "status" "ArtfestFairRegistrationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "participationType" "ArtfestFairParticipationType" NOT NULL,
    "contactName" VARCHAR(160) NOT NULL,
    "contactPhone" VARCHAR(50) NOT NULL,
    "contactEmail" VARCHAR(320) NOT NULL,
    "productTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "estimatedProductCount" INTEGER,
    "notes" TEXT,
    "termsAcceptedAt" TIMESTAMP(3) NOT NULL,
    "termsVersion" VARCHAR(40),
    "termsIp" VARCHAR(64),
    "termsUa" VARCHAR(500),
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "rejectionReason" TEXT,
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "ArtfestFairRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtfestBroadcastDelivery" (
    "id" TEXT NOT NULL,
    "campaignKey" VARCHAR(160) NOT NULL,
    "vendorId" TEXT NOT NULL,
    "userId" TEXT,
    "notificationId" TEXT,
    "notificationStatus" "ArtfestDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "notifiedAt" TIMESTAMP(3),
    "notificationError" TEXT,
    "emailTo" VARCHAR(320),
    "emailStatus" "ArtfestDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "emailAttempts" INTEGER NOT NULL DEFAULT 0,
    "emailSentAt" TIMESTAMP(3),
    "emailError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtfestBroadcastDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArtfestFair_key_key" ON "ArtfestFair"("key");

-- CreateIndex
CREATE INDEX "ArtfestFair_registrationOpen_idx" ON "ArtfestFair"("registrationOpen");

-- CreateIndex
CREATE INDEX "ArtfestFair_startsAt_endsAt_idx" ON "ArtfestFair"("startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "ArtfestFairRegistration_fairId_status_submittedAt_idx" ON "ArtfestFairRegistration"("fairId", "status", "submittedAt");

-- CreateIndex
CREATE INDEX "ArtfestFairRegistration_vendorId_submittedAt_idx" ON "ArtfestFairRegistration"("vendorId", "submittedAt");

-- CreateIndex
CREATE INDEX "ArtfestFairRegistration_submittedByUserId_idx" ON "ArtfestFairRegistration"("submittedByUserId");

-- CreateIndex
CREATE INDEX "ArtfestFairRegistration_reviewedById_idx" ON "ArtfestFairRegistration"("reviewedById");

-- CreateIndex
CREATE UNIQUE INDEX "ArtfestFairRegistration_fairId_vendorId_key" ON "ArtfestFairRegistration"("fairId", "vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtfestBroadcastDelivery_notificationId_key" ON "ArtfestBroadcastDelivery"("notificationId");

-- CreateIndex
CREATE INDEX "ArtfestBroadcastDelivery_campaignKey_notificationStatus_idx" ON "ArtfestBroadcastDelivery"("campaignKey", "notificationStatus");

-- CreateIndex
CREATE INDEX "ArtfestBroadcastDelivery_campaignKey_emailStatus_idx" ON "ArtfestBroadcastDelivery"("campaignKey", "emailStatus");

-- CreateIndex
CREATE INDEX "ArtfestBroadcastDelivery_vendorId_idx" ON "ArtfestBroadcastDelivery"("vendorId");

-- CreateIndex
CREATE INDEX "ArtfestBroadcastDelivery_userId_idx" ON "ArtfestBroadcastDelivery"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtfestBroadcastDelivery_campaignKey_vendorId_key" ON "ArtfestBroadcastDelivery"("campaignKey", "vendorId");

-- AddForeignKey
ALTER TABLE "ArtfestFairRegistration" ADD CONSTRAINT "ArtfestFairRegistration_fairId_fkey" FOREIGN KEY ("fairId") REFERENCES "ArtfestFair"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairRegistration" ADD CONSTRAINT "ArtfestFairRegistration_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairRegistration" ADD CONSTRAINT "ArtfestFairRegistration_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairRegistration" ADD CONSTRAINT "ArtfestFairRegistration_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestBroadcastDelivery" ADD CONSTRAINT "ArtfestBroadcastDelivery_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestBroadcastDelivery" ADD CONSTRAINT "ArtfestBroadcastDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
