-- Târg Artfest: produse PROPRII Artfest (stoc propriu) + magazinul ales pentru produsele manuale.
--
--  1. Linia de inventar poate aparține Artfest: registrationId și vendorId devin opționale,
--     dar EXCLUSIV împreună (AFII_owner_chk): participant = ambele setate; Artfest = ambele NULL.
--     O linie Artfest nu are produs online, magazin sau rezervare online (AFII_artfest_owned_chk).
--  2. serviceId: magazinul participantului ales pentru un produs manual (opțional).
--  3. Mișcările de stoc, evenimentele, liniile de vânzare și de retur: vendorId opțional
--     (NULL = linie Artfest).
--  4. Vânzarea unui produs Artfest = integral Artfest (AFSL_artfest_owned_chk):
--     commissionBps 10000, commissionCents = lineGrossCents, vendorNetCents 0, fără reducere
--     finanțată de Artfest; CHECK-urile financiare existente (AFSL_vendorNet_chk etc.) rămân
--     valabile neschimbate. Retururile unei astfel de linii nu afectează niciun vânzător.
--
-- Doar relaxări + CHECK-uri noi: toate rândurile existente au vendorId / registrationId
-- setate, deci trec automat. Nicio dată nu se modifică.

-- 1-2. linia de inventar
ALTER TABLE "ArtfestFairInventoryItem"
  ALTER COLUMN "registrationId" DROP NOT NULL,
  ALTER COLUMN "vendorId" DROP NOT NULL,
  ADD COLUMN "serviceId" TEXT;

ALTER TABLE "ArtfestFairInventoryItem"
  ADD CONSTRAINT "ArtfestFairInventoryItem_serviceId_fkey"
    FOREIGN KEY ("serviceId") REFERENCES "VendorService"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ArtfestFairInventoryItem_serviceId_idx" ON "ArtfestFairInventoryItem"("serviceId");

ALTER TABLE "ArtfestFairInventoryItem"
  ADD CONSTRAINT "AFII_owner_chk"
    CHECK (("registrationId" IS NULL) = ("vendorId" IS NULL)),
  ADD CONSTRAINT "AFII_artfest_owned_chk"
    CHECK (
      "vendorId" IS NOT NULL
      OR ("productId" IS NULL AND "serviceId" IS NULL AND "onlineReservationMode" = 'NONE')
    );

-- 3. mișcări, evenimente, vânzări, retururi
ALTER TABLE "ArtfestFairStockMovement" ALTER COLUMN "vendorId" DROP NOT NULL;
ALTER TABLE "ArtfestFairInventoryEvent" ALTER COLUMN "vendorId" DROP NOT NULL;
ALTER TABLE "ArtfestFairSaleLine" ALTER COLUMN "vendorId" DROP NOT NULL;
ALTER TABLE "ArtfestFairSaleReturnLine" ALTER COLUMN "vendorId" DROP NOT NULL;

-- 4. produs Artfest: încasarea e integral Artfest; vânzătorul nu primește nimic
ALTER TABLE "ArtfestFairSaleLine"
  ADD CONSTRAINT "AFSL_artfest_owned_chk"
    CHECK (
      "vendorId" IS NOT NULL
      OR (
        "commissionBps" = 10000
        AND "commissionCents" = "lineGrossCents"
        AND "vendorNetCents" = 0
        AND "artfestFundedDiscountCents" = 0
        AND "pricingModel" = 'COMMISSION'
        AND "productId" IS NULL
      )
    );

ALTER TABLE "ArtfestFairSaleReturnLine"
  ADD CONSTRAINT "AFSRL_artfest_owned_chk"
    CHECK (
      "vendorId" IS NOT NULL
      OR ("vendorNetReversedCents" = 0 AND "artfestFundedReversedCents" = 0)
    );
