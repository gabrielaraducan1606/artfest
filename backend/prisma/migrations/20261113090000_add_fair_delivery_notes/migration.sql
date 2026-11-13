-- Avize de însoțire a mărfii pentru Târgul Artfest (cod 14-3-6A). Doar adăugiri:
-- tabele noi + coloana opțională ArtfestFair.deliveryAddress. Nu modifică date existente.

-- CreateEnum
CREATE TYPE "ArtfestFairDeliveryNoteStatus" AS ENUM ('ISSUED', 'CANCELLED');

-- AlterTable
ALTER TABLE "ArtfestFair" ADD COLUMN     "deliveryAddress" VARCHAR(500);

-- CreateTable
CREATE TABLE "ArtfestDeliveryNoteSeries" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "series" VARCHAR(16) NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtfestDeliveryNoteSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtfestFairDeliveryNote" (
    "id" TEXT NOT NULL,
    "fairId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "series" VARCHAR(16) NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "ArtfestFairDeliveryNoteStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT,
    "idempotencyKey" VARCHAR(80) NOT NULL,
    "issuerSnapshot" JSONB NOT NULL,
    "recipientSnapshot" JSONB NOT NULL,
    "destination" VARCHAR(500) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "withoutInvoice" BOOLEAN NOT NULL DEFAULT false,
    "withoutValues" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "delegateName" VARCHAR(160),
    "delegateIdSeries" VARCHAR(10),
    "delegateIdNumber" VARCHAR(20),
    "delegateIdIssuedBy" VARCHAR(120),
    "vehicle" VARCHAR(80),
    "shippedAt" TIMESTAMP(3),
    "totalValueCents" INTEGER,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'RON',
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "replacesNoteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtfestFairDeliveryNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtfestFairDeliveryNoteLine" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "titleSnapshot" VARCHAR(200) NOT NULL,
    "variantLabel" VARCHAR(200),
    "internalCode" VARCHAR(20) NOT NULL,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "unit" VARCHAR(16) NOT NULL DEFAULT 'buc',
    "quantity" INTEGER NOT NULL,
    "unitPriceCents" INTEGER,
    "valueCents" INTEGER,

    CONSTRAINT "ArtfestFairDeliveryNoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArtfestDeliveryNoteSeries_vendorId_series_key" ON "ArtfestDeliveryNoteSeries"("vendorId", "series");

-- CreateIndex
CREATE UNIQUE INDEX "ArtfestFairDeliveryNote_replacesNoteId_key" ON "ArtfestFairDeliveryNote"("replacesNoteId");

-- CreateIndex
CREATE INDEX "ArtfestFairDeliveryNote_registrationId_status_issuedAt_idx" ON "ArtfestFairDeliveryNote"("registrationId", "status", "issuedAt");

-- CreateIndex
CREATE INDEX "ArtfestFairDeliveryNote_fairId_issuedAt_idx" ON "ArtfestFairDeliveryNote"("fairId", "issuedAt");

-- CreateIndex
CREATE INDEX "ArtfestFairDeliveryNote_issuedById_idx" ON "ArtfestFairDeliveryNote"("issuedById");

-- CreateIndex
CREATE INDEX "ArtfestFairDeliveryNote_cancelledById_idx" ON "ArtfestFairDeliveryNote"("cancelledById");

-- CreateIndex
CREATE UNIQUE INDEX "ArtfestFairDeliveryNote_vendorId_series_number_key" ON "ArtfestFairDeliveryNote"("vendorId", "series", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ArtfestFairDeliveryNote_vendorId_idempotencyKey_key" ON "ArtfestFairDeliveryNote"("vendorId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ArtfestFairDeliveryNoteLine_inventoryItemId_idx" ON "ArtfestFairDeliveryNoteLine"("inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtfestFairDeliveryNoteLine_noteId_position_key" ON "ArtfestFairDeliveryNoteLine"("noteId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ArtfestFairDeliveryNoteLine_noteId_inventoryItemId_key" ON "ArtfestFairDeliveryNoteLine"("noteId", "inventoryItemId");

-- AddForeignKey
ALTER TABLE "ArtfestDeliveryNoteSeries" ADD CONSTRAINT "ArtfestDeliveryNoteSeries_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairDeliveryNote" ADD CONSTRAINT "ArtfestFairDeliveryNote_fairId_fkey" FOREIGN KEY ("fairId") REFERENCES "ArtfestFair"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairDeliveryNote" ADD CONSTRAINT "ArtfestFairDeliveryNote_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "ArtfestFairRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairDeliveryNote" ADD CONSTRAINT "ArtfestFairDeliveryNote_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairDeliveryNote" ADD CONSTRAINT "ArtfestFairDeliveryNote_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairDeliveryNote" ADD CONSTRAINT "ArtfestFairDeliveryNote_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairDeliveryNote" ADD CONSTRAINT "ArtfestFairDeliveryNote_replacesNoteId_fkey" FOREIGN KEY ("replacesNoteId") REFERENCES "ArtfestFairDeliveryNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairDeliveryNoteLine" ADD CONSTRAINT "ArtfestFairDeliveryNoteLine_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "ArtfestFairDeliveryNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtfestFairDeliveryNoteLine" ADD CONSTRAINT "ArtfestFairDeliveryNoteLine_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "ArtfestFairInventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Consistență (în afara schemei Prisma, ca la inventarul târgului)
ALTER TABLE "ArtfestDeliveryNoteSeries" ADD CONSTRAINT "ArtfestDeliveryNoteSeries_nextNumber_check" CHECK ("nextNumber" >= 1);
ALTER TABLE "ArtfestFairDeliveryNote" ADD CONSTRAINT "ArtfestFairDeliveryNote_number_check" CHECK ("number" >= 1);
ALTER TABLE "ArtfestFairDeliveryNote" ADD CONSTRAINT "ArtfestFairDeliveryNote_cancel_check"
  CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL));
ALTER TABLE "ArtfestFairDeliveryNote" ADD CONSTRAINT "ArtfestFairDeliveryNote_not_self_check"
  CHECK ("replacesNoteId" IS NULL OR "replacesNoteId" <> "id");
ALTER TABLE "ArtfestFairDeliveryNoteLine" ADD CONSTRAINT "ArtfestFairDeliveryNoteLine_quantity_check" CHECK ("quantity" >= 1);
ALTER TABLE "ArtfestFairDeliveryNoteLine" ADD CONSTRAINT "ArtfestFairDeliveryNoteLine_price_check"
  CHECK (("unitPriceCents" IS NULL OR "unitPriceCents" >= 0) AND ("valueCents" IS NULL OR "valueCents" >= 0));
