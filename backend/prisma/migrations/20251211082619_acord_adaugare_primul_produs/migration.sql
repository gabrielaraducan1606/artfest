-- CreateTable
CREATE TABLE "VendorProductDeclaration" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "text" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "ua" TEXT,
    "meta" JSONB,

    CONSTRAINT "VendorProductDeclaration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorProductDeclaration_vendorId_key" ON "VendorProductDeclaration"("vendorId");

-- CreateIndex
CREATE INDEX "VendorProductDeclaration_vendorId_idx" ON "VendorProductDeclaration"("vendorId");

-- AddForeignKey
ALTER TABLE "VendorProductDeclaration" ADD CONSTRAINT "VendorProductDeclaration_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
