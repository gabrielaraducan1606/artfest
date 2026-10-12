-- Gate de conformitate pentru influenceri (aplicat MANUAL de admin, ex. acord
-- părinte/tutore pentru minori). Strict aditiv: 3 enum-uri + 2 tabele noi,
-- fără modificări pe tabele existente, fără UPDATE/DELETE/backfill.
-- CreateEnum
CREATE TYPE "InfluencerComplianceGateType" AS ENUM ('MINOR_PARENTAL_CONSENT');

-- CreateEnum
CREATE TYPE "InfluencerComplianceGateStatus" AS ENUM ('PENDING', 'COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InfluencerGuardianRelationship" AS ENUM ('PARENT', 'LEGAL_GUARDIAN');

-- CreateTable
CREATE TABLE "InfluencerComplianceGate" (
    "id" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "type" "InfluencerComplianceGateType" NOT NULL,
    "status" "InfluencerComplianceGateStatus" NOT NULL DEFAULT 'PENDING',
    "requiredDocumentKey" VARCHAR(64) NOT NULL,
    "requiredDocumentVersion" VARCHAR(32) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" VARCHAR(500),
    "replacedByGateId" TEXT,
    "createdByAdminId" TEXT,
    "cancelledByAdminId" TEXT,
    "reviewedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InfluencerComplianceGate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InfluencerComplianceResponse" (
    "id" TEXT NOT NULL,
    "gateId" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "submittedByUserId" TEXT NOT NULL,
    "influencerName" VARCHAR(160) NOT NULL,
    "influencerEmail" VARCHAR(320) NOT NULL,
    "influencerBirthDate" DATE NOT NULL,
    "declaredMinor" BOOLEAN NOT NULL,
    "guardianName" VARCHAR(160) NOT NULL,
    "guardianRelationship" "InfluencerGuardianRelationship" NOT NULL,
    "guardianEmail" VARCHAR(320) NOT NULL,
    "guardianPhone" VARCHAR(40) NOT NULL,
    "declarations" JSONB NOT NULL,
    "documentKey" VARCHAR(64) NOT NULL,
    "documentVersion" VARCHAR(32) NOT NULL,
    "documentChecksum" VARCHAR(64) NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedIpHash" VARCHAR(64),
    "acceptedUserAgent" VARCHAR(500),
    "guardianEmailSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InfluencerComplianceResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InfluencerComplianceGate_influencerId_status_idx" ON "InfluencerComplianceGate"("influencerId", "status");

-- CreateIndex
CREATE INDEX "InfluencerComplianceGate_influencerId_createdAt_idx" ON "InfluencerComplianceGate"("influencerId", "createdAt");

-- CreateIndex
CREATE INDEX "InfluencerComplianceGate_status_expiresAt_idx" ON "InfluencerComplianceGate"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "InfluencerComplianceResponse_gateId_key" ON "InfluencerComplianceResponse"("gateId");

-- CreateIndex
CREATE INDEX "InfluencerComplianceResponse_influencerId_idx" ON "InfluencerComplianceResponse"("influencerId");

-- AddForeignKey
ALTER TABLE "InfluencerComplianceGate" ADD CONSTRAINT "InfluencerComplianceGate_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "InfluencerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfluencerComplianceResponse" ADD CONSTRAINT "InfluencerComplianceResponse_gateId_fkey" FOREIGN KEY ("gateId") REFERENCES "InfluencerComplianceGate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

