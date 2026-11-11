-- Profilul logistic al produsului (produsul ambalat, gata de expediere),
-- pentru tariful Sameday la checkout. Aditivă: 4 coloane opționale, fără
-- valori implicite -> produsele existente rămân neschimbate (null = necompletat).

-- AlterTable
ALTER TABLE "Product"
  ADD COLUMN "shippingWeightGrams" INTEGER,
  ADD COLUMN "shippingLengthCm" INTEGER,
  ADD COLUMN "shippingWidthCm" INTEGER,
  ADD COLUMN "shippingHeightCm" INTEGER;
