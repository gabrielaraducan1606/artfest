-- Târg Artfest: ajustarea regulii financiare pentru vânzările VIITOARE ale produselor participanților.
-- (Migrația 20261127180000_artfest_fair_declared_markup rămâne exact cum a fost aplicată.)
--
-- Preț propus = preț declarat + adaos Artfest 10% din declarat + „Ambalare și accesorii” per bucată.
-- La vânzare, după încasarea efectivă a liniei (față de propus × cantitate) - aplicat de server:
--   DECLARED_PLUS_MARKUP  (încasat ≥ propus): vânzătorul primește prețul declarat × cantitate;
--                         Artfest primește diferența.
--   DISCOUNTED_COMMISSION (încasat < propus) - NOU: se scad întâi accesoriile; din baza rămasă Artfest
--                         primește comisionul de 10% (round_half_up), vânzătorul restul de 90%.
--                         Ex.: declarat 12, cutie 3, încasat 15: bază 12, comision 1,20, vânzător 10,80.
--   Încasarea sub accesorii e refuzată (vendorNetCents ≥ 0, AFSL_accessories_chk).
--
-- Constrângerea AFSL_finance_rule_chk se înlocuiește:
--   - DISCOUNTED_COMMISSION: verificare completă (încasat < propus, ≥ accesorii, comision = 10% din
--     încasat − accesorii, rotunjit ca în aplicație);
--   - DECLARED_PLUS_MARKUP: aceeași verificare ca în migrația aplicată (vânzătorul = declarat × cantitate),
--     FĂRĂ condiția „încasat ≥ propus” - vânzările deja salvate cu varianta anterioară a regulii (sub
--     propus, cu vânzătorul la prețul declarat) rămân valide și NU se recalculează; pragul pentru vânzările
--     noi e aplicat de server (fairLineSplit).
-- Fără coloane noi și fără modificări de date.

ALTER TABLE "ArtfestFairSaleLine" DROP CONSTRAINT "AFSL_finance_rule_chk";

ALTER TABLE "ArtfestFairSaleLine"
  ADD CONSTRAINT "AFSL_finance_rule_chk"
    CHECK (
      "financeRule" IN ('COMMISSION_PERCENT', 'DECLARED_PLUS_MARKUP', 'DISCOUNTED_COMMISSION', 'ARTFEST_OWN')
      AND (
        (
          "financeRule" IN ('COMMISSION_PERCENT', 'ARTFEST_OWN')
          AND "declaredUnitPriceCents" IS NULL AND "markupBps" IS NULL
          AND "markupUnitCents" IS NULL AND "proposedUnitPriceCents" IS NULL
        )
        OR (
          "financeRule" IN ('DECLARED_PLUS_MARKUP', 'DISCOUNTED_COMMISSION')
          AND "vendorId" IS NOT NULL
          AND "declaredUnitPriceCents" > 0
          AND "markupBps" BETWEEN 0 AND 9999
          AND "markupUnitCents" >= 0
          AND "proposedUnitPriceCents" = "declaredUnitPriceCents" + "markupUnitCents" + "accessoriesUnitCents"
          AND "artfestFundedDiscountCents" = 0
          AND (
            -- vânzătorul primește exact prețul declarat (ca în migrația aplicată)
            (
              "financeRule" = 'DECLARED_PLUS_MARKUP'
              AND "vendorNetCents" = "declaredUnitPriceCents" * "quantity"
            )
            -- sub propus: comision 10% (round_half_up) din încasat − accesorii; vânzătorul restul
            OR (
              "financeRule" = 'DISCOUNTED_COMMISSION'
              AND "lineGrossCents" < "proposedUnitPriceCents" * "quantity"
              AND "lineGrossCents" >= "accessoriesCents"
              AND "commissionCents" = (2 * ("lineGrossCents" - "accessoriesCents") * "markupBps" + 10000) / 20000
            )
          )
        )
      )
      AND ("financeRule" <> 'ARTFEST_OWN' OR "vendorId" IS NULL)
    );
