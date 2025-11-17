/*
  Warnings:

  - The primary key for the `VendorBilling` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `id` on the `VendorBilling` table. All the data in the column will be lost.
  - Made the column `companyName` on table `VendorBilling` required. This step will fail if there are existing NULL values in that column.
  - Made the column `cui` on table `VendorBilling` required. This step will fail if there are existing NULL values in that column.
  - Made the column `regCom` on table `VendorBilling` required. This step will fail if there are existing NULL values in that column.
  - Made the column `address` on table `VendorBilling` required. This step will fail if there are existing NULL values in that column.
  - Made the column `iban` on table `VendorBilling` required. This step will fail if there are existing NULL values in that column.
  - Made the column `bank` on table `VendorBilling` required. This step will fail if there are existing NULL values in that column.
  - Made the column `email` on table `VendorBilling` required. This step will fail if there are existing NULL values in that column.
  - Made the column `contactPerson` on table `VendorBilling` required. This step will fail if there are existing NULL values in that column.
  - Made the column `phone` on table `VendorBilling` required. This step will fail if there are existing NULL values in that column.
  - Made the column `legalType` on table `VendorBilling` required. This step will fail if there are existing NULL values in that column.
  - Made the column `vendorName` on table `VendorBilling` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "public"."VendorBilling" DROP CONSTRAINT "VendorBilling_vendorId_fkey";

-- DropIndex
DROP INDEX "public"."VendorBilling_cui_idx";

-- DropIndex
DROP INDEX "public"."VendorBilling_email_idx";

-- DropIndex
DROP INDEX "public"."VendorBilling_vendorId_key";

-- AlterTable
ALTER TABLE "VendorBilling" DROP CONSTRAINT "VendorBilling_pkey",
DROP COLUMN "id",
ALTER COLUMN "companyName" SET NOT NULL,
ALTER COLUMN "companyName" SET DATA TYPE TEXT,
ALTER COLUMN "cui" SET NOT NULL,
ALTER COLUMN "cui" SET DATA TYPE TEXT,
ALTER COLUMN "regCom" SET NOT NULL,
ALTER COLUMN "regCom" SET DATA TYPE TEXT,
ALTER COLUMN "address" SET NOT NULL,
ALTER COLUMN "address" SET DATA TYPE TEXT,
ALTER COLUMN "iban" SET NOT NULL,
ALTER COLUMN "iban" SET DATA TYPE TEXT,
ALTER COLUMN "bank" SET NOT NULL,
ALTER COLUMN "bank" SET DATA TYPE TEXT,
ALTER COLUMN "email" SET NOT NULL,
ALTER COLUMN "email" SET DATA TYPE TEXT,
ALTER COLUMN "contactPerson" SET NOT NULL,
ALTER COLUMN "contactPerson" SET DATA TYPE TEXT,
ALTER COLUMN "phone" SET NOT NULL,
ALTER COLUMN "phone" SET DATA TYPE TEXT,
ALTER COLUMN "legalType" SET NOT NULL,
ALTER COLUMN "legalType" SET DATA TYPE TEXT,
ALTER COLUMN "vendorName" SET NOT NULL,
ALTER COLUMN "vendorName" SET DATA TYPE TEXT,
ADD CONSTRAINT "VendorBilling_pkey" PRIMARY KEY ("vendorId");

-- AddForeignKey
ALTER TABLE "VendorBilling" ADD CONSTRAINT "VendorBilling_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
