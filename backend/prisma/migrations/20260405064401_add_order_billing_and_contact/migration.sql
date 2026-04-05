-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "billingAddress" JSONB,
ADD COLUMN     "contactPerson" JSONB,
ADD COLUMN     "shipToDifferentAddress" BOOLEAN NOT NULL DEFAULT false;
