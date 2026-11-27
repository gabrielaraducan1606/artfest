-- Târg Artfest: regula financiară pentru vânzările VIITOARE ale produselor participanților.
--
-- Prețul declarat de vânzător rămâne integral al lui; peste el, pentru Artfest: adaos 10% din
-- prețul declarat + „Ambalare și accesorii” per bucată. Total client propus = declarat + adaos +
-- accesorii (ex. 50 + 5 + 5 = 60 lei: vânzătorul 50, Artfest 10). O reducere la casă micșorează doar
-- adaosul; sub declarat + accesorii vânzarea e blocată (commissionCents ≥ 0, CHECK existent).
--
-- Pe linia de vânzare se salvează regula și valorile ei. Sumele folosesc coloanele EXISTENTE, deci
-- CHECK-urile existente rămân valabile neschimbate:
--   vendorNetCents  = declaredUnitPriceCents × quantity
--   commissionCents = adaosul efectiv = lineGrossCents − (declarat + accesorii) × quantity
--   AFSL_vendorNet_chk: vendorNet = lineGross − commission − accessories (+ 0)  ✓
-- Retururile / anulările inversează din aceleași valori salvate (alocarea pe bucăți păstrează
-- exact prețul declarat pe fiecare bucată). Decontul nu se schimbă.
--
-- Doar coloane noi; toate rândurile existente primesc COMMISSION_PERCENT (regula aplicată atunci),
-- cu valorile noi NULL. Nicio dată existentă nu se modifică.

ALTER TABLE "ArtfestFairSaleLine"
  ADD COLUMN "financeRule" VARCHAR(32) NOT NULL DEFAULT 'COMMISSION_PERCENT',
  ADD COLUMN "declaredUnitPriceCents" INTEGER,
  ADD COLUMN "markupBps" INTEGER,
  ADD COLUMN "markupUnitCents" INTEGER,
  ADD COLUMN "proposedUnitPriceCents" INTEGER;

ALTER TABLE "ArtfestFairSaleLine"
  ADD CONSTRAINT "AFSL_finance_rule_chk"
    CHECK (
      "financeRule" IN ('COMMISSION_PERCENT', 'DECLARED_PLUS_MARKUP', 'ARTFEST_OWN')
      AND (
        (
          "financeRule" <> 'DECLARED_PLUS_MARKUP'
          AND "declaredUnitPriceCents" IS NULL AND "markupBps" IS NULL
          AND "markupUnitCents" IS NULL AND "proposedUnitPriceCents" IS NULL
        )
        OR (
          "financeRule" = 'DECLARED_PLUS_MARKUP'
          AND "vendorId" IS NOT NULL
          AND "declaredUnitPriceCents" > 0
          AND "markupBps" BETWEEN 0 AND 9999
          AND "markupUnitCents" >= 0
          AND "proposedUnitPriceCents" = "declaredUnitPriceCents" + "markupUnitCents" + "accessoriesUnitCents"
          AND "vendorNetCents" = "declaredUnitPriceCents" * "quantity"
          AND "artfestFundedDiscountCents" = 0
        )
      )
      AND ("financeRule" <> 'ARTFEST_OWN' OR "vendorId" IS NULL)
    );
