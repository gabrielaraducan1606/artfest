/*
  Migrare:
  - vendor collections
  - vendor referral attribution
  - vendor referral earnings
  - vendor discount-code collection scope

  IMPORTANT:
  VendorCostItem.name este redenumit în label.
  VendorCostItem.currency este păstrat.
  Nu pierdem datele existente.
*/


-- =========================================================
-- ENUMURI
-- =========================================================

CREATE TYPE "VendorReferralEarningType" AS ENUM ('SALE', 'REFUND');


-- =========================================================
-- DISCOUNT CODE SCOPE
-- =========================================================

ALTER TYPE "DiscountCodeScope"
ADD VALUE 'VENDOR_COLLECTION';


-- =========================================================
-- VENDOR COST ITEM
-- =========================================================

-- Eliminăm indexurile vechi care folosesc structura precedentă.
DROP INDEX "public"."VendorCostItem_vendorId_name_idx";

DROP INDEX "public"."VendorCostItem_vendorId_type_isActive_idx";


-- Păstrăm datele existente:
-- name -> label
--
-- NU ștergem currency.
ALTER TABLE "VendorCostItem"
RENAME COLUMN "name" TO "label";


-- =========================================================
-- DISCOUNT CODE
-- =========================================================

ALTER TABLE "DiscountCode"
ADD COLUMN "vendorCollectionId" TEXT;


-- =========================================================
-- SHIPMENT - VENDOR REFERRAL
-- =========================================================

ALTER TABLE "Shipment"
ADD COLUMN "referrerVendorAttributedAt" TIMESTAMP(3),
ADD COLUMN "referrerVendorCommissionBpsSnapshot" INTEGER,
ADD COLUMN "referrerVendorId" TEXT,
ADD COLUMN "referrerVendorReferralCodeSnapshot" TEXT,
ADD COLUMN "vendorReferralCommissionOverrideBps" INTEGER,
ADD COLUMN "vendorReferralOwnSaleAttributedAt" TIMESTAMP(3);


-- =========================================================
-- VENDOR - REFERRAL SETTINGS
-- =========================================================

ALTER TABLE "Vendor"
ADD COLUMN "referralCode" TEXT,
ADD COLUMN "referralCommissionBps" INTEGER NOT NULL DEFAULT 0;


-- =========================================================
-- VENDOR COLLECTION
-- =========================================================

CREATE TABLE "VendorCollection" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(180) NOT NULL,
    "description" TEXT,
    "coverImage" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sort" VARCHAR(32) NOT NULL DEFAULT 'curated',
    "visits" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorCollection_pkey"
    PRIMARY KEY ("id")
);


-- =========================================================
-- VENDOR COLLECTION ITEM
-- =========================================================

CREATE TABLE "VendorCollectionItem" (
    "collectionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "position" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorCollectionItem_pkey"
    PRIMARY KEY ("collectionId", "productId")
);


-- =========================================================
-- VENDOR REFERRAL CLICK
-- =========================================================

CREATE TABLE "VendorReferralClick" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "sessionId" TEXT,
    "pageUrl" TEXT,
    "referrer" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorReferralClick_pkey"
    PRIMARY KEY ("id")
);


-- =========================================================
-- VENDOR REFERRAL EARNING ENTRY
-- =========================================================

CREATE TABLE "VendorReferralEarningEntry" (
    "id" TEXT NOT NULL,
    "referrerVendorId" TEXT NOT NULL,
    "shipmentId" TEXT,
    "orderId" TEXT,
    "type" "VendorReferralEarningType" NOT NULL DEFAULT 'SALE',
    "commissionBpsSnapshot" INTEGER NOT NULL,
    "currency" VARCHAR(8) NOT NULL DEFAULT 'RON',
    "eligibleItemsNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "artfestCommissionNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "earningNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta" JSONB,

    CONSTRAINT "VendorReferralEarningEntry_pkey"
    PRIMARY KEY ("id")
);


-- =========================================================
-- INDEXURI VENDOR COLLECTION
-- =========================================================

CREATE UNIQUE INDEX "VendorCollection_slug_key"
ON "VendorCollection"("slug");

CREATE INDEX "VendorCollection_vendorId_createdAt_idx"
ON "VendorCollection"("vendorId", "createdAt");

CREATE INDEX "VendorCollection_vendorId_isActive_idx"
ON "VendorCollection"("vendorId", "isActive");

CREATE INDEX "VendorCollection_isActive_createdAt_idx"
ON "VendorCollection"("isActive", "createdAt");


-- =========================================================
-- INDEXURI VENDOR COLLECTION ITEM
-- =========================================================

CREATE INDEX "VendorCollectionItem_productId_idx"
ON "VendorCollectionItem"("productId");

CREATE INDEX "VendorCollectionItem_collectionId_position_idx"
ON "VendorCollectionItem"("collectionId", "position");


