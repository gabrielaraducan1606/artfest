/*
  Warnings:

  - A unique constraint covering the columns `[vendorId,document,version]` on the table `VendorAcceptance` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "public"."VendorAcceptance_vendorId_document_key";

-- CreateTable
CREATE TABLE "VendorPolicy" (
    "id" TEXT NOT NULL,
    "document" "VendorDoc" NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "checksum" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VendorPolicy_document_isActive_idx" ON "VendorPolicy"("document", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "VendorPolicy_document_version_key" ON "VendorPolicy"("document", "version");

-- CreateIndex
CREATE INDEX "VendorAcceptance_vendorId_document_acceptedAt_idx" ON "VendorAcceptance"("vendorId", "document", "acceptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VendorAcceptance_vendorId_document_version_key" ON "VendorAcceptance"("vendorId", "document", "version");
