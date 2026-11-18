-- Etapa 1 Sameday prin Artfest: fundația financiară. DOAR adăugiri.
-- Toate coloanele noi sunt opționale (NULL pe toate rândurile existente);
-- nu se modifică / completează nicio dată existentă. NULL = comportamentul de dinainte.

-- CreateEnum
CREATE TYPE "ShipmentFulfillment" AS ENUM ('ARTFEST_SAMEDAY', 'VENDOR_COURIER');

-- AlterTable: proprietarul economic al transportului (null = comenzile existente)
ALTER TABLE "Shipment" ADD COLUMN "fulfillment" "ShipmentFulfillment";

-- AlterTable: opt-in Sameday pe magazin (inactiv implicit)
ALTER TABLE "VendorService" ADD COLUMN "samedayOptInAt" TIMESTAMP(3),
ADD COLUMN "samedayOptInById" TEXT,
ADD COLUMN "samedayDisabledAt" TIMESTAMP(3),
ADD COLUMN "samedayDisabledById" TEXT;

-- AlterTable: evidența separată a costului curierului (estimare / raportat la AWB / final)
ALTER TABLE "ShipmentDelivery" ADD COLUMN "carrierCostAwbReported" DECIMAL(10,2),
ADD COLUMN "carrierCostFinal" DECIMAL(10,2),
ADD COLUMN "carrierCostFinalSource" VARCHAR(32),
ADD COLUMN "carrierCostFinalAt" TIMESTAMP(3);
