/*
  Warnings:

  - A unique constraint covering the columns `[vendorId,typeId]` on the table `VendorService` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "ConsentDoc" AS ENUM ('TOS', 'PRIVACY_ACK', 'MARKETING_EMAIL_OPTIN');

-- CreateEnum
CREATE TYPE "VendorDoc" AS ENUM ('VENDOR_TERMS', 'SHIPPING_ADDENDUM', 'RETURNS_POLICY_ACK');

-- CreateTable
CREATE TABLE "request_logs" (
    "idempotencyKey" TEXT NOT NULL,
    "responseJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_logs_pkey" PRIMARY KEY ("idempotencyKey")
);

-- CreateTable
CREATE TABLE "UserConsent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "document" "ConsentDoc" NOT NULL,
    "version" TEXT NOT NULL,
    "checksum" TEXT,
    "givenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "ua" TEXT,

    CONSTRAINT "UserConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorAcceptance" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "document" "VendorDoc" NOT NULL,
    "version" TEXT NOT NULL,
    "checksum" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserConsent_userId_document_idx" ON "UserConsent"("userId", "document");

-- CreateIndex
CREATE UNIQUE INDEX "VendorAcceptance_vendorId_document_key" ON "VendorAcceptance"("vendorId", "document");

-- CreateIndex
CREATE UNIQUE INDEX "VendorService_vendorId_typeId_key" ON "VendorService"("vendorId", "typeId");

-- AddForeignKey
ALTER TABLE "UserConsent" ADD CONSTRAINT "UserConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorAcceptance" ADD CONSTRAINT "VendorAcceptance_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
