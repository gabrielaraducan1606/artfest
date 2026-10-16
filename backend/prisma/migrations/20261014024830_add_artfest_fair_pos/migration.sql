-- CreateEnum
CREATE TYPE "ArtfestSaleStatus" AS ENUM ('COMPLETED', 'VOIDED', 'PARTIALLY_RETURNED', 'RETURNED');

-- CreateEnum
CREATE TYPE "ArtfestPaymentMethod" AS ENUM ('CASH', 'CARD', 'MIXED');

-- CreateEnum
CREATE TYPE "ArtfestSaleReturnType" AS ENUM ('VOID', 'RETURN');

-- CreateEnum
CREATE TYPE "ArtfestReturnDisposition" AS ENUM ('RESTOCKED', 'NOT_RESTOCKED', 'NOT_RETURNED');

-- CreateEnum
CREATE TYPE "ArtfestDiscountType" AS ENUM ('PERCENT', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "ArtfestDiscountScope" AS ENUM ('INVENTORY_ITEM', 'VENDOR');

-- CreateEnum
CREATE TYPE "ArtfestDiscountFunding" AS ENUM ('VENDOR', 'ARTFEST');

-- CreateEnum
CREATE TYPE "ArtfestDiscountStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ArtfestSettlementKind" AS ENUM ('PERIODIC', 'FINAL');

-- CreateEnum
CREATE TYPE "ArtfestSettlementStatus" AS ENUM ('DRAFT', 'FINALIZED', 'PAID', 'CARRIED_FORWARD', 'CANCELLED');

-- AlterTable
ALTER TABLE "ArtfestFair" ADD COLUMN     "nextReturnNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "nextSaleNumber" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ArtfestFairStockMovement" ADD COLUMN     "saleReturnLineId" TEXT;

-- CreateTable
CREATE TABLE "ArtfestFairSale" (
    "id" TEXT NOT NULL,
    "fairId" TEXT NOT NULL,
    "saleNumber" INTEGER NOT NULL,
    "receiptReference" VARCHAR(20) NOT NULL,
    "status" "ArtfestSaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'RON',
    "listCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL,
    "totalPaidCents" INTEGER NOT NULL,
    "commissionCents" INTEGER NOT NULL,
    "vendorNetCents" INTEGER NOT NULL,
    "paymentMethod" "ArtfestPaymentMethod" NOT NULL,
    "cashCents" INTEGER,
    "cardCents" INTEGER,
    "idempotencyKey" VARCHAR(100) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "customerName" VARCHAR(160),
    "customerEmail" VARCHAR(320),
    "customerTaxId" VARCHAR(40),
    "fiscalReceiptRef" VARCHAR(80),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtfestFairSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtfestFairSaleLine" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "fairId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "productId" TEXT,
    "titleSnapshot" VARCHAR(200) NOT NULL,
    "variantLabel" VARCHAR(200),
    "variantSnapshot" JSONB,
    "barcodeSnapshot" VARCHAR(10) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "listUnitPriceCents" INTEGER NOT NULL,
    "lineListCents" INTEGER NOT NULL,
    "lineDiscountCents" INTEGER NOT NULL DEFAULT 0,
    "lineGrossCents" INTEGER NOT NULL,
    "effectiveUnitPriceCents" INTEGER NOT NULL,
    "commissionBps" INTEGER NOT NULL,
    "commissionCents" INTEGER NOT NULL,
    "commissionOnListCents" INTEGER NOT NULL,
    "vendorNetCents" INTEGER NOT NULL,
    "artfestFundedDiscountCents" INTEGER NOT NULL DEFAULT 0,
    "returnedQty" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtfestFairSaleLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtfestFairDiscount" (
    "id" TEXT NOT NULL,
    "fairId" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" "ArtfestDiscountType" NOT NULL,
    "percentBps" INTEGER,
    "amountCents" INTEGER,
    "scope" "ArtfestDiscountScope" NOT NULL,
    "inventoryItemId" TEXT,
    "vendorId" TEXT,
    "fundingSource" "ArtfestDiscountFunding" NOT NULL DEFAULT 'VENDOR',
    "status" "ArtfestDiscountStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtfestFairDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtfestFairSaleLineDiscount" (
    "id" TEXT NOT NULL,
    "saleLineId" TEXT NOT NULL,
    "discountId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "ArtfestFairSaleLineDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtfestFairSaleReturn" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "fairId" TEXT NOT NULL,
    "type" "ArtfestSaleReturnType" NOT NULL,
    "returnNumber" INTEGER NOT NULL,
    "reference" VARCHAR(20) NOT NULL,
    "reason" TEXT NOT NULL,
    "refundMethod" "ArtfestPaymentMethod" NOT NULL,
    "refundCents" INTEGER NOT NULL,
    "commissionReversedCents" INTEGER NOT NULL,
    "artfestFundedReversedCents" INTEGER NOT NULL DEFAULT 0,
    "vendorNetReversedCents" INTEGER NOT NULL,
    "idempotencyKey" VARCHAR(100) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtfestFairSaleReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtfestFairSaleReturnLine" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "saleLineId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "refundCents" INTEGER NOT NULL,
    "commissionReversedCents" INTEGER NOT NULL,
    "artfestFundedReversedCents" INTEGER NOT NULL DEFAULT 0,
    "vendorNetReversedCents" INTEGER NOT NULL,
    "disposition" "ArtfestReturnDisposition" NOT NULL,
    "conditionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtfestFairSaleReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtfestFairSettlement" (
    "id" TEXT NOT NULL,
    "fairId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" "ArtfestSettlementKind" NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "status" "ArtfestSettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'RON',
    "listSalesCents" INTEGER NOT NULL,
    "discountsCents" INTEGER NOT NULL,
    "grossSalesCents" INTEGER NOT NULL,
    "commissionCents" INTEGER NOT NULL,
    "vendorNetCents" INTEGER NOT NULL,
    "returnsRefundCents" INTEGER NOT NULL,
    "commissionReversedCents" INTEGER NOT NULL,
    "vendorNetReversedCents" INTEGER NOT NULL,
    "adjustmentsCents" INTEGER NOT NULL DEFAULT 0,
    "carriedInCents" INTEGER NOT NULL DEFAULT 0,
    "finalDueCents" INTEGER NOT NULL,
    "previousSettlementId" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "finalizedById" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "paymentReference" VARCHAR(120),
    "documentRef" VARCHAR(120),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtfestFairSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtfestFairSettlementEntry" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "saleLineId" TEXT,
    "returnLineId" TEXT,
    "grossCents" INTEGER NOT NULL,
    "commissionCents" INTEGER NOT NULL,
    "vendorNetCents" INTEGER NOT NULL,

    CONSTRAINT "ArtfestFairSettlementEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArtfestFairSale_receiptReference_key" ON "ArtfestFairSale"("receiptReference");

-- CreateIndex
CREATE UNIQUE INDEX "ArtfestFairSale_idempotencyKey_key" ON "ArtfestFairSale"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ArtfestFairSale_fairId_soldAt_idx" ON "ArtfestFairSale"("fairId", "soldAt");

-- CreateIndex
CREATE INDEX "ArtfestFairSale_fairId_status_idx" ON "ArtfestFairSale"("fairId", "status");

-- CreateIndex
CREATE INDEX "ArtfestFairSale_createdById_idx" ON "ArtfestFairSale"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "ArtfestFairSale_fairId_saleNumber_key" ON "ArtfestFairSale"("fairId", "saleNumber");

-- CreateIndex
CREATE INDEX "ArtfestFairSaleLine_fairId_vendorId_idx" ON "ArtfestFairSaleLine"("fairId", "vendorId");

-- CreateIndex
CREATE INDEX "ArtfestFairSaleLine_vendorId_createdAt_idx" ON "ArtfestFairSaleLine"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "ArtfestFairSaleLine_inventoryItemId_idx" ON "ArtfestFairSaleLine"("inventoryItemId");

-- CreateIndex
CREATE INDEX "ArtfestFairSaleLine_productId_idx" ON "ArtfestFairSaleLine"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtfestFairSaleLine_saleId_inventoryItemId_key" ON "ArtfestFairSaleLine"("saleId", "inventoryItemId");

-- CreateIndex
CREATE INDEX "ArtfestFairDiscount_fairId_status_idx" ON "ArtfestFairDiscount"("fairId", "status");

-- CreateIndex
CREATE INDEX "ArtfestFairDiscount_inventoryItemId_idx" ON "ArtfestFairDiscount"("inventoryItemId");

-- CreateIndex
CREATE INDEX "ArtfestFairDiscount_vendorId_idx" ON "ArtfestFairDiscount"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtfestFairSaleLineDiscount_saleLineId_key" ON "ArtfestFairSaleLineDiscount"("saleLineId");

-- CreateIndex
CREATE INDEX "ArtfestFairSaleLineDiscount_discountId_idx" ON "ArtfestFairSaleLineDiscount"("discountId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtfestFairSaleReturn_reference_key" ON "ArtfestFairSaleReturn"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "ArtfestFairSaleReturn_idempotencyKey_key" ON "ArtfestFairSaleReturn"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ArtfestFairSaleReturn_saleId_idx" ON "ArtfestFairSaleReturn"("saleId");

-- CreateIndex
CREATE INDEX "ArtfestFairSaleReturn_fairId_createdAt_idx" ON "ArtfestFairSaleReturn"("fairId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ArtfestFairSaleReturn_fairId_returnNumber_key" ON "ArtfestFairSaleReturn"("fairId", "returnNumber");

-- CreateIndex
CREATE INDEX "ArtfestFairSaleReturnLine_returnId_idx" ON "ArtfestFairSaleReturnLine"("returnId");

-- CreateIndex
CREATE INDEX "ArtfestFairSaleReturnLine_saleLineId_idx" ON "ArtfestFairSaleReturnLine"("saleLineId");

-- CreateIndex
CREATE INDEX "ArtfestFairSaleReturnLine_inventoryItemId_idx" ON "ArtfestFairSaleReturnLine"("inventoryItemId");

-- CreateIndex
CREATE INDEX "ArtfestFairSaleReturnLine_vendorId_createdAt_idx" ON "ArtfestFairSaleReturnLine"("vendorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ArtfestFairSettlement_previousSettlementId_key" ON "ArtfestFairSettlement"("previousSettlementId");

-- CreateIndex
CREATE INDEX "ArtfestFairSettlement_fairId_status_idx" ON "ArtfestFairSettlement"("fairId", "status");

-- CreateIndex
CREATE INDEX "ArtfestFairSettlement_vendorId_createdAt_idx" ON "ArtfestFairSettlement"("vendorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ArtfestFairSettlement_fairId_vendorId_sequence_key" ON "ArtfestFairSettlement"("fairId", "vendorId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ArtfestFairSettlementEntry_saleLineId_key" ON "ArtfestFairSettlementEntry"("saleLineId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtfestFairSettlementEntry_returnLineId_key" ON "ArtfestFairSettlementEntry"("returnLineId");

-- CreateIndex
CREATE INDEX "ArtfestFairSettlementEntry_settlementId_idx" ON "ArtfestFairSettlementEntry"("settlementId");

-- CreateIndex
CREATE INDEX "ArtfestFairStockMovement_saleReturnLineId_idx" ON "ArtfestFairStockMovement"("saleReturnLineId");

-- AddForeignKey
ALTER TABLE "ArtfestFairStockMovement" ADD CONSTRAINT "ArtfestFairStockMovement_saleLineId_fkey" FOREIGN KEY ("saleLineId") REFERENCES "ArtfestFairSaleLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairStockMovement" ADD CONSTRAINT "ArtfestFairStockMovement_saleReturnLineId_fkey" FOREIGN KEY ("saleReturnLineId") REFERENCES "ArtfestFairSaleReturnLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairSale" ADD CONSTRAINT "ArtfestFairSale_fairId_fkey" FOREIGN KEY ("fairId") REFERENCES "ArtfestFair"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairSale" ADD CONSTRAINT "ArtfestFairSale_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairSale" ADD CONSTRAINT "ArtfestFairSale_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairSaleLine" ADD CONSTRAINT "ArtfestFairSaleLine_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "ArtfestFairSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairSaleLine" ADD CONSTRAINT "ArtfestFairSaleLine_fairId_fkey" FOREIGN KEY ("fairId") REFERENCES "ArtfestFair"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairSaleLine" ADD CONSTRAINT "ArtfestFairSaleLine_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "ArtfestFairInventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairSaleLine" ADD CONSTRAINT "ArtfestFairSaleLine_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairSaleLine" ADD CONSTRAINT "ArtfestFairSaleLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairDiscount" ADD CONSTRAINT "ArtfestFairDiscount_fairId_fkey" FOREIGN KEY ("fairId") REFERENCES "ArtfestFair"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairDiscount" ADD CONSTRAINT "ArtfestFairDiscount_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "ArtfestFairInventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairDiscount" ADD CONSTRAINT "ArtfestFairDiscount_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairDiscount" ADD CONSTRAINT "ArtfestFairDiscount_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairDiscount" ADD CONSTRAINT "ArtfestFairDiscount_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairSaleLineDiscount" ADD CONSTRAINT "ArtfestFairSaleLineDiscount_saleLineId_fkey" FOREIGN KEY ("saleLineId") REFERENCES "ArtfestFairSaleLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairSaleLineDiscount" ADD CONSTRAINT "ArtfestFairSaleLineDiscount_discountId_fkey" FOREIGN KEY ("discountId") REFERENCES "ArtfestFairDiscount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairSaleReturn" ADD CONSTRAINT "ArtfestFairSaleReturn_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "ArtfestFairSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairSaleReturn" ADD CONSTRAINT "ArtfestFairSaleReturn_fairId_fkey" FOREIGN KEY ("fairId") REFERENCES "ArtfestFair"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairSaleReturn" ADD CONSTRAINT "ArtfestFairSaleReturn_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairSaleReturnLine" ADD CONSTRAINT "ArtfestFairSaleReturnLine_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "ArtfestFairSaleReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairSaleReturnLine" ADD CONSTRAINT "ArtfestFairSaleReturnLine_saleLineId_fkey" FOREIGN KEY ("saleLineId") REFERENCES "ArtfestFairSaleLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairSaleReturnLine" ADD CONSTRAINT "ArtfestFairSaleReturnLine_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "ArtfestFairInventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairSaleReturnLine" ADD CONSTRAINT "ArtfestFairSaleReturnLine_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairSettlement" ADD CONSTRAINT "ArtfestFairSettlement_fairId_fkey" FOREIGN KEY ("fairId") REFERENCES "ArtfestFair"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairSettlement" ADD CONSTRAINT "ArtfestFairSettlement_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairSettlement" ADD CONSTRAINT "ArtfestFairSettlement_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairSettlement" ADD CONSTRAINT "ArtfestFairSettlement_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairSettlement" ADD CONSTRAINT "ArtfestFairSettlement_previousSettlementId_fkey" FOREIGN KEY ("previousSettlementId") REFERENCES "ArtfestFairSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairSettlementEntry" ADD CONSTRAINT "ArtfestFairSettlementEntry_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "ArtfestFairSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairSettlementEntry" ADD CONSTRAINT "ArtfestFairSettlementEntry_saleLineId_fkey" FOREIGN KEY ("saleLineId") REFERENCES "ArtfestFairSaleLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairSettlementEntry" ADD CONSTRAINT "ArtfestFairSettlementEntry_returnLineId_fkey" FOREIGN KEY ("returnLineId") REFERENCES "ArtfestFairSaleReturnLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- CHECK constraints (adăugate manual; Prisma nu le poate exprima în schema)
-- Invariantele vânzării de la târg: sume, comision, reduceri, retururi, decont.
-- Toate sumele sunt în bani întregi (RON × 100).
-- =====================================================================

-- ArtfestFair: numerotarea internă a vânzărilor / retururilor
ALTER TABLE "ArtfestFair"
  ADD CONSTRAINT "ArtfestFair_saleNumbering_chk"
    CHECK ("nextSaleNumber" >= 1 AND "nextReturnNumber" >= 1);

-- ArtfestFairSale
ALTER TABLE "ArtfestFairSale"
  ADD CONSTRAINT "AFS_saleNumber_chk"
    CHECK ("saleNumber" >= 1),
  ADD CONSTRAINT "AFS_amounts_nonneg_chk"
    CHECK ("listCents" >= 0 AND "discountCents" >= 0 AND "discountCents" <= "listCents"
           AND "commissionCents" >= 0),
  ADD CONSTRAINT "AFS_total_chk"
    CHECK ("totalPaidCents" = "listCents" - "discountCents"),
  ADD CONSTRAINT "AFS_vendorNet_chk"
    CHECK ("vendorNetCents" >= 0),
  ADD CONSTRAINT "AFS_mixed_payment_chk"
    CHECK ("paymentMethod" <> 'MIXED'
           OR ("cashCents" IS NOT NULL AND "cardCents" IS NOT NULL
               AND "cashCents" >= 0 AND "cardCents" >= 0
               AND "cashCents" + "cardCents" = "totalPaidCents")),
  ADD CONSTRAINT "AFS_voided_chk"
    CHECK ("status" <> 'VOIDED' OR "voidedAt" IS NOT NULL);

-- ArtfestFairSaleLine
ALTER TABLE "ArtfestFairSaleLine"
  ADD CONSTRAINT "AFSL_quantity_chk"
    CHECK ("quantity" >= 1 AND "listUnitPriceCents" > 0),
  ADD CONSTRAINT "AFSL_lineList_chk"
    CHECK ("lineListCents" = "listUnitPriceCents" * "quantity"),
  ADD CONSTRAINT "AFSL_discount_chk"
    CHECK ("lineDiscountCents" >= 0 AND "lineDiscountCents" <= "lineListCents"),
  ADD CONSTRAINT "AFSL_lineGross_chk"
    CHECK ("lineGrossCents" = "lineListCents" - "lineDiscountCents"),
  ADD CONSTRAINT "AFSL_effectiveUnit_chk"
    CHECK ("effectiveUnitPriceCents" >= 0 AND "effectiveUnitPriceCents" <= "listUnitPriceCents"),
  ADD CONSTRAINT "AFSL_commission_chk"
    CHECK ("commissionBps" BETWEEN 0 AND 10000
           AND "commissionCents" >= 0 AND "commissionCents" <= "lineGrossCents"),
  ADD CONSTRAINT "AFSL_commissionOnList_chk"
    CHECK ("commissionOnListCents" >= 0 AND "commissionOnListCents" <= "lineListCents"
           AND "commissionCents" <= "commissionOnListCents"),
  ADD CONSTRAINT "AFSL_artfestFunded_chk"
    CHECK ("artfestFundedDiscountCents" >= 0 AND "artfestFundedDiscountCents" <= "lineDiscountCents"),
  ADD CONSTRAINT "AFSL_vendorNet_chk"
    CHECK ("vendorNetCents" = "lineGrossCents" - "commissionCents" + "artfestFundedDiscountCents"),
  -- vendorul nu primește niciodată mai mult decât netul fără reducere (D8 a: vendor neutru)
  ADD CONSTRAINT "AFSL_vendorNet_cap_chk"
    CHECK ("vendorNetCents" <= "lineListCents" - "commissionOnListCents"),
  ADD CONSTRAINT "AFSL_returnedQty_chk"
    CHECK ("returnedQty" >= 0 AND "returnedQty" <= "quantity");

-- ArtfestFairDiscount
ALTER TABLE "ArtfestFairDiscount"
  ADD CONSTRAINT "AFD_value_chk"
    CHECK (("type" = 'PERCENT' AND "percentBps" BETWEEN 1 AND 10000 AND "amountCents" IS NULL)
        OR ("type" = 'FIXED_AMOUNT' AND "amountCents" > 0 AND "percentBps" IS NULL)),
  ADD CONSTRAINT "AFD_scope_chk"
    CHECK (("scope" = 'INVENTORY_ITEM' AND "inventoryItemId" IS NOT NULL)
        OR ("scope" = 'VENDOR' AND "vendorId" IS NOT NULL)),
  ADD CONSTRAINT "AFD_active_approved_chk"
    CHECK ("status" <> 'ACTIVE' OR ("approvedAt" IS NOT NULL AND "approvedById" IS NOT NULL)),
  ADD CONSTRAINT "AFD_period_chk"
    CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "startsAt" < "endsAt"),
  ADD CONSTRAINT "AFD_name_chk"
    CHECK (length(btrim("name")) > 0);

-- ArtfestFairSaleLineDiscount
ALTER TABLE "ArtfestFairSaleLineDiscount"
  ADD CONSTRAINT "AFSLD_amount_chk"
    CHECK ("amountCents" > 0);

-- ArtfestFairSaleReturn
ALTER TABLE "ArtfestFairSaleReturn"
  ADD CONSTRAINT "AFSR_returnNumber_chk"
    CHECK ("returnNumber" >= 1),
  -- totalurile returului = suma liniilor (calculate de serviciu, alocare pe bucăți)
  ADD CONSTRAINT "AFSR_amounts_chk"
    CHECK ("refundCents" >= 0 AND "commissionReversedCents" >= 0
           AND "commissionReversedCents" <= "refundCents"
           AND "artfestFundedReversedCents" >= 0),
  ADD CONSTRAINT "AFSR_vendorNet_chk"
    CHECK ("vendorNetReversedCents" = "refundCents" - "commissionReversedCents" + "artfestFundedReversedCents"),
  ADD CONSTRAINT "AFSR_reason_chk"
    CHECK (length(btrim("reason")) > 0);

-- ArtfestFairSaleReturnLine
ALTER TABLE "ArtfestFairSaleReturnLine"
  ADD CONSTRAINT "AFSRL_quantity_chk"
    CHECK ("quantity" >= 1),
  -- alocare deterministă pe bucăți: pe fiecare bucată comisionul <= încasarea,
  -- deci și pe orice grup de bucăți returnate
  ADD CONSTRAINT "AFSRL_amounts_chk"
    CHECK ("refundCents" >= 0 AND "commissionReversedCents" >= 0
           AND "commissionReversedCents" <= "refundCents"
           AND "artfestFundedReversedCents" >= 0),
  ADD CONSTRAINT "AFSRL_vendorNet_chk"
    CHECK ("vendorNetReversedCents" = "refundCents" - "commissionReversedCents" + "artfestFundedReversedCents");

-- ArtfestFairSettlement
ALTER TABLE "ArtfestFairSettlement"
  ADD CONSTRAINT "AFST_period_chk"
    CHECK ("periodFrom" < "periodTo" AND "sequence" >= 1),
  ADD CONSTRAINT "AFST_amounts_chk"
    CHECK ("listSalesCents" >= 0 AND "discountsCents" >= 0 AND "grossSalesCents" >= 0
           AND "commissionCents" >= 0 AND "returnsRefundCents" >= 0
           AND "commissionReversedCents" >= 0 AND "carriedInCents" <= 0),
  ADD CONSTRAINT "AFST_finalDue_chk"
    CHECK ("finalDueCents" = "vendorNetCents" - "vendorNetReversedCents" + "adjustmentsCents" + "carriedInCents"),
  -- D6: soldul negativ se reportează în decontul următor al aceluiași vendor
  ADD CONSTRAINT "AFST_carried_chk"
    CHECK ("status" <> 'CARRIED_FORWARD' OR "finalDueCents" < 0),
  ADD CONSTRAINT "AFST_paid_chk"
    CHECK ("status" <> 'PAID' OR ("finalDueCents" > 0 AND "paidAt" IS NOT NULL)),
  ADD CONSTRAINT "AFST_finalized_chk"
    CHECK ("status" NOT IN ('FINALIZED', 'PAID', 'CARRIED_FORWARD') OR "finalizedAt" IS NOT NULL),
  ADD CONSTRAINT "AFST_previous_not_self_chk"
    CHECK ("previousSettlementId" IS NULL OR "previousSettlementId" <> "id");

-- ArtfestFairSettlementEntry: exact una dintre linia de vânzare / linia de retur
ALTER TABLE "ArtfestFairSettlementEntry"
  ADD CONSTRAINT "AFSE_one_source_chk"
    CHECK (("saleLineId" IS NOT NULL) <> ("returnLineId" IS NOT NULL)),
  ADD CONSTRAINT "AFSE_sign_chk"
    CHECK (("saleLineId" IS NOT NULL AND "grossCents" >= 0 AND "vendorNetCents" >= 0 AND "commissionCents" >= 0)
        OR ("returnLineId" IS NOT NULL AND "grossCents" <= 0 AND "vendorNetCents" <= 0 AND "commissionCents" <= 0));

-- ArtfestFairStockMovement: vânzările și reversările sunt legate de liniile lor
ALTER TABLE "ArtfestFairStockMovement"
  ADD CONSTRAINT "AFSM_sold_link_chk"
    CHECK ("type" <> 'SOLD' OR "saleLineId" IS NOT NULL),
  ADD CONSTRAINT "AFSM_reversed_link_chk"
    CHECK ("type" <> 'SALE_REVERSED' OR "saleReturnLineId" IS NOT NULL);
