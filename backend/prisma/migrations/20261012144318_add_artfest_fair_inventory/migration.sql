-- CreateEnum
CREATE TYPE "ArtfestInventoryStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'RECEIVED', 'REJECTED', 'CANCELLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ArtfestStockMovementType" AS ENUM ('RECEIVED', 'REJECTED', 'REJECTED_RETURNED_TO_VENDOR', 'SOLD', 'SALE_REVERSED', 'DAMAGED', 'LOST', 'RETURNED_TO_VENDOR', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT');

-- CreateEnum
CREATE TYPE "ArtfestOnlineReservationMode" AS ENUM ('NONE', 'TRANSFERRED', 'FORCED_UNAVAILABLE');

-- CreateEnum
CREATE TYPE "ArtfestInventoryEventType" AS ENUM ('CREATED', 'UPDATED', 'SUBMITTED', 'CANCELLED', 'STATUS_CHANGED', 'PRICE_SYNCED', 'LABEL_GENERATED', 'ONLINE_STOCK_RESERVED', 'ONLINE_STOCK_RELEASED', 'ONLINE_RESTORE_DEFERRED', 'VENDOR_RETURN_CONFIRMED', 'ONLINE_STOCK_RESTORED', 'ONLINE_RESTORE_SKIPPED', 'SALE_BLOCKED', 'SALE_UNBLOCKED', 'ADMIN_NOTE');

-- AlterTable
ALTER TABLE "ArtfestFair" ADD COLUMN     "commissionBps" INTEGER NOT NULL DEFAULT 1000,
ADD COLUMN     "inventoryDeadlineAt" TIMESTAMP(3),
ADD COLUMN     "salesOpen" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ArtfestFairInventoryItem" (
    "id" TEXT NOT NULL,
    "fairId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "productId" TEXT,
    "variantKey" VARCHAR(64) NOT NULL,
    "variantLabel" VARCHAR(200),
    "variantSnapshot" JSONB,
    "titleSnapshot" VARCHAR(200) NOT NULL,
    "storeNameSnapshot" VARCHAR(160),
    "imageUrlSnapshot" TEXT,
    "priceSnapshotCents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'RON',
    "priceSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "barcode" VARCHAR(10) NOT NULL,
    "labelPriceCents" INTEGER,
    "labelGeneratedAt" TIMESTAMP(3),
    "declaredQty" INTEGER NOT NULL,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "rejectedQty" INTEGER NOT NULL DEFAULT 0,
    "rejectedReturnedQty" INTEGER NOT NULL DEFAULT 0,
    "soldQty" INTEGER NOT NULL DEFAULT 0,
    "damagedQty" INTEGER NOT NULL DEFAULT 0,
    "lostQty" INTEGER NOT NULL DEFAULT 0,
    "returnedQty" INTEGER NOT NULL DEFAULT 0,
    "availableQty" INTEGER NOT NULL DEFAULT 0,
    "status" "ArtfestInventoryStatus" NOT NULL DEFAULT 'DRAFT',
    "isFragile" BOOLEAN NOT NULL DEFAULT false,
    "isUnique" BOOLEAN NOT NULL DEFAULT false,
    "isLimitedEdition" BOOLEAN NOT NULL DEFAULT false,
    "canBeRemade" BOOLEAN NOT NULL DEFAULT false,
    "handlingInstructions" TEXT,
    "vendorNotes" TEXT,
    "adminNotes" TEXT,
    "onlineReservationMode" "ArtfestOnlineReservationMode" NOT NULL DEFAULT 'NONE',
    "onlineReservedAt" TIMESTAMP(3),
    "onlineReservedQty" INTEGER NOT NULL DEFAULT 0,
    "onlineReleasedQty" INTEGER NOT NULL DEFAULT 0,
    "onlineReleasedAt" TIMESTAMP(3),
    "onlinePrevAvailability" "ProductAvailability",
    "onlinePrevReadyQty" INTEGER,
    "onlineDeferredRestoreQty" INTEGER NOT NULL DEFAULT 0,
    "vendorReturnConfirmedAt" TIMESTAMP(3),
    "vendorReturnConfirmedById" TEXT,
    "vendorReturnReceivedQty" INTEGER,
    "onlineRestoredQty" INTEGER NOT NULL DEFAULT 0,
    "onlineRestoredAt" TIMESTAMP(3),
    "saleBlockedAt" TIMESTAMP(3),
    "saleBlockedReason" TEXT,
    "saleBlockedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "receivedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtfestFairInventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtfestFairStockMovement" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "fairId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "type" "ArtfestStockMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,
    "photoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "actorUserId" TEXT,
    "saleLineId" TEXT,
    "idempotencyKey" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtfestFairStockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtfestFairInventoryEvent" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "fairId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "type" "ArtfestInventoryEventType" NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "note" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtfestFairInventoryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArtfestFairInventoryItem_barcode_key" ON "ArtfestFairInventoryItem"("barcode");

-- CreateIndex
CREATE INDEX "ArtfestFairInventoryItem_fairId_status_idx" ON "ArtfestFairInventoryItem"("fairId", "status");

-- CreateIndex
CREATE INDEX "ArtfestFairInventoryItem_fairId_vendorId_status_idx" ON "ArtfestFairInventoryItem"("fairId", "vendorId", "status");

-- CreateIndex
CREATE INDEX "ArtfestFairInventoryItem_productId_status_idx" ON "ArtfestFairInventoryItem"("productId", "status");

-- CreateIndex
CREATE INDEX "ArtfestFairInventoryItem_productId_onlineReservationMode_idx" ON "ArtfestFairInventoryItem"("productId", "onlineReservationMode");

-- CreateIndex
CREATE INDEX "ArtfestFairInventoryItem_saleBlockedAt_idx" ON "ArtfestFairInventoryItem"("saleBlockedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ArtfestFairInventoryItem_registrationId_productId_variantKe_key" ON "ArtfestFairInventoryItem"("registrationId", "productId", "variantKey");

-- CreateIndex
CREATE UNIQUE INDEX "ArtfestFairStockMovement_idempotencyKey_key" ON "ArtfestFairStockMovement"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ArtfestFairStockMovement_inventoryItemId_createdAt_idx" ON "ArtfestFairStockMovement"("inventoryItemId", "createdAt");

-- CreateIndex
CREATE INDEX "ArtfestFairStockMovement_fairId_type_createdAt_idx" ON "ArtfestFairStockMovement"("fairId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "ArtfestFairStockMovement_vendorId_createdAt_idx" ON "ArtfestFairStockMovement"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "ArtfestFairStockMovement_saleLineId_idx" ON "ArtfestFairStockMovement"("saleLineId");

-- CreateIndex
CREATE INDEX "ArtfestFairInventoryEvent_inventoryItemId_createdAt_idx" ON "ArtfestFairInventoryEvent"("inventoryItemId", "createdAt");

-- CreateIndex
CREATE INDEX "ArtfestFairInventoryEvent_fairId_type_createdAt_idx" ON "ArtfestFairInventoryEvent"("fairId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "ArtfestFairInventoryEvent_vendorId_createdAt_idx" ON "ArtfestFairInventoryEvent"("vendorId", "createdAt");

-- AddForeignKey
ALTER TABLE "ArtfestFairInventoryItem" ADD CONSTRAINT "ArtfestFairInventoryItem_fairId_fkey" FOREIGN KEY ("fairId") REFERENCES "ArtfestFair"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairInventoryItem" ADD CONSTRAINT "ArtfestFairInventoryItem_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "ArtfestFairRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairInventoryItem" ADD CONSTRAINT "ArtfestFairInventoryItem_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairInventoryItem" ADD CONSTRAINT "ArtfestFairInventoryItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairInventoryItem" ADD CONSTRAINT "ArtfestFairInventoryItem_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairInventoryItem" ADD CONSTRAINT "ArtfestFairInventoryItem_vendorReturnConfirmedById_fkey" FOREIGN KEY ("vendorReturnConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairInventoryItem" ADD CONSTRAINT "ArtfestFairInventoryItem_saleBlockedById_fkey" FOREIGN KEY ("saleBlockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairStockMovement" ADD CONSTRAINT "ArtfestFairStockMovement_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "ArtfestFairInventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairStockMovement" ADD CONSTRAINT "ArtfestFairStockMovement_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairInventoryEvent" ADD CONSTRAINT "ArtfestFairInventoryEvent_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "ArtfestFairInventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairInventoryEvent" ADD CONSTRAINT "ArtfestFairInventoryEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =====================================================================
-- CHECK constraints (adăugate manual; Prisma nu le poate exprima în schema)
-- Invariantele inventarului de târg: cantități, formula stocului,
-- cod de bare, unicat, rezervarea online, blocarea de la vânzare.
-- =====================================================================

-- ArtfestFair
ALTER TABLE "ArtfestFair"
  ADD CONSTRAINT "ArtfestFair_commissionBps_chk"
    CHECK ("commissionBps" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "ArtfestFair_inventoryDeadline_chk"
    CHECK (
      "inventoryDeadlineAt" IS NULL
      OR "endsAt" IS NULL
      OR "inventoryDeadlineAt" <= "endsAt"
    );

-- ArtfestFairInventoryItem
ALTER TABLE "ArtfestFairInventoryItem"
  ADD CONSTRAINT "AFII_declaredQty_chk"
    CHECK ("declaredQty" >= 1),
  ADD CONSTRAINT "AFII_qty_nonneg_chk"
    CHECK (
      "receivedQty" >= 0 AND "rejectedQty" >= 0 AND "rejectedReturnedQty" >= 0
      AND "soldQty" >= 0 AND "damagedQty" >= 0 AND "lostQty" >= 0 AND "returnedQty" >= 0
    ),
  ADD CONSTRAINT "AFII_availableQty_formula_chk"
    CHECK ("availableQty" = "receivedQty" - "soldQty" - "damagedQty" - "lostQty" - "returnedQty"),
  ADD CONSTRAINT "AFII_availableQty_nonneg_chk"
    CHECK ("availableQty" >= 0),
  ADD CONSTRAINT "AFII_rejectedReturned_chk"
    CHECK ("rejectedReturnedQty" <= "rejectedQty"),
  ADD CONSTRAINT "AFII_price_chk"
    CHECK ("priceSnapshotCents" > 0),
  ADD CONSTRAINT "AFII_labelPrice_chk"
    CHECK ("labelPriceCents" IS NULL OR "labelPriceCents" > 0),
  ADD CONSTRAINT "AFII_barcode_format_chk"
    CHECK ("barcode" ~ '^AF[2-9ABCDEFGHJKMNPQRSTVWX]{8}$'),
  ADD CONSTRAINT "AFII_unique_item_chk"
    CHECK ("isUnique" = false OR ("declaredQty" = 1 AND "canBeRemade" = false)),
  -- rezervarea online
  ADD CONSTRAINT "AFII_online_nonneg_chk"
    CHECK (
      "onlineReservedQty" >= 0 AND "onlineReleasedQty" >= 0
      AND "onlineDeferredRestoreQty" >= 0 AND "onlineRestoredQty" >= 0
    ),
  ADD CONSTRAINT "AFII_onlineReleased_chk"
    CHECK ("onlineReleasedQty" <= "onlineReservedQty"),
  ADD CONSTRAINT "AFII_onlineReserved_chk"
    CHECK ("onlineReservedQty" <= "declaredQty"),
  ADD CONSTRAINT "AFII_onlinePrevReadyQty_chk"
    CHECK ("onlinePrevReadyQty" IS NULL OR "onlinePrevReadyQty" >= 0),
  ADD CONSTRAINT "AFII_online_mode_chk"
    CHECK (
      ("onlineReservationMode" = 'NONE' AND "onlineReservedQty" = 0)
      OR ("onlineReservationMode" = 'TRANSFERRED' AND "onlineReservedQty" >= 1)
      OR ("onlineReservationMode" = 'FORCED_UNAVAILABLE' AND "onlineReservedQty" = 0
          AND "onlinePrevAvailability" IS NOT NULL)
    ),
  -- returul confirmat de vendor
  ADD CONSTRAINT "AFII_vendorReturnQty_chk"
    CHECK ("vendorReturnReceivedQty" IS NULL OR "vendorReturnReceivedQty" >= 0),
  ADD CONSTRAINT "AFII_onlineRestored_chk"
    CHECK ("onlineRestoredQty" <= COALESCE("vendorReturnReceivedQty", 0)),
  -- înainte de recepție nu pot exista cantități primite / refuzate / vândute
  ADD CONSTRAINT "AFII_preReception_qty_chk"
    CHECK (
      "status" NOT IN ('DRAFT', 'SUBMITTED', 'CANCELLED')
      OR ("receivedQty" = 0 AND "rejectedQty" = 0 AND "soldQty" = 0)
    ),
  -- blocarea de la vânzare cere motiv
  ADD CONSTRAINT "AFII_saleBlocked_reason_chk"
    CHECK (
      "saleBlockedAt" IS NULL
      OR ("saleBlockedReason" IS NOT NULL AND length(btrim("saleBlockedReason")) > 0)
    ),
  ADD CONSTRAINT "AFII_variantKey_chk"
    CHECK (length(btrim("variantKey")) > 0),
  ADD CONSTRAINT "AFII_title_chk"
    CHECK (length(btrim("titleSnapshot")) > 0),
  ADD CONSTRAINT "AFII_currency_chk"
    CHECK ("currency" ~ '^[A-Z]{3}$');

-- ArtfestFairStockMovement
ALTER TABLE "ArtfestFairStockMovement"
  ADD CONSTRAINT "AFSM_quantity_chk"
    CHECK ("quantity" > 0),
  ADD CONSTRAINT "AFSM_reason_chk"
    CHECK (
      "type" NOT IN ('REJECTED', 'DAMAGED', 'LOST', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'SALE_REVERSED')
      OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0)
    );
