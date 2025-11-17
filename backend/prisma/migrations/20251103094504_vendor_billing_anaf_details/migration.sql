/*
  Warnings:

  - The primary key for the `VendorBilling` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - A unique constraint covering the columns `[vendorId]` on the table `VendorBilling` will be added. If there are existing duplicate values, this will fail.
  - The required column `id` was added to the `VendorBilling` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- DropForeignKey
ALTER TABLE "public"."VendorBilling" DROP CONSTRAINT "VendorBilling_vendorId_fkey";

-- AlterTable
ALTER TABLE "VendorBilling" DROP CONSTRAINT "VendorBilling_pkey",
ADD COLUMN     "anafAddress" TEXT,
ADD COLUMN     "anafName" TEXT,
ADD COLUMN     "anafPayload" JSONB,
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "inactiv" BOOLEAN,
ADD COLUMN     "inactivFrom" TIMESTAMP(3),
ADD COLUMN     "insolvent" BOOLEAN,
ADD COLUMN     "splitTva" BOOLEAN,
ADD COLUMN     "tvaActive" BOOLEAN,
ADD COLUMN     "tvaRegEnd" TIMESTAMP(3),
ADD COLUMN     "tvaRegStart" TIMESTAMP(3),
ADD COLUMN     "tvaSource" TEXT,
ADD COLUMN     "tvaVerifiedAt" TIMESTAMP(3),
ADD CONSTRAINT "VendorBilling_pkey" PRIMARY KEY ("id");

-- CreateIndex
CREATE UNIQUE INDEX "VendorBilling_vendorId_key" ON "VendorBilling"("vendorId");

-- CreateIndex
CREATE INDEX "VendorBilling_cui_idx" ON "VendorBilling"("cui");

-- CreateIndex
CREATE INDEX "VendorBilling_email_idx" ON "VendorBilling"("email");

-- AddForeignKey
ALTER TABLE "VendorBilling" ADD CONSTRAINT "VendorBilling_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
