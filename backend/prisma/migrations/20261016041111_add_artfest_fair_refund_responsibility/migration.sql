-- Târg Artfest - cine suportă rambursarea către client la retururile fără
-- produs revandabil (NOT_RETURNED / NOT_RESTOCKED) + suma suportată de Artfest
-- pe decont. Strict aditivă: enum nou, coloane nullable / cu default, CHECK-uri.
-- Nu modifică date existente.
-- =====================================================================

-- CreateEnum
CREATE TYPE "ArtfestRefundResponsibility" AS ENUM ('VENDOR', 'ARTFEST');

-- AlterTable
ALTER TABLE "ArtfestFairSaleReturnLine" ADD COLUMN     "refundResponsibility" "ArtfestRefundResponsibility",
ADD COLUMN     "responsibilityReason" TEXT;

-- AlterTable
ALTER TABLE "ArtfestFairSettlement" ADD COLUMN     "artfestBorneRefundCents" INTEGER NOT NULL DEFAULT 0;

-- =====================================================================
-- CHECK constraints (adăugate manual; Prisma nu le poate exprima în schema)
-- =====================================================================

-- ArtfestFairSaleReturnLine: responsabilul există DACĂ ȘI NUMAI DACĂ
-- disposition IN (NOT_RETURNED, NOT_RESTOCKED); RESTOCKED => NULL
ALTER TABLE "ArtfestFairSaleReturnLine"
  ADD CONSTRAINT "AFSRL_responsibility_chk"
    CHECK (("disposition" IN ('NOT_RETURNED', 'NOT_RESTOCKED')) = ("refundResponsibility" IS NOT NULL)),
  -- motivul intern: obligatoriu (min. 3 caractere) exact când există responsabil, altfel NULL
  ADD CONSTRAINT "AFSRL_responsibility_reason_chk"
    CHECK (
      ("refundResponsibility" IS NULL AND "responsibilityReason" IS NULL)
      OR ("refundResponsibility" IS NOT NULL AND "responsibilityReason" IS NOT NULL
          AND char_length(btrim("responsibilityReason")) >= 3)
    );

-- ArtfestFairSettlement: rambursarea suportată de Artfest (suma refundCents a
-- liniilor ARTFEST) e o parte din rambursările totale ale vendorului din perioadă
ALTER TABLE "ArtfestFairSettlement"
  ADD CONSTRAINT "AFST_artfestBorne_chk"
    CHECK ("artfestBorneRefundCents" >= 0 AND "artfestBorneRefundCents" <= "returnsRefundCents");
