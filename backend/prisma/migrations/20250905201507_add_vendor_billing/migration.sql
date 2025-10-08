/*
  Warnings:

  - You are about to drop the column `bank` on the `Vendor` table. All the data in the column will be lost.
  - You are about to drop the column `billingAddr` on the `Vendor` table. All the data in the column will be lost.
  - You are about to drop the column `billingEmail` on the `Vendor` table. All the data in the column will be lost.
  - You are about to drop the column `billingPhone` on the `Vendor` table. All the data in the column will be lost.
  - You are about to drop the column `companyName` on the `Vendor` table. All the data in the column will be lost.
  - You are about to drop the column `contactPerson` on the `Vendor` table. All the data in the column will be lost.
  - You are about to drop the column `cui` on the `Vendor` table. All the data in the column will be lost.
  - You are about to drop the column `iban` on the `Vendor` table. All the data in the column will be lost.
  - You are about to drop the column `regCom` on the `Vendor` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."Vendor" DROP COLUMN "bank",
DROP COLUMN "billingAddr",
DROP COLUMN "billingEmail",
DROP COLUMN "billingPhone",
DROP COLUMN "companyName",
DROP COLUMN "contactPerson",
DROP COLUMN "cui",
DROP COLUMN "iban",
DROP COLUMN "regCom";

-- CreateTable
CREATE TABLE "public"."VendorBilling" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "companyName" VARCHAR(256),
    "cui" VARCHAR(10),
    "regCom" VARCHAR(32),
    "address" VARCHAR(512),
    "iban" VARCHAR(34),
    "bank" VARCHAR(128),
    "email" VARCHAR(254),
    "contactPerson" VARCHAR(128),
    "phone" VARCHAR(32),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorBilling_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorBilling_vendorId_key" ON "public"."VendorBilling"("vendorId");

-- CreateIndex
CREATE INDEX "VendorBilling_cui_idx" ON "public"."VendorBilling"("cui");

-- CreateIndex
CREATE INDEX "VendorBilling_email_idx" ON "public"."VendorBilling"("email");

-- AddForeignKey
ALTER TABLE "public"."VendorBilling" ADD CONSTRAINT "VendorBilling_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "public"."Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
