/*
  Warnings:

  - A unique constraint covering the columns `[userId,document,version]` on the table `UserConsent` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ConsentDoc" ADD VALUE 'COOKIES_ACK';
ALTER TYPE "ConsentDoc" ADD VALUE 'RETURNS_POLICY_ACK';

-- CreateIndex
CREATE UNIQUE INDEX "UserConsent_userId_document_version_key" ON "UserConsent"("userId", "document", "version");
