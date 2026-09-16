-- CreateEnum
CREATE TYPE "InfluencerCommissionAgreementStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "InfluencerCommissionAgreement" (
    "id" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "commissionBps" INTEGER NOT NULL,
    "status" "InfluencerCommissionAgreementStatus" NOT NULL DEFAULT 'PENDING',
    "agreementText" TEXT,
    "termsVersion" VARCHAR(32) NOT NULL DEFAULT '1.0',
    "proposedByUserId" TEXT,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "acceptedIpHash" VARCHAR(64),
    "acceptedUserAgent" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InfluencerCommissionAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InfluencerCommissionAgreement_influencerId_status_idx" ON "InfluencerCommissionAgreement"("influencerId", "status");

-- CreateIndex
CREATE INDEX "InfluencerCommissionAgreement_influencerId_proposedAt_idx" ON "InfluencerCommissionAgreement"("influencerId", "proposedAt");

-- CreateIndex
CREATE INDEX "InfluencerCommissionAgreement_proposedByUserId_idx" ON "InfluencerCommissionAgreement"("proposedByUserId");

-- CreateIndex
CREATE INDEX "InfluencerCommissionAgreement_status_proposedAt_idx" ON "InfluencerCommissionAgreement"("status", "proposedAt");

-- AddForeignKey
ALTER TABLE "InfluencerCommissionAgreement" ADD CONSTRAINT "InfluencerCommissionAgreement_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "InfluencerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfluencerCommissionAgreement" ADD CONSTRAINT "InfluencerCommissionAgreement_proposedByUserId_fkey" FOREIGN KEY ("proposedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
