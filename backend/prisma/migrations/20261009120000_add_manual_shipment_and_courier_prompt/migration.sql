-- Expediere fără integrare de curier (flux manual vendor) + preferința
-- „Continuă fără integrare” (dialogul „Nu ai conectat încă un curier”).
-- Strict aditiv: o coloană cu default false, o coloană nullable, fără backfill.

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "manualShipment" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "courierPromptDismissedAt" TIMESTAMP(3);
