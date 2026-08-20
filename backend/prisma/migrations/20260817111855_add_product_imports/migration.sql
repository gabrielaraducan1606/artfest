-- CreateEnum
CREATE TYPE "ProductImportSource" AS ENUM ('EXCEL', 'CSV', 'EASYSALES', 'SHOPIFY', 'WOOCOMMERCE');

-- CreateEnum
CREATE TYPE "ProductImportStatus" AS ENUM ('UPLOADED', 'MAPPING', 'PREVIEW_READY', 'IMPORTING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ProductImportItemStatus" AS ENUM ('PENDING', 'READY', 'WARNING', 'ERROR', 'IMPORTED', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "ProductImport" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "source" "ProductImportSource" NOT NULL,
    "status" "ProductImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "fileName" TEXT,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "columns" JSONB,
    "mapping" JSONB,
    "meta" JSONB,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "readyRows" INTEGER NOT NULL DEFAULT 0,
    "warningRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "analyzedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ProductImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImportItem" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawData" JSONB NOT NULL,
    "normalizedData" JSONB,
    "status" "ProductImportItemStatus" NOT NULL DEFAULT 'PENDING',
    "warnings" JSONB,
    "errors" JSONB,
    "productId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "importedAt" TIMESTAMP(3),

    CONSTRAINT "ProductImportItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductImport_vendorId_createdAt_idx" ON "ProductImport"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductImport_serviceId_createdAt_idx" ON "ProductImport"("serviceId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductImport_vendorId_status_createdAt_idx" ON "ProductImport"("vendorId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ProductImport_serviceId_status_createdAt_idx" ON "ProductImport"("serviceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ProductImportItem_importId_status_idx" ON "ProductImportItem"("importId", "status");

-- CreateIndex
CREATE INDEX "ProductImportItem_productId_idx" ON "ProductImportItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductImportItem_importId_rowNumber_key" ON "ProductImportItem"("importId", "rowNumber");

-- AddForeignKey
ALTER TABLE "ProductImport" ADD CONSTRAINT "ProductImport_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImport" ADD CONSTRAINT "ProductImport_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "VendorService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImportItem" ADD CONSTRAINT "ProductImportItem_importId_fkey" FOREIGN KEY ("importId") REFERENCES "ProductImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImportItem" ADD CONSTRAINT "ProductImportItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
