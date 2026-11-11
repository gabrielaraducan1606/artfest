-- Retururi Sameday - fundația de date (fără AWB de retur încă):
--   ReturnRequest: metoda returului + cine suportă transportul (decizie explicită,
--   cine și când a decis); ShipmentDelivery (Shipment RETURN): partea Artfest din
--   costul curierului + termenul Easybox Return.
-- Strict aditivă: 2 enum-uri noi, 6 coloane opționale FĂRĂ valori implicite, un index,
-- o cheie străină (ON DELETE SET NULL). Rândurile existente rămân neschimbate (null).

-- CreateEnum
CREATE TYPE "ReturnMethod" AS ENUM ('HOME_PICKUP', 'EASYBOX', 'CUSTOMER_SELF');

-- CreateEnum
CREATE TYPE "ReturnCostBearer" AS ENUM ('VENDOR', 'CUSTOMER', 'ARTFEST', 'SPLIT');

-- AlterTable
ALTER TABLE "ReturnRequest" ADD COLUMN     "costBearer" "ReturnCostBearer",
ADD COLUMN     "costDecidedAt" TIMESTAMP(3),
ADD COLUMN     "costDecidedById" TEXT,
ADD COLUMN     "returnMethod" "ReturnMethod";

-- AlterTable
ALTER TABLE "ShipmentDelivery" ADD COLUMN     "artfestSubsidyAmount" DECIMAL(10,2),
ADD COLUMN     "eligibleUntil" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ReturnRequest_costDecidedById_idx" ON "ReturnRequest"("costDecidedById");

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_costDecidedById_fkey" FOREIGN KEY ("costDecidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

