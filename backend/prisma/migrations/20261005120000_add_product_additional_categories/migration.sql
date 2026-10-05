-- Categorii SUPLIMENTARE per produs (discovery intern, max 3 - validat în backend).
-- Strict aditiv: tabel nou, fără modificări pe "Product", fără backfill.
-- Produsele existente rămân valide cu zero categorii suplimentare.
-- Categoria principală rămâne "Product"."category" (SEO / canonical / feed-uri).

-- CreateTable
CREATE TABLE "ProductAdditionalCategory" (
    "productId" TEXT NOT NULL,
    "category" VARCHAR(64) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductAdditionalCategory_pkey" PRIMARY KEY ("productId","category")
);

-- CreateIndex
CREATE INDEX "ProductAdditionalCategory_category_productId_idx" ON "ProductAdditionalCategory"("category", "productId");

-- AddForeignKey
ALTER TABLE "ProductAdditionalCategory" ADD CONSTRAINT "ProductAdditionalCategory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
