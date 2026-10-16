-- =====================================================================
-- Târg Artfest - anulare participare + retur către vendor: CHECK-uri și backfill.
-- Migrație separată de 20261014094332_add_artfest_fair_cancellation_returns,
-- deoarece valoarea nouă de enum 'CANCELLED' nu poate fi folosită în aceeași
-- tranzacție în care a fost adăugată (ALTER TYPE ... ADD VALUE).
-- Strict aditivă: doar ADD CONSTRAINT și INSERT în tabelul nou de evenimente.
-- =====================================================================

-- ArtfestFair: numerotarea retururilor către vendor
ALTER TABLE "ArtfestFair"
  ADD CONSTRAINT "ArtfestFair_vendorReturnNumbering_chk"
    CHECK ("nextVendorReturnNumber" >= 1);

-- ArtfestFairRegistration: anularea există doar împreună cu statusul CANCELLED
ALTER TABLE "ArtfestFairRegistration"
  ADD CONSTRAINT "AFR_cancelled_fields_chk"
    CHECK (
      "status" <> 'CANCELLED'
      OR (
        "cancelledAt" IS NOT NULL
        AND "cancellationCause" IS NOT NULL
        AND "cancellationReason" IS NOT NULL
        AND char_length(btrim("cancellationReason")) >= 3
      )
    ),
  ADD CONSTRAINT "AFR_not_cancelled_fields_chk"
    CHECK (
      "status" = 'CANCELLED'
      OR (
        "cancelledAt" IS NULL
        AND "cancellationCause" IS NULL
        AND "cancellationReason" IS NULL
        AND "cancellationMessageForVendor" IS NULL
        AND "cancellationGoodsShipped" IS NULL
      )
    );

-- ArtfestFairRegistrationEvent: anularea are mereu motiv intern
ALTER TABLE "ArtfestFairRegistrationEvent"
  ADD CONSTRAINT "AFRE_cancelled_reason_chk"
    CHECK ("type" <> 'CANCELLED' OR ("reason" IS NOT NULL AND char_length(btrim("reason")) >= 3));

-- ArtfestFairReturn: ciclul de viață PREPARING -> SHIPPED -> CONFIRMED[_WITH_DIFFERENCES] | CANCELLED
ALTER TABLE "ArtfestFairReturn"
  ADD CONSTRAINT "AFRet_number_chk"
    CHECK ("number" >= 1),
  ADD CONSTRAINT "AFRet_shippingCost_chk"
    CHECK ("shippingCostCents" IS NULL OR "shippingCostCents" >= 0),
  ADD CONSTRAINT "AFRet_preparing_chk"
    CHECK ("status" <> 'PREPARING' OR ("shippedAt" IS NULL AND "confirmedAt" IS NULL AND "cancelledAt" IS NULL)),
  ADD CONSTRAINT "AFRet_shipped_chk"
    CHECK ("status" NOT IN ('SHIPPED', 'CONFIRMED', 'CONFIRMED_WITH_DIFFERENCES') OR "shippedAt" IS NOT NULL),
  ADD CONSTRAINT "AFRet_confirmed_chk"
    CHECK (("status" IN ('CONFIRMED', 'CONFIRMED_WITH_DIFFERENCES')) = ("confirmedAt" IS NOT NULL)),
  ADD CONSTRAINT "AFRet_confirmed_after_shipped_chk"
    CHECK ("confirmedAt" IS NULL OR "confirmedAt" >= "shippedAt"),
  -- confirmarea în numele vendorului: doar după minimum 7 zile de la SHIPPED, cu motiv
  ADD CONSTRAINT "AFRet_confirmedByAdmin_chk"
    CHECK (
      "confirmedByAdmin" = false
      OR (
        "confirmedAt" IS NOT NULL
        AND "confirmedAt" >= "shippedAt" + INTERVAL '7 days'
        AND "confirmationNote" IS NOT NULL
        AND char_length(btrim("confirmationNote")) >= 3
      )
    ),
  -- anularea returului doar înainte de expediere
  ADD CONSTRAINT "AFRet_cancelled_chk"
    CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL)),
  ADD CONSTRAINT "AFRet_cancelled_not_shipped_chk"
    CHECK ("status" <> 'CANCELLED' OR "shippedAt" IS NULL);

