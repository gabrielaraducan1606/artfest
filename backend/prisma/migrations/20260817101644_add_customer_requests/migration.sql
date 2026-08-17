-- CreateEnum
CREATE TYPE "CustomerRequestStatus" AS ENUM ('OPEN', 'ACCEPTED', 'CLOSED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CustomerRequestOfferStatus" AS ENUM ('SENT', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CustomerRequestBudgetType" AS ENUM ('TOTAL', 'PER_ITEM');

-- CreateTable
CREATE TABLE "CustomerRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" VARCHAR(180) NOT NULL,
    "description" TEXT NOT NULL,
    "category" VARCHAR(64),
    "quantity" INTEGER,
    "budgetMinCents" INTEGER,
    "budgetMaxCents" INTEGER,
    "budgetType" "CustomerRequestBudgetType",
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "deliveryDeadline" TIMESTAMP(3),
    "city" TEXT,
    "citySlug" VARCHAR(64),
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "details" JSONB,
    "status" "CustomerRequestStatus" NOT NULL DEFAULT 'OPEN',
    "expiresAt" TIMESTAMP(3),
    "acceptedOfferId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerRequestOffer" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "status" "CustomerRequestOfferStatus" NOT NULL DEFAULT 'SENT',
    "unitPriceCents" INTEGER,
    "totalPriceCents" INTEGER,
    "shippingCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "productionDays" INTEGER,
    "estimatedDelivery" TIMESTAMP(3),
    "message" TEXT,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerRequestOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerRequest_acceptedOfferId_key" ON "CustomerRequest"("acceptedOfferId");

-- CreateIndex
CREATE INDEX "CustomerRequest_userId_createdAt_idx" ON "CustomerRequest"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerRequest_status_createdAt_idx" ON "CustomerRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerRequest_category_status_createdAt_idx" ON "CustomerRequest"("category", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerRequest_citySlug_status_createdAt_idx" ON "CustomerRequest"("citySlug", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerRequest_expiresAt_idx" ON "CustomerRequest"("expiresAt");

-- CreateIndex
CREATE INDEX "CustomerRequestOffer_requestId_createdAt_idx" ON "CustomerRequestOffer"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerRequestOffer_vendorId_createdAt_idx" ON "CustomerRequestOffer"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerRequestOffer_status_idx" ON "CustomerRequestOffer"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerRequestOffer_requestId_vendorId_key" ON "CustomerRequestOffer"("requestId", "vendorId");

-- AddForeignKey
ALTER TABLE "CustomerRequest" ADD CONSTRAINT "CustomerRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRequest" ADD CONSTRAINT "CustomerRequest_acceptedOfferId_fkey" FOREIGN KEY ("acceptedOfferId") REFERENCES "CustomerRequestOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRequestOffer" ADD CONSTRAINT "CustomerRequestOffer_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CustomerRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRequestOffer" ADD CONSTRAINT "CustomerRequestOffer_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
