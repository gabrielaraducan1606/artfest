-- CreateEnum
CREATE TYPE "InfluencerPayoutBeneficiaryType" AS ENUM ('INDIVIDUAL', 'PFA', 'COMPANY', 'OTHER');

-- CreateEnum
CREATE TYPE "InfluencerPayoutVerificationStatus" AS ENUM ('INCOMPLETE', 'COMPLETE', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED');

-- CreateTable
CREATE TABLE "InfluencerPayoutProfile" (
    "id" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "beneficiaryType" "InfluencerPayoutBeneficiaryType",
    "beneficiaryName" TEXT,
    "iban" TEXT,
    "bankName" TEXT,
    "countryCode" VARCHAR(2) NOT NULL DEFAULT 'RO',
    "fiscalName" TEXT,
    "taxId" TEXT,
    "registrationNumber" TEXT,
    "fiscalAddress" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "isComplete" BOOLEAN NOT NULL DEFAULT false,
    "verificationStatus" "InfluencerPayoutVerificationStatus" NOT NULL DEFAULT 'INCOMPLETE',
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InfluencerPayoutProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InfluencerPayoutProfile_influencerId_key" ON "InfluencerPayoutProfile"("influencerId");

-- CreateIndex
CREATE INDEX "InfluencerPayoutProfile_verificationStatus_idx" ON "InfluencerPayoutProfile"("verificationStatus");

-- AddForeignKey
ALTER TABLE "InfluencerPayoutProfile" ADD CONSTRAINT "InfluencerPayoutProfile_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "InfluencerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
