-- =====================================================================
-- Târg Artfest - returul bucăților deteriorate către vendor: CHECK-uri.
-- Separată de 20261014112031_add_artfest_fair_damaged_returns, deoarece
-- valoarea nouă de enum 'DAMAGED_RETURNED_TO_VENDOR' nu poate fi folosită în
-- aceeași tranzacție în care a fost adăugată.
--
-- NU e strict aditivă: înlocuiește două CHECK-uri existente cu variante mai
-- largi (aceeași regulă + deteriorate). Fără modificări de date.
-- =====================================================================

-- ArtfestFairInventoryItem: deterioratele returnate nu depășesc deterioratele
ALTER TABLE "ArtfestFairInventoryItem"
  ADD CONSTRAINT "AFII_damagedReturned_chk"
    CHECK ("damagedReturnedQty" >= 0 AND "damagedReturnedQty" <= "damagedQty");

-- ArtfestFairReturnLine: o linie poate conține doar deteriorate
ALTER TABLE "ArtfestFairReturnLine" DROP CONSTRAINT "AFRetL_qty_positive_chk";
ALTER TABLE "ArtfestFairReturnLine"
  ADD CONSTRAINT "AFRetL_qty_positive_chk"
    CHECK ("qtyFromStock" + "qtyRejected" + "qtyDamaged" >= 1),
  ADD CONSTRAINT "AFRetL_qtyDamaged_nonneg_chk"
    CHECK ("qtyDamaged" >= 0),
  -- deterioratele confirmate separat; vendorReceivedQty (vandabile + refuzate) rămâne
  -- singura bază pentru restoreOnlineQty => deterioratele nu pot reveni online
  ADD CONSTRAINT "AFRetL_receivedDamaged_chk"
    CHECK ("vendorReceivedDamagedQty" IS NULL OR ("vendorReceivedDamagedQty" >= 0 AND "vendorReceivedDamagedQty" <= "qtyDamaged"));

-- ArtfestFairStockMovement: legătura cu returul și pentru mișcarea nouă
ALTER TABLE "ArtfestFairStockMovement" DROP CONSTRAINT "AFSM_returnLine_type_chk";
ALTER TABLE "ArtfestFairStockMovement"
  ADD CONSTRAINT "AFSM_returnLine_type_chk"
    CHECK (
      "returnLineId" IS NULL
      OR "type" IN ('RETURNED_TO_VENDOR', 'REJECTED_RETURNED_TO_VENDOR', 'DAMAGED_RETURNED_TO_VENDOR')
    );
