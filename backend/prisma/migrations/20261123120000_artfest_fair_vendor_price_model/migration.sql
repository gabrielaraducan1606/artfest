-- Târg Artfest: modelul „vendorul primește prețul lui” (VENDOR_PRICE).
-- ADITIVĂ: coloane noi cu valori implicite / NULL. Înscrierile, inventarul,
-- vânzările și deconturile existente rămân pe regula actuală (COMMISSION);
-- nicio valoare existentă nu se recalculează.

-- 1. regula de împărțire
CREATE TYPE "ArtfestFairPricingModel" AS ENUM ('COMMISSION', 'VENDOR_PRICE');

-- 2. evenimentul de jurnal pentru prețul final (nu e folosit în această tranzacție)
ALTER TYPE "ArtfestInventoryEventType" ADD VALUE 'FINAL_PRICE_SET';

-- 3. înscrierea: regula + acceptarea explicită a noii versiuni de regulament
ALTER TABLE "ArtfestFairRegistration"
  ADD COLUMN "pricingModel" "ArtfestFairPricingModel" NOT NULL DEFAULT 'COMMISSION',
  ADD COLUMN "pricingModelAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "pricingModelTermsVersion" VARCHAR(40);

ALTER TABLE "ArtfestFairRegistration"
  ADD CONSTRAINT "AFR_pricing_model_acceptance_chk"
    CHECK ("pricingModel" = 'COMMISSION'
           OR ("pricingModelAcceptedAt" IS NOT NULL AND "pricingModelTermsVersion" IS NOT NULL));

-- 4. inventarul: prețul final stabilit de Admin (nu atinge prețul produsului online)
ALTER TABLE "ArtfestFairInventoryItem"
  ADD COLUMN "finalPriceCents" INTEGER,
  ADD COLUMN "finalPriceSetAt" TIMESTAMP(3),
  ADD COLUMN "finalPriceSetById" TEXT;

ALTER TABLE "ArtfestFairInventoryItem"
  ADD CONSTRAINT "AFII_final_price_chk"
    CHECK ("finalPriceCents" IS NULL OR "finalPriceCents" > 0);

-- 5. linia vânzării: regula și sumele vendorului salvate la momentul vânzării
ALTER TABLE "ArtfestFairSaleLine"
  ADD COLUMN "pricingModel" "ArtfestFairPricingModel" NOT NULL DEFAULT 'COMMISSION',
  ADD COLUMN "vendorBaseUnitPriceCents" INTEGER,
  ADD COLUMN "vendorUnitPriceCents" INTEGER,
  ADD COLUMN "vendorAdjustReason" VARCHAR(500),
  ADD COLUMN "priceSetManually" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ArtfestFairSaleLine"
  -- COMMISSION: fără câmpurile modelului nou (liniile existente trec automat)
  -- VENDOR_PRICE: netul vendorului = suma lui pe bucată × cantitate; fără comision procentual
  ADD CONSTRAINT "AFSL_pricing_model_chk"
    CHECK (
      ("pricingModel" = 'COMMISSION'
        AND "vendorBaseUnitPriceCents" IS NULL AND "vendorUnitPriceCents" IS NULL
        AND "vendorAdjustReason" IS NULL AND "priceSetManually" = false)
      OR
      ("pricingModel" = 'VENDOR_PRICE'
        AND "vendorBaseUnitPriceCents" IS NOT NULL AND "vendorBaseUnitPriceCents" > 0
        AND "vendorUnitPriceCents" IS NOT NULL AND "vendorUnitPriceCents" >= 0
        AND "vendorNetCents" = "vendorUnitPriceCents" * "quantity"
        AND "commissionBps" = 0 AND "artfestFundedDiscountCents" = 0)
    ),
  -- suma vendorului schimbată în POS doar cu motivul / acordul consemnat
  ADD CONSTRAINT "AFSL_vendor_adjust_reason_chk"
    CHECK ("vendorUnitPriceCents" IS NOT DISTINCT FROM "vendorBaseUnitPriceCents"
           OR length(btrim(coalesce("vendorAdjustReason", ''))) > 0);
