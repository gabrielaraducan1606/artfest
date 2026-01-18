/*
  Warnings:

  - You are about to drop the `UserPolicy` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "PolicyScope" AS ENUM ('USERS', 'VENDORS');

-- DropTable
DROP TABLE "public"."UserPolicy";

-- CreateTable
CREATE TABLE "PolicyGateCampaign" (
    "id" TEXT NOT NULL,
    "scope" "PolicyScope" NOT NULL,
    "requiresAction" BOOLEAN NOT NULL DEFAULT true,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sendEmail" BOOLEAN NOT NULL DEFAULT false,
    "emailSubject" TEXT,
    "emailBody" TEXT,
    "documents" TEXT[],
    "targetCount" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "emailQueued" INTEGER,
    "emailFailed" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "campaignKey" TEXT NOT NULL,

    CONSTRAINT "PolicyGateCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PolicyGateCampaign_campaignKey_key" ON "PolicyGateCampaign"("campaignKey");

-- CreateIndex
CREATE INDEX "PolicyGateCampaign_scope_createdAt_idx" ON "PolicyGateCampaign"("scope", "createdAt");

-- CreateIndex
CREATE INDEX "PolicyGateCampaign_createdById_createdAt_idx" ON "PolicyGateCampaign"("createdById", "createdAt");

-- AddForeignKey
ALTER TABLE "PolicyGateCampaign" ADD CONSTRAINT "PolicyGateCampaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
