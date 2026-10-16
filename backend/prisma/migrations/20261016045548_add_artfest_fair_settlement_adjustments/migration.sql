-- Târg Artfest - ajustări manuale ale decontului (imutabile, cu audit) și
-- regula PAID mai strictă. Tabel nou + CHECK-uri; înlocuiește UN CHECK existent
-- (AFST_paid_chk) cu o variantă mai strictă. Fără modificări de date.
-- =====================================================================

-- CreateTable
CREATE TABLE "ArtfestFairSettlementAdjustment" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "vendorNote" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtfestFairSettlementAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArtfestFairSettlementAdjustment_settlementId_idx" ON "ArtfestFairSettlementAdjustment"("settlementId");

-- AddForeignKey
ALTER TABLE "ArtfestFairSettlementAdjustment" ADD CONSTRAINT "ArtfestFairSettlementAdjustment_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "ArtfestFairSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairSettlementAdjustment" ADD CONSTRAINT "ArtfestFairSettlementAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- CHECK constraints (adăugate manual; Prisma nu le poate exprima în schema)
-- =====================================================================

-- ArtfestFairSettlementAdjustment: sumă nenulă, motiv intern min. 3 caractere,
-- nota pentru vendor (dacă există) nevidă
ALTER TABLE "ArtfestFairSettlementAdjustment"
  ADD CONSTRAINT "AFSA_amount_chk"
    CHECK ("amountCents" <> 0),
  ADD CONSTRAINT "AFSA_reason_chk"
    CHECK (char_length(btrim("reason")) >= 3),
  ADD CONSTRAINT "AFSA_vendorNote_chk"
    CHECK ("vendorNote" IS NULL OR char_length(btrim("vendorNote")) > 0);

-- ArtfestFairSettlement: PAID doar cu sumă de plătit > 0, data plății, cine a
-- marcat plata și referința plății (nevidă). Înlocuiește AFST_paid_chk.
ALTER TABLE "ArtfestFairSettlement" DROP CONSTRAINT "AFST_paid_chk";
ALTER TABLE "ArtfestFairSettlement"
  ADD CONSTRAINT "AFST_paid_chk"
    CHECK (
      "status" <> 'PAID'
      OR (
        "finalDueCents" > 0
        AND "paidAt" IS NOT NULL
        AND "paidById" IS NOT NULL
        AND "paymentReference" IS NOT NULL
        AND char_length(btrim("paymentReference")) > 0
      )
    );
