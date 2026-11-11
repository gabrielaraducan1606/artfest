-- =====================================================================
-- Inventar pe variante + import / sincronizare din magazine externe
-- (WooCommerce, Shopify, easySales) - ETAPA 1: doar schema.
--
-- Strict aditivă: tipuri, tabele, coloane, indecși, FK-uri și CHECK-uri noi.
-- Fără backfill și fără modificări de date existente:
--   - Product.stockScope primește DEFAULT 'PRODUCT' (comportamentul de acum:
--     readyQty, null = stoc neurmărit); Product.variantPoolQty e nullable;
--   - ShipmentItem.variantIdSnapshot și ProductImport.connectionId sunt nullable.
-- ADD COLUMN cu DEFAULT constant nu rescrie tabelul Product (Postgres >= 11).
-- CHECK-urile sunt doar pe coloane / tabele NOI, deci rândurile existente
-- le respectă din start.
-- =====================================================================

-- CreateEnum
CREATE TYPE "ProductStockScope" AS ENUM ('PRODUCT', 'VARIANT');

-- CreateEnum
CREATE TYPE "ProductVariantStockMode" AS ENUM ('OWN', 'PRODUCT_POOL', 'UNTRACKED');

-- CreateEnum
CREATE TYPE "ProductVariantOrigin" AS ENUM ('MANUAL', 'EXTERNAL', 'AI_CONFIRMED');

-- CreateEnum
CREATE TYPE "InventoryStockTarget" AS ENUM ('PRODUCT', 'VARIANT', 'VARIANT_POOL');

-- CreateEnum
CREATE TYPE "InventoryMovementReason" AS ENUM ('ORDER_PLACED', 'ORDER_CANCELLED', 'PAYMENT_EXPIRED', 'RETURN_RESTOCK', 'EXTERNAL_SYNC', 'RECONCILE', 'MANUAL_ADJUST', 'IMPORT', 'FAIR');

-- CreateEnum
CREATE TYPE "ExternalPlatform" AS ENUM ('WOOCOMMERCE', 'SHOPIFY', 'EASYSALES');

