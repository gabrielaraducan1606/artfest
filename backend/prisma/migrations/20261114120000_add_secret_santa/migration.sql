-- Secret Santa Artfest (schimb de cadouri între vânzători). Doar adăugiri:
-- 3 tabele noi + 1 enum. Nu modifică tabele sau date existente.

-- CreateEnum
CREATE TYPE "SecretSantaEditionStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'DRAWN');

-- CreateTable
CREATE TABLE "SecretSantaEdition" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "status" "SecretSantaEditionStatus" NOT NULL DEFAULT 'DRAFT',
    "registrationClosesAt" TIMESTAMP(3),
    "shipByAt" TIMESTAMP(3),
    "drawnAt" TIMESTAMP(3),
    "drawnById" TEXT,
    "personalDataPurgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecretSantaEdition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretSantaParticipant" (
    "id" TEXT NOT NULL,
    "editionId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeName" VARCHAR(200) NOT NULL,
    "recipientName" VARCHAR(160) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "phone" VARCHAR(40) NOT NULL,
    "county" VARCHAR(60) NOT NULL,
    "city" VARCHAR(120) NOT NULL,
    "address" VARCHAR(300) NOT NULL,
    "postalCode" VARCHAR(12) NOT NULL,
    "preferences" VARCHAR(500),
    "dataNoticeAcceptedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecretSantaParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretSantaAssignment" (
    "id" TEXT NOT NULL,
    "editionId" TEXT NOT NULL,
    "giverId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "emailSentAt" TIMESTAMP(3),
    "emailError" VARCHAR(80),
    "awb" VARCHAR(60),
    "courierName" VARCHAR(80),
    "shippedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecretSantaAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SecretSantaEdition_key_key" ON "SecretSantaEdition"("key");

-- CreateIndex
CREATE INDEX "SecretSantaEdition_status_createdAt_idx" ON "SecretSantaEdition"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SecretSantaParticipant_vendorId_idx" ON "SecretSantaParticipant"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "SecretSantaParticipant_editionId_vendorId_key" ON "SecretSantaParticipant"("editionId", "vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "SecretSantaAssignment_giverId_key" ON "SecretSantaAssignment"("giverId");

-- CreateIndex
CREATE UNIQUE INDEX "SecretSantaAssignment_receiverId_key" ON "SecretSantaAssignment"("receiverId");

-- CreateIndex
CREATE INDEX "SecretSantaAssignment_editionId_idx" ON "SecretSantaAssignment"("editionId");

-- AddForeignKey
ALTER TABLE "SecretSantaParticipant" ADD CONSTRAINT "SecretSantaParticipant_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "SecretSantaEdition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretSantaParticipant" ADD CONSTRAINT "SecretSantaParticipant_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretSantaAssignment" ADD CONSTRAINT "SecretSantaAssignment_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "SecretSantaEdition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretSantaAssignment" ADD CONSTRAINT "SecretSantaAssignment_giverId_fkey" FOREIGN KEY ("giverId") REFERENCES "SecretSantaParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretSantaAssignment" ADD CONSTRAINT "SecretSantaAssignment_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "SecretSantaParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Nimeni nu se poate extrage pe sine (garanție în baza de date)
ALTER TABLE "SecretSantaAssignment" ADD CONSTRAINT "SecretSantaAssignment_not_self_chk" CHECK ("giverId" <> "receiverId");
