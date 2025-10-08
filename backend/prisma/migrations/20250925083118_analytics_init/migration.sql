-- CreateEnum
CREATE TYPE "public"."EventType" AS ENUM ('PAGEVIEW', 'CTA_CLICK', 'MESSAGE');

-- CreateTable
CREATE TABLE "public"."Visitor" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "productId" TEXT,
    "source" TEXT,
    "ref" TEXT,
    "city" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "note" TEXT,
    "contacted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Visitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Event" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "type" "public"."EventType" NOT NULL,
    "pageUrl" TEXT,
    "ctaLabel" TEXT,
    "referrer" TEXT,
    "sessionId" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Search" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Search_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Visitor_vendorId_createdAt_idx" ON "public"."Visitor"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "Visitor_vendorId_contacted_idx" ON "public"."Visitor"("vendorId", "contacted");

-- CreateIndex
CREATE INDEX "Event_vendorId_createdAt_idx" ON "public"."Event"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "Event_vendorId_type_createdAt_idx" ON "public"."Event"("vendorId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "Event_vendorId_pageUrl_idx" ON "public"."Event"("vendorId", "pageUrl");

-- CreateIndex
CREATE INDEX "Search_vendorId_createdAt_idx" ON "public"."Search"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "Search_vendorId_query_idx" ON "public"."Search"("vendorId", "query");

-- AddForeignKey
ALTER TABLE "public"."Visitor" ADD CONSTRAINT "Visitor_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "public"."Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Event" ADD CONSTRAINT "Event_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "public"."Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Search" ADD CONSTRAINT "Search_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "public"."Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
