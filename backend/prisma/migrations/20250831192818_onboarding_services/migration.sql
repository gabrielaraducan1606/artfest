-- CreateEnum
CREATE TYPE "public"."ServiceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "public"."ServiceType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fields" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."VendorService" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "basePriceCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "city" TEXT,
    "coverageAreas" TEXT[],
    "mediaUrls" TEXT[],
    "attributes" JSONB,
    "status" "public"."ServiceStatus" NOT NULL DEFAULT 'DRAFT',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorService_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceType_code_key" ON "public"."ServiceType"("code");

-- CreateIndex
CREATE INDEX "VendorService_vendorId_typeId_idx" ON "public"."VendorService"("vendorId", "typeId");

-- AddForeignKey
ALTER TABLE "public"."VendorService" ADD CONSTRAINT "VendorService_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "public"."Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VendorService" ADD CONSTRAINT "VendorService_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "public"."ServiceType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
