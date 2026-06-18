-- CreateEnum
CREATE TYPE "AmbassadorLevel" AS ENUM ('FOUNDING', 'AMBASSADOR', 'GOLD', 'ELITE');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'CONVERTED', 'REJECTED');

-- CreateTable
CREATE TABLE "AmbassadorProfile" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "referralCode" TEXT NOT NULL,
    "invitedCount" INTEGER NOT NULL DEFAULT 0,
    "city" TEXT,
    "citySlug" TEXT,
    "level" "AmbassadorLevel" NOT NULL DEFAULT 'FOUNDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmbassadorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmbassadorReferral" (
    "id" TEXT NOT NULL,
    "ambassadorId" TEXT NOT NULL,
    "invitedVendorId" TEXT,
    "invitedUserId" TEXT,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "convertedAt" TIMESTAMP(3),

    CONSTRAINT "AmbassadorReferral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AmbassadorProfile_vendorId_key" ON "AmbassadorProfile"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "AmbassadorProfile_referralCode_key" ON "AmbassadorProfile"("referralCode");

-- CreateIndex
CREATE INDEX "AmbassadorProfile_referralCode_idx" ON "AmbassadorProfile"("referralCode");

-- CreateIndex
CREATE INDEX "AmbassadorProfile_citySlug_idx" ON "AmbassadorProfile"("citySlug");

-- CreateIndex
CREATE INDEX "AmbassadorProfile_level_idx" ON "AmbassadorProfile"("level");

-- CreateIndex
CREATE UNIQUE INDEX "AmbassadorReferral_invitedVendorId_key" ON "AmbassadorReferral"("invitedVendorId");

-- CreateIndex
CREATE INDEX "AmbassadorReferral_ambassadorId_idx" ON "AmbassadorReferral"("ambassadorId");

-- CreateIndex
CREATE INDEX "AmbassadorReferral_status_idx" ON "AmbassadorReferral"("status");

-- AddForeignKey
ALTER TABLE "AmbassadorProfile" ADD CONSTRAINT "AmbassadorProfile_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmbassadorReferral" ADD CONSTRAINT "AmbassadorReferral_ambassadorId_fkey" FOREIGN KEY ("ambassadorId") REFERENCES "AmbassadorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
