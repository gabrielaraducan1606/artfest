-- Cereri de ofertă trimise de vizitatori fără cont (ex. QR de pe flyere).
--
-- Doar schimbări ADITIVE, compatibile cu datele existente:
--  1. Trei tabele noi: CustomerRequestGuest (vizitatorul, fără parolă - NU e un
--     cont), CustomerRequestPending (cererea neconfirmată prin email, nevăzută
--     public) și CustomerRequestGuestToken (doar sha256 al linkurilor din email).
--  2. CustomerRequest: coloana nouă "guestId" (NULL pentru toate cererile
--     existente) + "userId" devine opțional (DROP NOT NULL = doar metadate,
--     fără rescrierea tabelei). Nicio valoare existentă nu se modifică.
--  3. CHECK: fiecare cerere are un proprietar (userId sau guestId). Adăugat
--     NOT VALID (fără scanare sub lock exclusiv), apoi validat separat; toate
--     cererile existente au userId, deci trec.

-- 1. vizitatori
CREATE TABLE "CustomerRequestGuest" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "displayName" VARCHAR(60) NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "accessVersion" INTEGER NOT NULL DEFAULT 0,
    "linkedUserId" TEXT,
    "linkedAt" TIMESTAMP(3),
    "lastOfferEmailAt" TIMESTAMP(3),
    "lastAccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerRequestGuest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerRequestGuest_email_key" ON "CustomerRequestGuest"("email");
CREATE INDEX "CustomerRequestGuest_linkedUserId_idx" ON "CustomerRequestGuest"("linkedUserId");

ALTER TABLE "CustomerRequestGuest"
    ADD CONSTRAINT "CustomerRequestGuest_linkedUserId_fkey"
    FOREIGN KEY ("linkedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. cereri neconfirmate
CREATE TABLE "CustomerRequestPending" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "displayName" VARCHAR(60) NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" VARCHAR(64) NOT NULL,
    "wantsAccount" BOOLEAN NOT NULL DEFAULT false,
    "consentVersion" VARCHAR(40) NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "ipHash" VARCHAR(64),
    "source" VARCHAR(40),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastEmailAt" TIMESTAMP(3),
    "emailCount" INTEGER NOT NULL DEFAULT 1,
    "publishedRequestId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerRequestPending_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerRequestPending_publishedRequestId_key" ON "CustomerRequestPending"("publishedRequestId");
CREATE INDEX "CustomerRequestPending_guestId_createdAt_idx" ON "CustomerRequestPending"("guestId", "createdAt");
CREATE INDEX "CustomerRequestPending_guestId_payloadHash_idx" ON "CustomerRequestPending"("guestId", "payloadHash");
CREATE INDEX "CustomerRequestPending_ipHash_createdAt_idx" ON "CustomerRequestPending"("ipHash", "createdAt");
CREATE INDEX "CustomerRequestPending_expiresAt_idx" ON "CustomerRequestPending"("expiresAt");

ALTER TABLE "CustomerRequestPending"
    ADD CONSTRAINT "CustomerRequestPending_guestId_fkey"
    FOREIGN KEY ("guestId") REFERENCES "CustomerRequestGuest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. linkuri din email (doar hash)
CREATE TABLE "CustomerRequestGuestToken" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "pendingId" TEXT,
    "purpose" VARCHAR(16) NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerRequestGuestToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerRequestGuestToken_tokenHash_key" ON "CustomerRequestGuestToken"("tokenHash");
CREATE INDEX "CustomerRequestGuestToken_guestId_purpose_createdAt_idx" ON "CustomerRequestGuestToken"("guestId", "purpose", "createdAt");
CREATE INDEX "CustomerRequestGuestToken_pendingId_idx" ON "CustomerRequestGuestToken"("pendingId");
CREATE INDEX "CustomerRequestGuestToken_expiresAt_idx" ON "CustomerRequestGuestToken"("expiresAt");

ALTER TABLE "CustomerRequestGuestToken"
    ADD CONSTRAINT "CustomerRequestGuestToken_guestId_fkey"
    FOREIGN KEY ("guestId") REFERENCES "CustomerRequestGuest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerRequestGuestToken"
    ADD CONSTRAINT "CustomerRequestGuestToken_pendingId_fkey"
    FOREIGN KEY ("pendingId") REFERENCES "CustomerRequestPending"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. CustomerRequest: guestId nou + userId opțional (valorile existente rămân)
ALTER TABLE "CustomerRequest" ADD COLUMN "guestId" TEXT;
ALTER TABLE "CustomerRequest" ALTER COLUMN "userId" DROP NOT NULL;

CREATE INDEX "CustomerRequest_guestId_createdAt_idx" ON "CustomerRequest"("guestId", "createdAt");

ALTER TABLE "CustomerRequest"
    ADD CONSTRAINT "CustomerRequest_guestId_fkey"
    FOREIGN KEY ("guestId") REFERENCES "CustomerRequestGuest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerRequest"
    ADD CONSTRAINT "CustomerRequest_owner_chk"
    CHECK ("userId" IS NOT NULL OR "guestId" IS NOT NULL) NOT VALID;

ALTER TABLE "CustomerRequest" VALIDATE CONSTRAINT "CustomerRequest_owner_chk";
