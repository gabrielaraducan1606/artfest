-- CreateTable
CREATE TABLE "public"."ServiceProfile" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "logoUrl" TEXT,
    "coverUrl" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "socials" JSONB,
    "address" TEXT,
    "delivery" TEXT[],
    "about" TEXT,
    "city" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "interval" TEXT NOT NULL DEFAULT 'month',
    "features" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."VendorSubscription" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endAt" TIMESTAMP(3),
    "extRef" TEXT,
    "meta" JSONB,

    CONSTRAINT "VendorSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceProfile_serviceId_key" ON "public"."ServiceProfile"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_code_key" ON "public"."SubscriptionPlan"("code");

-- CreateIndex
CREATE INDEX "VendorSubscription_vendorId_status_idx" ON "public"."VendorSubscription"("vendorId", "status");

-- AddForeignKey
ALTER TABLE "public"."ServiceProfile" ADD CONSTRAINT "ServiceProfile_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "public"."VendorService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VendorSubscription" ADD CONSTRAINT "VendorSubscription_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "public"."Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VendorSubscription" ADD CONSTRAINT "VendorSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "public"."SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
