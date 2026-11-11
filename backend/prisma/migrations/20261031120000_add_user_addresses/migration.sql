
-- CreateEnum
CREATE TYPE "UserAddressLabel" AS ENUM ('HOME', 'WORK', 'OTHER');

-- CreateTable
CREATE TABLE "UserAddress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" "UserAddressLabel" NOT NULL DEFAULT 'HOME',
    "firstName" VARCHAR(80) NOT NULL,
    "lastName" VARCHAR(80) NOT NULL,
    "phone" VARCHAR(40) NOT NULL,
    "county" VARCHAR(120) NOT NULL,
    "city" VARCHAR(160) NOT NULL,
    "street" VARCHAR(500) NOT NULL,
    "postalCode" VARCHAR(16),
    "notes" VARCHAR(500),
    "samedayCountyId" INTEGER,
    "samedayCityId" INTEGER,
    "samedayValidatedAt" TIMESTAMP(3),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserOohLocation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courierProvider" VARCHAR(32) NOT NULL DEFAULT 'SAMEDAY',
    "oohType" INTEGER NOT NULL,
    "oohId" INTEGER NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "address" VARCHAR(500),
    "cityName" VARCHAR(160),
    "countyName" VARCHAR(120),
    "postalCode" VARCHAR(16),
    "lat" DECIMAL(9,6),
    "lng" DECIMAL(9,6),
    "scheduleSnapshot" JSONB,
    "lastValidatedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserOohLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserAddress_userId_idx" ON "UserAddress"("userId");

-- cel mult O adresă implicită per user (index parțial - Prisma nu îl poate exprima în schema.prisma)
CREATE UNIQUE INDEX "UserAddress_one_default_per_user" ON "UserAddress"("userId") WHERE "isDefault" = true;

-- un singur „ultimul punct folosit” per user, provider și tip (0 = easybox, 1 = Sameday Point)
CREATE UNIQUE INDEX "UserOohLocation_userId_courierProvider_oohType_key" ON "UserOohLocation"("userId", "courierProvider", "oohType");

-- AddForeignKey
ALTER TABLE "UserAddress" ADD CONSTRAINT "UserAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOohLocation" ADD CONSTRAINT "UserOohLocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