-- ArtfestFairReturnLine: cantități
ALTER TABLE "ArtfestFairReturnLine"
  ADD CONSTRAINT "AFRetL_qty_nonneg_chk"
    CHECK ("qtyFromStock" >= 0 AND "qtyRejected" >= 0),
  ADD CONSTRAINT "AFRetL_qty_positive_chk"
    CHECK ("qtyFromStock" + "qtyRejected" >= 1),
  ADD CONSTRAINT "AFRetL_received_chk"
    CHECK ("vendorReceivedQty" IS NULL OR ("vendorReceivedQty" >= 0 AND "vendorReceivedQty" <= "qtyFromStock" + "qtyRejected")),
  -- nu se poate cere readăugarea online a mai mult decât s-a primit fizic
  ADD CONSTRAINT "AFRetL_restore_request_chk"
    CHECK ("restoreOnlineQty" IS NULL OR ("vendorReceivedQty" IS NOT NULL AND "restoreOnlineQty" >= 0 AND "restoreOnlineQty" <= "vendorReceivedQty")),
  ADD CONSTRAINT "AFRetL_restored_chk"
    CHECK ("onlineRestoredQty" >= 0 AND "onlineRestoredQty" <= COALESCE("restoreOnlineQty", 0));

-- ArtfestFairStockMovement: legătura cu returul doar pentru mișcările de retur către vendor
ALTER TABLE "ArtfestFairStockMovement"
  ADD CONSTRAINT "AFSM_returnLine_type_chk"
    CHECK ("returnLineId" IS NULL OR "type" IN ('RETURNED_TO_VENDOR', 'REJECTED_RETURNED_TO_VENDOR'));

-- =====================================================================
-- Backfill: istoricul înscrierilor existente, derivat din câmpurile curente.
-- Istoricul anterior (de ex. respingere urmată de reaprobare) nu mai poate fi
-- reconstituit; evenimentele sunt marcate cu metadata.backfilled = true.
-- =====================================================================

INSERT INTO "ArtfestFairRegistrationEvent"
  ("id", "registrationId", "fairId", "vendorId", "type", "actorUserId", "after", "metadata", "createdAt")
SELECT gen_random_uuid()::text, r."id", r."fairId", r."vendorId", 'SUBMITTED', r."submittedByUserId",
       jsonb_build_object('status', 'SUBMITTED'), jsonb_build_object('backfilled', true), r."submittedAt"
FROM "ArtfestFairRegistration" r;

INSERT INTO "ArtfestFairRegistrationEvent"
  ("id", "registrationId", "fairId", "vendorId", "type", "actorUserId", "reason", "before", "after", "metadata", "createdAt")
SELECT gen_random_uuid()::text, r."id", r."fairId", r."vendorId",
       CASE r."status" WHEN 'APPROVED' THEN 'APPROVED'::"ArtfestFairRegistrationEventType"
                       ELSE 'REJECTED'::"ArtfestFairRegistrationEventType" END,
       r."reviewedById",
       CASE WHEN r."status" = 'REJECTED' THEN r."rejectionReason" END,
       jsonb_build_object('status', 'SUBMITTED'), jsonb_build_object('status', r."status"::text),
       jsonb_build_object('backfilled', true), r."reviewedAt"
FROM "ArtfestFairRegistration" r
WHERE r."status" IN ('APPROVED', 'REJECTED') AND r."reviewedAt" IS NOT NULL;

INSERT INTO "ArtfestFairRegistrationEvent"
  ("id", "registrationId", "fairId", "vendorId", "type", "actorUserId", "after", "metadata", "createdAt")
SELECT gen_random_uuid()::text, r."id", r."fairId", r."vendorId", 'WITHDRAWN', NULL,
       jsonb_build_object('status', 'WITHDRAWN'), jsonb_build_object('backfilled', true), r."withdrawnAt"
FROM "ArtfestFairRegistration" r
WHERE r."status" = 'WITHDRAWN' AND r."withdrawnAt" IS NOT NULL;