-- CreateEnum
CREATE TYPE "ExternalConnectionStatus" AS ENUM ('PENDING', 'ACTIVE', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "ExternalStockMaster" AS ENUM ('EXTERNAL', 'ARTFEST');

-- CreateEnum
CREATE TYPE "ExternalProductLinkStatus" AS ENUM ('ACTIVE', 'UNLINKED', 'EXTERNAL_DELETED');

-- CreateEnum
CREATE TYPE "ExternalStockManagedAt" AS ENUM ('VARIANT', 'PARENT', 'NONE');

-- CreateEnum
CREATE TYPE "ExternalSyncJobType" AS ENUM ('IMPORT_PRODUCTS', 'PULL_STOCK', 'PUSH_STOCK', 'PROCESS_WEBHOOK', 'RECONCILE', 'REGISTER_WEBHOOKS');

-- CreateEnum
CREATE TYPE "ExternalSyncJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'DEAD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExternalWebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "stockScope" "ProductStockScope" NOT NULL DEFAULT 'PRODUCT',
ADD COLUMN     "variantPoolQty" INTEGER;

-- AlterTable
ALTER TABLE "ShipmentItem" ADD COLUMN     "variantIdSnapshot" TEXT;

-- AlterTable
ALTER TABLE "ProductImport" ADD COLUMN     "connectionId" TEXT;

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "combinationKey" VARCHAR(1000) NOT NULL,
    "selections" JSONB NOT NULL,
    "label" VARCHAR(255),
    "sku" VARCHAR(100),
    "stockMode" "ProductVariantStockMode" NOT NULL DEFAULT 'OWN',
    "stockQty" INTEGER,
    "availability" "ProductAvailability",
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "origin" "ProductVariantOrigin" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "target" "InventoryStockTarget" NOT NULL,
    "delta" INTEGER NOT NULL,
    "qtyBefore" INTEGER,
    "qtyAfter" INTEGER,
    "reason" "InventoryMovementReason" NOT NULL,
    "idempotencyKey" VARCHAR(191) NOT NULL,
    "orderId" TEXT,
    "shipmentId" TEXT,
    "shipmentItemId" TEXT,
    "connectionId" TEXT,
    "externalEventId" TEXT,
    "actorUserId" TEXT,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalStoreConnection" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "platform" "ExternalPlatform" NOT NULL,
    "label" VARCHAR(120),
    "shopUrl" VARCHAR(500) NOT NULL,
    "activeShopKey" VARCHAR(500),
    "status" "ExternalConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "credentialsCipher" BYTEA NOT NULL,
    "credentialsKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "credentialsHint" VARCHAR(160),
    "webhookSecretCipher" BYTEA,
    "webhookSecretKeyVersion" INTEGER,
    "stockMaster" "ExternalStockMaster" NOT NULL DEFAULT 'EXTERNAL',
    "syncStock" BOOLEAN NOT NULL DEFAULT true,
    "syncPrice" BOOLEAN NOT NULL DEFAULT false,
    "syncContent" BOOLEAN NOT NULL DEFAULT false,
    "safetyBufferQty" INTEGER NOT NULL DEFAULT 0,
    "isPaused" BOOLEAN NOT NULL DEFAULT false,
    "pausedAt" TIMESTAMP(3),
    "connectedByUserId" TEXT,
    "lastTestedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorCode" VARCHAR(64),
    "lastErrorMessage" VARCHAR(1000),
    "disconnectedAt" TIMESTAMP(3),
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalStoreConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalProductLink" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "externalProductId" VARCHAR(64) NOT NULL,
    "externalType" VARCHAR(32),
    "externalSku" VARCHAR(100),
    "status" "ExternalProductLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "syncContent" BOOLEAN,
    "syncPrice" BOOLEAN,
    "externalContentHash" VARCHAR(64),
    "externalModifiedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalProductLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalVariantLink" (
    "id" TEXT NOT NULL,
    "productLinkId" TEXT NOT NULL,
    "variantId" TEXT,
    "externalVariantId" VARCHAR(64) NOT NULL DEFAULT '',
    "externalSku" VARCHAR(100),
    "stockManagedAt" "ExternalStockManagedAt" NOT NULL DEFAULT 'VARIANT',
    "lastExternalStock" INTEGER,
    "lastExternalStockStatus" VARCHAR(32),
    "lastExternalSeenAt" TIMESTAMP(3),
    "lastPushedStock" INTEGER,
    "lastPushedAt" TIMESTAMP(3),
    "pendingOutboundDelta" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalVariantLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalSyncJob" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "type" "ExternalSyncJobType" NOT NULL,
    "status" "ExternalSyncJobStatus" NOT NULL DEFAULT 'QUEUED',
    "payload" JSONB,
    "dedupeKey" VARCHAR(191),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" VARCHAR(100),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lastErrorCode" VARCHAR(64),
    "lastErrorMessage" VARCHAR(1000),
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalSyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalWebhookEvent" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "deliveryKey" VARCHAR(191) NOT NULL,
    "topic" VARCHAR(100) NOT NULL,
    "resourceId" VARCHAR(64),
    "payloadHash" VARCHAR(64) NOT NULL,
    "payload" JSONB,
    "status" "ExternalWebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "errorMessage" VARCHAR(1000),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "ExternalWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductVariant_productId_isActive_idx" ON "ProductVariant"("productId", "isActive");

-- CreateIndex
CREATE INDEX "ProductVariant_sku_idx" ON "ProductVariant"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_combinationKey_key" ON "ProductVariant"("productId", "combinationKey");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovement_idempotencyKey_key" ON "InventoryMovement"("idempotencyKey");

-- CreateIndex
CREATE INDEX "InventoryMovement_productId_createdAt_idx" ON "InventoryMovement"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_variantId_createdAt_idx" ON "InventoryMovement"("variantId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_orderId_idx" ON "InventoryMovement"("orderId");

-- CreateIndex
CREATE INDEX "InventoryMovement_shipmentItemId_idx" ON "InventoryMovement"("shipmentItemId");

-- CreateIndex
CREATE INDEX "InventoryMovement_connectionId_createdAt_idx" ON "InventoryMovement"("connectionId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_reason_createdAt_idx" ON "InventoryMovement"("reason", "createdAt");

-- CreateIndex
CREATE INDEX "ExternalStoreConnection_vendorId_platform_idx" ON "ExternalStoreConnection"("vendorId", "platform");

-- CreateIndex
CREATE INDEX "ExternalStoreConnection_status_isPaused_idx" ON "ExternalStoreConnection"("status", "isPaused");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalStoreConnection_platform_activeShopKey_key" ON "ExternalStoreConnection"("platform", "activeShopKey");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalProductLink_productId_key" ON "ExternalProductLink"("productId");

-- CreateIndex
CREATE INDEX "ExternalProductLink_connectionId_status_idx" ON "ExternalProductLink"("connectionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalProductLink_connectionId_externalProductId_key" ON "ExternalProductLink"("connectionId", "externalProductId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalVariantLink_variantId_key" ON "ExternalVariantLink"("variantId");

-- CreateIndex
CREATE INDEX "ExternalVariantLink_externalVariantId_idx" ON "ExternalVariantLink"("externalVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalVariantLink_productLinkId_externalVariantId_key" ON "ExternalVariantLink"("productLinkId", "externalVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalSyncJob_dedupeKey_key" ON "ExternalSyncJob"("dedupeKey");

-- CreateIndex
CREATE INDEX "ExternalSyncJob_status_runAfter_priority_idx" ON "ExternalSyncJob"("status", "runAfter", "priority");

-- CreateIndex
CREATE INDEX "ExternalSyncJob_connectionId_status_createdAt_idx" ON "ExternalSyncJob"("connectionId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ExternalSyncJob_connectionId_type_createdAt_idx" ON "ExternalSyncJob"("connectionId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "ExternalWebhookEvent_connectionId_receivedAt_idx" ON "ExternalWebhookEvent"("connectionId", "receivedAt");

-- CreateIndex
CREATE INDEX "ExternalWebhookEvent_status_receivedAt_idx" ON "ExternalWebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalWebhookEvent_connectionId_deliveryKey_key" ON "ExternalWebhookEvent"("connectionId", "deliveryKey");

-- CreateIndex
CREATE INDEX "ShipmentItem_variantIdSnapshot_idx" ON "ShipmentItem"("variantIdSnapshot");

-- CreateIndex
CREATE INDEX "ProductImport_connectionId_createdAt_idx" ON "ProductImport"("connectionId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProductImport" ADD CONSTRAINT "ProductImport_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ExternalStoreConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ExternalStoreConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalStoreConnection" ADD CONSTRAINT "ExternalStoreConnection_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalProductLink" ADD CONSTRAINT "ExternalProductLink_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ExternalStoreConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalProductLink" ADD CONSTRAINT "ExternalProductLink_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalVariantLink" ADD CONSTRAINT "ExternalVariantLink_productLinkId_fkey" FOREIGN KEY ("productLinkId") REFERENCES "ExternalProductLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalVariantLink" ADD CONSTRAINT "ExternalVariantLink_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSyncJob" ADD CONSTRAINT "ExternalSyncJob_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ExternalStoreConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalWebhookEvent" ADD CONSTRAINT "ExternalWebhookEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ExternalStoreConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =====================================================================
-- CHECK-uri (Prisma nu le exprimă în schema.prisma)
-- =====================================================================

-- Product: stocul comun al variantelor există doar la stockScope = VARIANT;
-- stocul pe variante nu se combină cu QUOTE_ONLY (ofertele nu au stoc)
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_variantPoolQty_chk"
    CHECK ("variantPoolQty" IS NULL OR "variantPoolQty" >= 0),
  ADD CONSTRAINT "Product_variantPool_scope_chk"
    CHECK ("stockScope" = 'VARIANT' OR "variantPoolQty" IS NULL),
  ADD CONSTRAINT "Product_variantScope_orderMode_chk"
    CHECK ("stockScope" <> 'VARIANT' OR "orderMode" <> 'QUOTE_ONLY');

-- ProductVariant: OWN are mereu stoc propriu >= 0; PRODUCT_POOL / UNTRACKED nu au
ALTER TABLE "ProductVariant"
  ADD CONSTRAINT "ProductVariant_stock_mode_chk"
    CHECK (
      ("stockMode" = 'OWN' AND "stockQty" IS NOT NULL AND "stockQty" >= 0)
      OR ("stockMode" <> 'OWN' AND "stockQty" IS NULL)
    ),
  ADD CONSTRAINT "ProductVariant_combinationKey_chk"
    CHECK (char_length(btrim("combinationKey")) > 0);

-- InventoryMovement: nicio mișcare zero; stocul rezultat nu e negativ;
-- mișcarea pe produs nu are variantă
ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_delta_chk"
    CHECK ("delta" <> 0),
  ADD CONSTRAINT "InventoryMovement_qtyAfter_chk"
    CHECK ("qtyAfter" IS NULL OR "qtyAfter" >= 0),
  ADD CONSTRAINT "InventoryMovement_product_target_chk"
    CHECK ("target" <> 'PRODUCT' OR "variantId" IS NULL),
  ADD CONSTRAINT "InventoryMovement_idempotencyKey_chk"
    CHECK (char_length(btrim("idempotencyKey")) > 0);

-- ExternalStoreConnection: activeShopKey există exact cât timp conexiunea
-- nu e DISCONNECTED (unicitatea pe magazin se eliberează la deconectare)
ALTER TABLE "ExternalStoreConnection"
  ADD CONSTRAINT "ExternalStoreConnection_activeShopKey_chk"
    CHECK (
      ("status" = 'DISCONNECTED' AND "activeShopKey" IS NULL)
      OR ("status" <> 'DISCONNECTED' AND "activeShopKey" IS NOT NULL
          AND char_length(btrim("activeShopKey")) > 0)
    ),
  ADD CONSTRAINT "ExternalStoreConnection_safetyBuffer_chk"
    CHECK ("safetyBufferQty" >= 0);

-- ExternalVariantLink: produsul simplu (externalVariantId = '') nu are
-- variantă Artfest și nu poate folosi „stocul părintelui”
ALTER TABLE "ExternalVariantLink"
  ADD CONSTRAINT "ExternalVariantLink_simple_product_chk"
    CHECK (
      "externalVariantId" <> ''
      OR ("variantId" IS NULL AND "stockManagedAt" <> 'PARENT')
    );

-- ExternalSyncJob: cheia de deduplicare doar pe joburile active
ALTER TABLE "ExternalSyncJob"
  ADD CONSTRAINT "ExternalSyncJob_dedupe_active_chk"
    CHECK ("status" IN ('QUEUED', 'RUNNING') OR "dedupeKey" IS NULL),
  ADD CONSTRAINT "ExternalSyncJob_attempts_chk"
    CHECK ("attempts" >= 0 AND "maxAttempts" >= 1);

-- =====================================================================
-- Coerența variantă <-> produs (triggere)
--
-- Prisma nu poate exprima un FK compus (variantId, productId) cu variantId
-- opțional, iar un FK scris doar în SQL ar apărea ca drift la următoarea
-- migrație. Triggerele nu sunt urmărite de Prisma, deci nu produc drift.
-- Reguli:
--   - o variantă nu se mută pe alt produs (productId imuabil);
--   - legătura externă a unei variante aparține aceluiași produs ca
--     legătura externă a produsului;
--   - o mișcare de stoc pe variantă are variantId-ul produsului ei și,
--     la creare, variantă obligatorie pentru țintele VARIANT / VARIANT_POOL
--     (după ștergerea variantei rămâne null, prin ON DELETE SET NULL);
--   - snapshot-ul de variantă de pe o linie de comandă nouă aparține
--     produsului liniei (doar la INSERT și doar când e completat - liniile
--     existente și cele fără variantă nu sunt afectate).
-- Erorile folosesc codul 23514 (check_violation), ca CHECK-urile, iar mesajul
-- începe cu numele regulii (vizibil și prin Prisma, care nu transmite CONSTRAINT).
-- =====================================================================

CREATE FUNCTION "artfest_inv_variant_product_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."productId" IS DISTINCT FROM OLD."productId" THEN
    RAISE EXCEPTION '%_productId_immutable_chk: % % - productId nu se poate schimba', TG_TABLE_NAME, TG_TABLE_NAME, OLD."id"
      USING ERRCODE = '23514', CONSTRAINT = TG_TABLE_NAME || '_productId_immutable_chk';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "ProductVariant_productId_immutable"
  BEFORE UPDATE OF "productId" ON "ProductVariant"
  FOR EACH ROW EXECUTE FUNCTION "artfest_inv_variant_product_immutable"();

CREATE TRIGGER "ExternalProductLink_productId_immutable"
  BEFORE UPDATE OF "productId" ON "ExternalProductLink"
  FOR EACH ROW EXECUTE FUNCTION "artfest_inv_variant_product_immutable"();

CREATE FUNCTION "artfest_inv_external_variant_link_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."variantId" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "ProductVariant" v
    JOIN "ExternalProductLink" l ON l."productId" = v."productId"
    WHERE v."id" = NEW."variantId" AND l."id" = NEW."productLinkId"
  ) THEN
    RAISE EXCEPTION 'ExternalVariantLink_variant_product_chk: varianta % nu aparține produsului legăturii %', NEW."variantId", NEW."productLinkId"
      USING ERRCODE = '23514', CONSTRAINT = 'ExternalVariantLink_variant_product_chk';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "ExternalVariantLink_variant_product"
  BEFORE INSERT OR UPDATE OF "variantId", "productLinkId" ON "ExternalVariantLink"
  FOR EACH ROW EXECUTE FUNCTION "artfest_inv_external_variant_link_guard"();

CREATE FUNCTION "artfest_inv_movement_variant_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW."target" <> 'PRODUCT' AND NEW."variantId" IS NULL THEN
    RAISE EXCEPTION 'InventoryMovement_variant_required_chk: ținta % cere variantId', NEW."target"
      USING ERRCODE = '23514', CONSTRAINT = 'InventoryMovement_variant_required_chk';
  END IF;
  IF NEW."variantId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ProductVariant" v
    WHERE v."id" = NEW."variantId" AND v."productId" = NEW."productId"
  ) THEN
    RAISE EXCEPTION 'InventoryMovement_variant_product_chk: varianta % nu aparține produsului %', NEW."variantId", NEW."productId"
      USING ERRCODE = '23514', CONSTRAINT = 'InventoryMovement_variant_product_chk';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "InventoryMovement_variant_product"
  BEFORE INSERT OR UPDATE OF "variantId", "productId", "target" ON "InventoryMovement"
  FOR EACH ROW EXECUTE FUNCTION "artfest_inv_movement_variant_guard"();

CREATE FUNCTION "artfest_inv_shipment_item_variant_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "ProductVariant" v
    WHERE v."id" = NEW."variantIdSnapshot" AND v."productId" = NEW."productId"
  ) THEN
    RAISE EXCEPTION 'ShipmentItem_variant_product_chk: varianta % nu aparține produsului %', NEW."variantIdSnapshot", NEW."productId"
      USING ERRCODE = '23514', CONSTRAINT = 'ShipmentItem_variant_product_chk';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "ShipmentItem_variant_product"
  BEFORE INSERT ON "ShipmentItem"
  FOR EACH ROW
  WHEN (NEW."variantIdSnapshot" IS NOT NULL)
  EXECUTE FUNCTION "artfest_inv_shipment_item_variant_guard"();
