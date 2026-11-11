-- Sincronizarea statusurilor AWB (Sameday status-sync), FAZA 1: checkpoint per
-- cont de curier + flux și timeline-ul expedierii. Strict aditivă: un enum și
-- două tabele noi; nicio coloană existentă modificată.

-- CreateEnum
CREATE TYPE "CourierSyncFeed" AS ENUM ('STATUS_SYNC', 'XB_STATUS_SYNC');

-- CreateTable
CREATE TABLE "CourierStatusSyncCursor" (
    "id" TEXT NOT NULL,
    "courierAccountId" TEXT NOT NULL,
    "feed" "CourierSyncFeed" NOT NULL,
    "syncedUntil" TIMESTAMP(3) NOT NULL,
    "lockedUntil" TIMESTAMP(3),
    "lockedBy" VARCHAR(100),
    "lastRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorCode" VARCHAR(64),
    "failures" INTEGER NOT NULL DEFAULT 0,
    "nextRunAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierStatusSyncCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentTrackingEvent" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "courierAwbId" TEXT,
    "provider" "CourierProvider" NOT NULL,
    "parcelNumber" VARCHAR(120) NOT NULL,
    "statusId" INTEGER NOT NULL,
    "status" VARCHAR(120),
    "statusLabel" VARCHAR(255),
    "statusState" VARCHAR(120),
    "statusDateRaw" VARCHAR(64) NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "reasonId" INTEGER,
    "reason" VARCHAR(255),
    "inReturn" BOOLEAN NOT NULL DEFAULT false,
    "transitLocation" VARCHAR(255),
    "logisticLocationId" INTEGER,
    "logisticLocationName" VARCHAR(255),
    "oohId" INTEGER,
    "oohType" INTEGER,
    "lockerId" INTEGER,
    "mappedStatus" "ShipmentStatus",
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "dedupeKey" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentTrackingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourierStatusSyncCursor_courierAccountId_feed_key" ON "CourierStatusSyncCursor"("courierAccountId", "feed");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentTrackingEvent_dedupeKey_key" ON "ShipmentTrackingEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "ShipmentTrackingEvent_shipmentId_occurredAt_idx" ON "ShipmentTrackingEvent"("shipmentId", "occurredAt");

-- CreateIndex
CREATE INDEX "ShipmentTrackingEvent_courierAwbId_idx" ON "ShipmentTrackingEvent"("courierAwbId");

-- CreateIndex
CREATE INDEX "ShipmentTrackingEvent_parcelNumber_idx" ON "ShipmentTrackingEvent"("parcelNumber");

-- AddForeignKey
ALTER TABLE "CourierStatusSyncCursor" ADD CONSTRAINT "CourierStatusSyncCursor_courierAccountId_fkey" FOREIGN KEY ("courierAccountId") REFERENCES "CourierAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentTrackingEvent" ADD CONSTRAINT "ShipmentTrackingEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentTrackingEvent" ADD CONSTRAINT "ShipmentTrackingEvent_courierAwbId_fkey" FOREIGN KEY ("courierAwbId") REFERENCES "CourierAwb"("id") ON DELETE SET NULL ON UPDATE CASCADE;

