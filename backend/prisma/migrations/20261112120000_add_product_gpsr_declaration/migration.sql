-- Declarația GPSR per produs (append-only). Doar un tabel NOU:
-- nu modifică produse, vânzători, comenzi sau alte tabele; fără backfill.

-- CreateTable
CREATE TABLE "ProductGpsrDeclaration" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "noticeVersion" VARCHAR(40) NOT NULL,
    "textHash" VARCHAR(64) NOT NULL,
    "manufacturerHash" VARCHAR(64) NOT NULL,
    "safetyHash" VARCHAR(64) NOT NULL,
    "source" VARCHAR(32),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductGpsrDeclaration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductGpsrDeclaration_productId_createdAt_idx" ON "ProductGpsrDeclaration"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductGpsrDeclaration_vendorId_createdAt_idx" ON "ProductGpsrDeclaration"("vendorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductGpsrDeclaration_product_version_hashes_key" ON "ProductGpsrDeclaration"("productId", "noticeVersion", "manufacturerHash", "safetyHash");

