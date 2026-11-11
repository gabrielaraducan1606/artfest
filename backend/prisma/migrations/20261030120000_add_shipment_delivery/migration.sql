-- Livrarea aleasă la checkout, per shipment (Sameday: adresă / easybox / Sameday Point).
-- Aditivă: un enum + un tabel nou, relație 1-1 cu Shipment (ON DELETE CASCADE).

-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('HOME', 'LOCKER', 'PUDO');

-- CreateTable
CREATE TABLE "ShipmentDelivery" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "courierProvider" VARCHAR(32) NOT NULL,
    "method" "DeliveryMethod" NOT NULL,
    "serviceId" VARCHAR(32),
    "shippingCost" DECIMAL(10,2) NOT NULL,
    "pricingSource" VARCHAR(32) NOT NULL,
    "recipientName" VARCHAR(160),
    "recipientPhone" VARCHAR(40),
    "recipientEmail" VARCHAR(320),
    "countyId" INTEGER,
    "countyName" VARCHAR(120),
    "cityId" INTEGER,
    "cityName" VARCHAR(160),
    "address" VARCHAR(500),
    "postalCode" VARCHAR(16),
    "oohId" INTEGER,
    "oohType" INTEGER,
    "oohName" VARCHAR(200),
    "oohAddress" VARCHAR(500),
    "oohCityName" VARCHAR(160),
    "oohCountyName" VARCHAR(120),
    "oohPostalCode" VARCHAR(16),
    "oohLat" DECIMAL(9,6),
    "oohLng" DECIMAL(9,6),
    "oohSchedule" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentDelivery_shipmentId_key" ON "ShipmentDelivery"("shipmentId");

-- CreateIndex
CREATE INDEX "ShipmentDelivery_method_idx" ON "ShipmentDelivery"("method");

-- CreateIndex
CREATE INDEX "ShipmentDelivery_oohId_idx" ON "ShipmentDelivery"("oohId");

-- AddForeignKey
ALTER TABLE "ShipmentDelivery" ADD CONSTRAINT "ShipmentDelivery_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