-- =========================================================
-- INDEXURI VENDOR REFERRAL CLICK
-- =========================================================

CREATE INDEX "VendorReferralClick_vendorId_createdAt_idx"
ON "VendorReferralClick"("vendorId", "createdAt");

CREATE INDEX "VendorReferralClick_sessionId_idx"
ON "VendorReferralClick"("sessionId");

CREATE INDEX "VendorReferralClick_createdAt_idx"
ON "VendorReferralClick"("createdAt");


-- =========================================================
-- INDEXURI VENDOR REFERRAL EARNINGS
-- =========================================================

CREATE UNIQUE INDEX "VendorReferralEarningEntry_shipmentId_key"
ON "VendorReferralEarningEntry"("shipmentId");

CREATE INDEX "VendorReferralEarningEntry_referrerVendorId_occurredAt_idx"
ON "VendorReferralEarningEntry"("referrerVendorId", "occurredAt");

CREATE INDEX "VendorReferralEarningEntry_orderId_idx"
ON "VendorReferralEarningEntry"("orderId");


-- =========================================================
-- INDEXURI DISCOUNT CODE
-- =========================================================

CREATE INDEX "DiscountCode_vendorCollectionId_idx"
ON "DiscountCode"("vendorCollectionId");


-- =========================================================
-- INDEXURI SHIPMENT REFERRER VENDOR
-- =========================================================

CREATE INDEX "Shipment_referrerVendorId_idx"
ON "Shipment"("referrerVendorId");

CREATE INDEX "Shipment_referrerVendorId_createdAt_idx"
ON "Shipment"("referrerVendorId", "createdAt");


-- =========================================================
-- INDEXURI VENDOR REFERRAL
-- =========================================================

CREATE UNIQUE INDEX "Vendor_referralCode_key"
ON "Vendor"("referralCode");


-- =========================================================
-- INDEXURI VENDOR COST ITEM
-- =========================================================

CREATE INDEX "VendorCostItem_vendorId_type_idx"
ON "VendorCostItem"("vendorId", "type");

CREATE INDEX "VendorCostItem_vendorId_isActive_idx"
ON "VendorCostItem"("vendorId", "isActive");

CREATE INDEX "VendorCostItem_vendorId_createdAt_idx"
ON "VendorCostItem"("vendorId", "createdAt");


-- =========================================================
-- FOREIGN KEYS - VENDOR COLLECTION
-- =========================================================

ALTER TABLE "VendorCollection"
ADD CONSTRAINT "VendorCollection_vendorId_fkey"
FOREIGN KEY ("vendorId")
REFERENCES "Vendor"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;


ALTER TABLE "VendorCollectionItem"
ADD CONSTRAINT "VendorCollectionItem_collectionId_fkey"
FOREIGN KEY ("collectionId")
REFERENCES "VendorCollection"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;


ALTER TABLE "VendorCollectionItem"
ADD CONSTRAINT "VendorCollectionItem_productId_fkey"
FOREIGN KEY ("productId")
REFERENCES "Product"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;


-- =========================================================
-- FOREIGN KEY - VENDOR REFERRAL CLICK
-- =========================================================

ALTER TABLE "VendorReferralClick"
ADD CONSTRAINT "VendorReferralClick_vendorId_fkey"
FOREIGN KEY ("vendorId")
REFERENCES "Vendor"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;


-- =========================================================
-- FOREIGN KEYS - VENDOR REFERRAL EARNINGS
-- =========================================================

ALTER TABLE "VendorReferralEarningEntry"
ADD CONSTRAINT "VendorReferralEarningEntry_referrerVendorId_fkey"
FOREIGN KEY ("referrerVendorId")
REFERENCES "Vendor"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;


ALTER TABLE "VendorReferralEarningEntry"
ADD CONSTRAINT "VendorReferralEarningEntry_shipmentId_fkey"
FOREIGN KEY ("shipmentId")
REFERENCES "Shipment"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;


ALTER TABLE "VendorReferralEarningEntry"
ADD CONSTRAINT "VendorReferralEarningEntry_orderId_fkey"
FOREIGN KEY ("orderId")
REFERENCES "Order"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;


-- =========================================================
-- FOREIGN KEY - SHIPMENT REFERRER VENDOR
-- =========================================================

ALTER TABLE "Shipment"
ADD CONSTRAINT "Shipment_referrerVendorId_fkey"
FOREIGN KEY ("referrerVendorId")
REFERENCES "Vendor"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;


-- =========================================================
-- FOREIGN KEY - DISCOUNT CODE -> VENDOR COLLECTION
-- =========================================================

ALTER TABLE "DiscountCode"
ADD CONSTRAINT "DiscountCode_vendorCollectionId_fkey"
FOREIGN KEY ("vendorCollectionId")
REFERENCES "VendorCollection"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;