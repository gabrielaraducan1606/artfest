-- GPSR (Reg. UE 2023/988): date PUBLICE de contact ale producătorului, la nivel
-- de Vendor, folosite pentru toate produsele cu isOwnManufacturer = true.
-- Doar ADĂUGARE: 4 coloane nullable, fără backfill (nu se copiază nimic din
-- Vendor.address / ServiceProfile / VendorBilling / VendorPickupAddress).
-- Generat offline cu: prisma migrate diff --from-schema-datamodel <schema HEAD> --to-schema-datamodel prisma/schema.prisma --script

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "gpsrManufacturerAddress" VARCHAR(500),
ADD COLUMN     "gpsrManufacturerEmail" VARCHAR(320),
ADD COLUMN     "gpsrManufacturerName" VARCHAR(200),
ADD COLUMN     "gpsrManufacturerUpdatedAt" TIMESTAMP(3);
