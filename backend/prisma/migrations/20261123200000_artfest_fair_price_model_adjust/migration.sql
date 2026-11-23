-- Târg Artfest: ajustarea migrației 20261123120000_artfest_fair_vendor_price_model
-- (aplicată deja pe DEV; NU se rescrie). Regula financiară devine UNA singură:
-- comisionul fair.commissionBps (10%) din prețul efectiv, vendorul primește 90%,
-- inclusiv la reduceri. Modelul de preț al înscrierii controlează doar prețul final
-- stabilit de Artfest și prețul introdus la casă.
--
--  1. VENDOR_PRICE -> FAIR_PRICE (aceeași valoare de enum, redenumită);
--  2. înscriere: dovada acceptării (cont, IP, browser) ca la acceptarea regulamentului;
--  3. linia de vânzare: scoate suma fixă a vendorului (vendorUnitPriceCents /
--     vendorAdjustReason) și CHECK-urile ei; FAIR_PRICE folosește CHECK-urile de
--     comision existente (AFSL_*).
-- Gărzile de mai jos opresc migrația dacă ar exista date care s-ar pierde sau ar
-- încălca noile reguli (pe DEV: 0 înscrieri / 0 linii pe regula nouă la 2026-11-23).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ArtfestFairSaleLine"
    WHERE "vendorUnitPriceCents" IS NOT NULL OR "vendorAdjustReason" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'artfest_fair_price_model_adjust: există linii de vânzare cu suma fixă a vendorului; nu se șterg automat';
  END IF;
  IF EXISTS (SELECT 1 FROM "ArtfestFairRegistration" WHERE "pricingModel"::text <> 'COMMISSION') THEN
    RAISE EXCEPTION 'artfest_fair_price_model_adjust: există înscrieri pe regula nouă fără dovada completă a acceptării';
  END IF;
END $$;

-- 1. aceeași valoare, nume nou
ALTER TYPE "ArtfestFairPricingModel" RENAME VALUE 'VENDOR_PRICE' TO 'FAIR_PRICE';

-- 2. înscrierea: dovada acceptării (regulament 17.2)
ALTER TABLE "ArtfestFairRegistration"
  ADD COLUMN "pricingModelAcceptedById" TEXT,
  ADD COLUMN "pricingModelAcceptIp" VARCHAR(64),
  ADD COLUMN "pricingModelAcceptUa" VARCHAR(500);

ALTER TABLE "ArtfestFairRegistration" DROP CONSTRAINT "AFR_pricing_model_acceptance_chk";
ALTER TABLE "ArtfestFairRegistration"
  ADD CONSTRAINT "AFR_pricing_model_acceptance_chk"
    CHECK ("pricingModel" = 'COMMISSION'
           OR ("pricingModelAcceptedAt" IS NOT NULL AND "pricingModelTermsVersion" IS NOT NULL
               AND "pricingModelAcceptedById" IS NOT NULL));

-- 3. linia de vânzare: o singură regulă (comision), fără sumă fixă a vendorului
ALTER TABLE "ArtfestFairSaleLine" DROP CONSTRAINT "AFSL_vendor_adjust_reason_chk";
ALTER TABLE "ArtfestFairSaleLine" DROP CONSTRAINT "AFSL_pricing_model_chk";
ALTER TABLE "ArtfestFairSaleLine"
  DROP COLUMN "vendorUnitPriceCents",
  DROP COLUMN "vendorAdjustReason";

-- COMMISSION: fără câmpurile modelului nou (liniile existente trec automat).
-- FAIR_PRICE: prețul declarat al vendorului salvat la vânzare; banii respectă
-- CHECK-urile de comision existente (AFSL_vendorNet_chk, AFSL_commission_chk ...).
ALTER TABLE "ArtfestFairSaleLine"
  ADD CONSTRAINT "AFSL_pricing_model_chk"
    CHECK (
      ("pricingModel" = 'COMMISSION'
        AND "vendorBaseUnitPriceCents" IS NULL AND "priceSetManually" = false)
      OR
      ("pricingModel" = 'FAIR_PRICE'
        AND "vendorBaseUnitPriceCents" IS NOT NULL AND "vendorBaseUnitPriceCents" > 0)
    );
