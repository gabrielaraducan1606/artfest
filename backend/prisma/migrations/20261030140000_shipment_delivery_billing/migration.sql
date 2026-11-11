-- Transportul pe shipment: costul real al curierului, momentul reconcilierii,
-- suma refacturată vendorului și motivul tarifului de rezervă.
-- Aditivă: 4 coloane opționale, fără valori implicite -> rândurile existente rămân neschimbate.

-- AlterTable
ALTER TABLE "ShipmentDelivery"
  ADD COLUMN "carrierCost" DECIMAL(10,2),
  ADD COLUMN "carrierCostUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "vendorShippingCost" DECIMAL(10,2),
  ADD COLUMN "fallbackReason" VARCHAR(64);
