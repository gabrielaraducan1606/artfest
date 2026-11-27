-- Târg Artfest: „Ambalare și accesorii” adăugate de Artfest pe produsele participanților.
--
--  1. Linia de inventar: lista curentă a accesoriilor, PER BUCATĂ DE PRODUS (accessories JSON +
--     accessoriesUnitCents), cine / când a modificat-o; istoricul în evenimente (ACCESSORIES_SET).
--     Doar produsele participanților: o linie Artfest (stoc propriu) nu are accesorii.
--  2. Linia de vânzare: snapshot-ul exact (listă, total pe bucată, total pe linie). Accesoriile
--     se rețin din partea vânzătorului și revin integral Artfest; comisionul rămâne pe prețul efectiv:
--       vendorNetCents = lineGrossCents − commissionCents − accessoriesCents + artfestFundedDiscountCents
--     Suma vânzătorului nu poate fi negativă.
--  3. Retururi: accesoriile se inversează din valorile salvate, pentru bucățile returnate:
--       vendorNetReversedCents = refundCents − commissionReversedCents − accessoriesReversedCents
--                                + artfestFundedReversedCents
--  4. Decontul și intrările lui: accesoriile afișate separat (deja scăzute din vendorNetCents;
--     formula sumei finale, AFST_finalDue_chk, rămâne neschimbată).
--
-- Doar coloane noi cu valoarea implicită 0 / NULL + CHECK-uri înlocuite cu variante care, pentru
-- accesorii 0, sunt IDENTICE cu cele vechi. Toate rândurile existente au accesorii 0, deci trec
-- automat. Nicio dată existentă nu se modifică.

-- istoric: modificarea accesoriilor (before / after + autor)
ALTER TYPE "ArtfestInventoryEventType" ADD VALUE 'ACCESSORIES_SET';

-- 1. inventar
ALTER TABLE "ArtfestFairInventoryItem"
  ADD COLUMN "accessories" JSONB,
  ADD COLUMN "accessoriesUnitCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "accessoriesUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "accessoriesUpdatedById" TEXT;

ALTER TABLE "ArtfestFairInventoryItem"
  ADD CONSTRAINT "AFII_accessories_chk"
    CHECK (
      "accessoriesUnitCents" >= 0
      AND ("vendorId" IS NOT NULL OR ("accessoriesUnitCents" = 0 AND "accessories" IS NULL))
    );

-- 2. vânzare
ALTER TABLE "ArtfestFairSale"
  ADD COLUMN "accessoriesCents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ArtfestFairSale"
  ADD CONSTRAINT "AFS_accessories_chk"
    CHECK ("accessoriesCents" >= 0);

ALTER TABLE "ArtfestFairSaleLine"
  ADD COLUMN "accessoriesSnapshot" JSONB,
  ADD COLUMN "accessoriesUnitCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "accessoriesCents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ArtfestFairSaleLine" DROP CONSTRAINT "AFSL_vendorNet_chk";
ALTER TABLE "ArtfestFairSaleLine" DROP CONSTRAINT "AFSL_artfest_owned_chk";

ALTER TABLE "ArtfestFairSaleLine"
  ADD CONSTRAINT "AFSL_vendorNet_chk"
    CHECK ("vendorNetCents" = "lineGrossCents" - "commissionCents" - "accessoriesCents" + "artfestFundedDiscountCents"),
  ADD CONSTRAINT "AFSL_accessories_chk"
    CHECK (
      "accessoriesUnitCents" >= 0
      AND "accessoriesCents" = "accessoriesUnitCents" * "quantity"
      AND "vendorNetCents" >= 0
    ),
  ADD CONSTRAINT "AFSL_artfest_owned_chk"
    CHECK (
      "vendorId" IS NOT NULL
      OR (
        "commissionBps" = 10000
        AND "commissionCents" = "lineGrossCents"
        AND "vendorNetCents" = 0
        AND "artfestFundedDiscountCents" = 0
        AND "accessoriesCents" = 0
        AND "pricingModel" = 'COMMISSION'
        AND "productId" IS NULL
      )
    );

-- 3. retururi
ALTER TABLE "ArtfestFairSaleReturn"
  ADD COLUMN "accessoriesReversedCents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ArtfestFairSaleReturn" DROP CONSTRAINT "AFSR_vendorNet_chk";
ALTER TABLE "ArtfestFairSaleReturn"
  ADD CONSTRAINT "AFSR_vendorNet_chk"
    CHECK ("vendorNetReversedCents" = "refundCents" - "commissionReversedCents" - "accessoriesReversedCents" + "artfestFundedReversedCents"),
  ADD CONSTRAINT "AFSR_accessories_chk"
    CHECK ("accessoriesReversedCents" >= 0);

ALTER TABLE "ArtfestFairSaleReturnLine"
  ADD COLUMN "accessoriesReversedCents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ArtfestFairSaleReturnLine" DROP CONSTRAINT "AFSRL_vendorNet_chk";
ALTER TABLE "ArtfestFairSaleReturnLine" DROP CONSTRAINT "AFSRL_artfest_owned_chk";
ALTER TABLE "ArtfestFairSaleReturnLine"
  ADD CONSTRAINT "AFSRL_vendorNet_chk"
    CHECK ("vendorNetReversedCents" = "refundCents" - "commissionReversedCents" - "accessoriesReversedCents" + "artfestFundedReversedCents"),
  ADD CONSTRAINT "AFSRL_accessories_chk"
    CHECK ("accessoriesReversedCents" >= 0),
  ADD CONSTRAINT "AFSRL_artfest_owned_chk"
    CHECK (
      "vendorId" IS NOT NULL
      OR ("vendorNetReversedCents" = 0 AND "artfestFundedReversedCents" = 0 AND "accessoriesReversedCents" = 0)
    );

-- 4. decont
ALTER TABLE "ArtfestFairSettlement"
  ADD COLUMN "accessoriesCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "accessoriesReversedCents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ArtfestFairSettlement"
  ADD CONSTRAINT "AFST_accessories_chk"
    CHECK ("accessoriesCents" >= 0 AND "accessoriesReversedCents" >= 0);

ALTER TABLE "ArtfestFairSettlementEntry"
  ADD COLUMN "accessoriesCents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ArtfestFairSettlementEntry" DROP CONSTRAINT "AFSE_sign_chk";
ALTER TABLE "ArtfestFairSettlementEntry"
  ADD CONSTRAINT "AFSE_sign_chk"
    CHECK (("saleLineId" IS NOT NULL AND "grossCents" >= 0 AND "vendorNetCents" >= 0 AND "commissionCents" >= 0 AND "accessoriesCents" >= 0)
        OR ("returnLineId" IS NOT NULL AND "grossCents" <= 0 AND "vendorNetCents" <= 0 AND "commissionCents" <= 0 AND "accessoriesCents" <= 0));
