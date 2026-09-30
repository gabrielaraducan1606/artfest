-- CreateEnum
CREATE TYPE "CourierProvider" AS ENUM ('SAMEDAY', 'FAN_COURIER', 'DPD', 'CARGUS', 'GLS');

-- CreateEnum
CREATE TYPE "CourierAccountOwner" AS ENUM ('VENDOR', 'PLATFORM');

-- CreateEnum
CREATE TYPE "CourierAccountStatus" AS ENUM ('ACTIVE', 'INVALID_CREDENTIALS', 'DISABLED');

-- CreateTable
CREATE TABLE "CourierAccount" (
    "id" TEXT NOT NULL,
    "ownerType" "CourierAccountOwner" NOT NULL DEFAULT 'VENDOR',
    "vendorId" TEXT,
    "provider" "CourierProvider" NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "status" "CourierAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "credentialsCipher" BYTEA NOT NULL,
    "credentialsKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "credentialsHint" VARCHAR(160),
    "publicConfig" JSONB,
    "pickupAddressId" TEXT,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastError" TEXT,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorPickupAddress" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "serviceId" TEXT,
    "contactName" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(40) NOT NULL,
    "email" VARCHAR(320),
    "county" VARCHAR(120) NOT NULL,
    "city" VARCHAR(160) NOT NULL,
    "postalCode" VARCHAR(20),
    "street" VARCHAR(255) NOT NULL,
    "streetNo" VARCHAR(40) NOT NULL,
    "details" VARCHAR(500),
    "providerRefs" JSONB,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorPickupAddress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourierAccount_vendorId_provider_idx" ON "CourierAccount"("vendorId", "provider");

-- CreateIndex
CREATE INDEX "CourierAccount_vendorId_status_idx" ON "CourierAccount"("vendorId", "status");

-- CreateIndex
CREATE INDEX "CourierAccount_provider_status_idx" ON "CourierAccount"("provider", "status");

-- CreateIndex
CREATE INDEX "CourierAccount_ownerType_provider_idx" ON "CourierAccount"("ownerType", "provider");

-- CreateIndex
CREATE INDEX "CourierAccount_pickupAddressId_idx" ON "CourierAccount"("pickupAddressId");

-- CreateIndex
CREATE INDEX "VendorPickupAddress_vendorId_idx" ON "VendorPickupAddress"("vendorId");

-- CreateIndex
CREATE INDEX "VendorPickupAddress_vendorId_isDefault_idx" ON "VendorPickupAddress"("vendorId", "isDefault");

-- CreateIndex
CREATE INDEX "VendorPickupAddress_serviceId_idx" ON "VendorPickupAddress"("serviceId");

-- AddForeignKey
ALTER TABLE "CourierAccount" ADD CONSTRAINT "CourierAccount_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierAccount" ADD CONSTRAINT "CourierAccount_pickupAddressId_fkey" FOREIGN KEY ("pickupAddressId") REFERENCES "VendorPickupAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPickupAddress" ADD CONSTRAINT "VendorPickupAddress_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
