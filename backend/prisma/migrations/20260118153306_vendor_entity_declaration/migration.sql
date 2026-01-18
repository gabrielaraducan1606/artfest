-- CreateTable
CREATE TABLE "VendorEntityDeclaration" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "ua" TEXT,
    "meta" JSONB,

    CONSTRAINT "VendorEntityDeclaration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorEntityDeclaration_vendorId_key" ON "VendorEntityDeclaration"("vendorId");

-- CreateIndex
CREATE INDEX "VendorEntityDeclaration_vendorId_idx" ON "VendorEntityDeclaration"("vendorId");

-- CreateIndex
CREATE INDEX "VendorEntityDeclaration_acceptedAt_idx" ON "VendorEntityDeclaration"("acceptedAt");

-- AddForeignKey
ALTER TABLE "VendorEntityDeclaration" ADD CONSTRAINT "VendorEntityDeclaration_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
