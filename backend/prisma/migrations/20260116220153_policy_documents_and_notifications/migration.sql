/*
  Warnings:

  - You are about to drop the column `ip` on the `VendorAcceptance` table. All the data in the column will be lost.
  - You are about to drop the column `ua` on the `VendorAcceptance` table. All the data in the column will be lost.
  - You are about to drop the `UserPolicy` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "PolicyScope" AS ENUM ('USERS', 'VENDORS');

-- CreateEnum
CREATE TYPE "PolicyKey" AS ENUM ('TOS', 'PRIVACY', 'MARKETING', 'VENDOR_TERMS', 'SHIPPING_ADDENDUM', 'RETURNS_POLICY_ACK', 'PRODUCTS_ADDENDUM', 'PRODUCT_DECLARATION');

-- AlterTable
ALTER TABLE "VendorAcceptance" DROP COLUMN "ip",
DROP COLUMN "ua";

-- DropTable
DROP TABLE "public"."UserPolicy";

-- CreateTable
CREATE TABLE "PolicyDocument" (
    "id" TEXT NOT NULL,
    "scope" "PolicyScope" NOT NULL,
    "key" "PolicyKey" NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT,
    "url" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyNotification" (
    "id" TEXT NOT NULL,
    "scope" "PolicyScope" NOT NULL,
    "userId" TEXT,
    "vendorId" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "documents" JSONB NOT NULL,
    "requiresAction" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "PolicyNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAcceptance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "document" "PolicyKey" NOT NULL,
    "version" INTEGER NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PolicyDocument_scope_key_key" ON "PolicyDocument"("scope", "key");

-- CreateIndex
CREATE INDEX "PolicyNotification_scope_userId_idx" ON "PolicyNotification"("scope", "userId");

-- CreateIndex
CREATE INDEX "PolicyNotification_scope_vendorId_idx" ON "PolicyNotification"("scope", "vendorId");

-- CreateIndex
CREATE INDEX "UserAcceptance_userId_document_idx" ON "UserAcceptance"("userId", "document");
