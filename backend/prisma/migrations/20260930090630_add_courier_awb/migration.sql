-- CreateEnum
CREATE TYPE "CourierAwbStatus" AS ENUM ('REQUESTED', 'CREATED', 'FAILED', 'UNKNOWN', 'CANCELLED');

-- CreateTable
CREATE TABLE "CourierAwb" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "courierAccountId" TEXT,
    "provider" "CourierProvider" NOT NULL,
    "status" "CourierAwbStatus" NOT NULL DEFAULT 'REQUESTED',
    "activeShipmentId" TEXT,
    "idempotencyKey" VARCHAR(100) NOT NULL,
    "clientReference" VARCHAR(160) NOT NULL,
    "awbNumber" VARCHAR(120),
    "courierService" VARCHAR(120),
    "parcels" JSONB,
    "weightKg" DECIMAL(7,2),
    "codAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "providerMeta" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierAwb_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourierAwb_activeShipmentId_key" ON "CourierAwb"("activeShipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "CourierAwb_idempotencyKey_key" ON "CourierAwb"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CourierAwb_shipmentId_createdAt_idx" ON "CourierAwb"("shipmentId", "createdAt");

-- CreateIndex
CREATE INDEX "CourierAwb_courierAccountId_idx" ON "CourierAwb"("courierAccountId");

-- CreateIndex
CREATE INDEX "CourierAwb_status_updatedAt_idx" ON "CourierAwb"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CourierAwb_provider_awbNumber_key" ON "CourierAwb"("provider", "awbNumber");

-- AddForeignKey
ALTER TABLE "CourierAwb" ADD CONSTRAINT "CourierAwb_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierAwb" ADD CONSTRAINT "CourierAwb_courierAccountId_fkey" FOREIGN KEY ("courierAccountId") REFERENCES "CourierAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
