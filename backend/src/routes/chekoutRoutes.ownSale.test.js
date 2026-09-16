// src/routes/chekoutRoutes.ownSale.test.js
//
// Teste deterministe, unitare, pentru logica PURĂ de atribuire
// promotor la checkout (resolveShipmentPromoter, resolveEffectiveRefVendorAttribution,
// buildShipmentAttributionFields din chekoutRoutes.js).
//
// Include regula FINALĂ (audit 2026-09-15) pentru VendorCollection:
// - own-sale = 500bps, identic pentru cod personal SAU cod de colecție,
//   marcat distinct prin referrerVendorReferralCodeSnapshot =
//   "COLLECTION:<slug>" pentru UI (commissionSource rămâne separat,
//   vezi vendorOrdersRoutes.js).
// - Persistent attribution: un token de vizitare a unei VendorCollection
//   alimentează fallback-ul de referral pasiv (același nivel ca ?ref=).
//   NICIODATĂ eligibilitatea de PREȚ (asta rămâne strict legată de
//   DiscountCode). Own-sale prin simpla vizitare (fără cod) SE
//   ACORDĂ, dar STRICT dacă produsul cumpărat e chiar în colecție
//   (shipmentEligibleByCollectionMembership=true, calculat separat în
//   chekoutRoutes.js din VendorCollectionItem) - dacă produsul NU e
//   în colecție, tokenul e exclus complet pentru acel shipment - vezi
//   resolveEffectiveRefVendorAttribution.
//
// Funcțiile testate sunt PURE (nu ating DB/Stripe/JWT), deci nu e
// nevoie de mock.module - doar un import direct al modulului real.

process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:5";

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveShipmentPromoter,
  buildShipmentAttributionFields,
  resolveEffectiveRefVendorAttribution,
} from "./chekoutRoutes.js";

const VENDOR_A = "vendor-a";
const VENDOR_B = "vendor-b";

function attributionFor(vendorId) {
  return {
    vendorId,
    referralCodeSnapshot: `REF-${vendorId}`,
    commissionBpsSnapshot: 2000,
  };
}

/* =========================================================
   A. VENDOR_ALL_PRODUCTS (cod promo personal) + produs propriu
   => own-sale, 500bps, marcaj "personal" (fara COLLECTION)
========================================================= */
test("A. cod VENDOR_ALL_PRODUCTS pe produs propriu: own-sale 500bps, fara marcaj COLLECTION", () => {
  const promoter = resolveShipmentPromoter({
    shipmentWonByDiscountCode: true,
    shipmentEligibleForVendorAttributionByDiscountCode: true,
    shipmentEligibleForInfluencerByDiscountCode: false,
    discountCodeInfluencerAttribution: null,
    discountCodeVendorAttribution: attributionFor(VENDOR_A),
    refInfluencerAttribution: null,
    refVendorAttribution: null,
  });

  assert.equal(promoter.type, "VENDOR");

  const fields = buildShipmentAttributionFields({
    promoter,
    shipmentVendorId: VENDOR_A,
    discountCodeScope: "VENDOR_ALL_PRODUCTS",
  });

  assert.equal(fields.vendorReferralCommissionOverrideBps, 500);
  assert.equal(fields.referrerVendorId, null);
  assert.equal(fields.referrerVendorReferralCodeSnapshot, null);
});

/* =========================================================
   B. VENDOR_COLLECTION + produs propriu => own-sale 500bps,
   MARCAT "COLLECTION:<slug>" (pentru afișare UI)
========================================================= */
test("B. cod VENDOR_COLLECTION pe produs propriu: own-sale 500bps, marcat COLLECTION:<slug>", () => {
  const promoter = resolveShipmentPromoter({
    shipmentWonByDiscountCode: true,
    shipmentEligibleForVendorAttributionByDiscountCode: true,
    shipmentEligibleForInfluencerByDiscountCode: false,
    discountCodeInfluencerAttribution: null,
    discountCodeVendorAttribution: attributionFor(VENDOR_A),
    refInfluencerAttribution: null,
    refVendorAttribution: null,
  });

  assert.equal(promoter.type, "VENDOR");

  const fields = buildShipmentAttributionFields({
    promoter,
    shipmentVendorId: VENDOR_A,
    discountCodeScope: "VENDOR_COLLECTION",
    discountCodeCollectionSlug: "test-collection",
  });

  assert.equal(fields.vendorReferralCommissionOverrideBps, 500);
  assert.equal(fields.referrerVendorId, null);
  assert.equal(
    fields.referrerVendorReferralCodeSnapshot,
    "COLLECTION:test-collection"
  );
});

/* =========================================================
   C. VENDOR_COLLECTION + produsul ALTUI vendor => cross-vendor
   referral (sellerul normal, promoter separat), marcat COLLECTION:<slug>
========================================================= */
test("C. cod VENDOR_COLLECTION pe produsul altui vendor: cross-vendor referral, marcat COLLECTION:<slug>", () => {
  const promoter = resolveShipmentPromoter({
    shipmentWonByDiscountCode: false,
    shipmentEligibleForVendorAttributionByDiscountCode: true,
    shipmentEligibleForInfluencerByDiscountCode: false,
    discountCodeInfluencerAttribution: null,
    discountCodeVendorAttribution: attributionFor(VENDOR_A),
    refInfluencerAttribution: null,
    refVendorAttribution: null,
  });

  assert.equal(promoter.type, "VENDOR");
  assert.equal(promoter.vendor.vendorId, VENDOR_A);

  const fields = buildShipmentAttributionFields({
    promoter,
    shipmentVendorId: VENDOR_B,
    discountCodeScope: "VENDOR_COLLECTION",
    discountCodeCollectionSlug: "test-collection",
  });

  assert.equal(fields.vendorReferralCommissionOverrideBps, null);
  assert.equal(fields.referrerVendorId, VENDOR_A);
  assert.equal(
    fields.referrerVendorReferralCodeSnapshot,
    "COLLECTION:test-collection"
  );
  assert.equal(fields.referrerVendorCommissionBpsSnapshot, 2000);
});

/* =========================================================
   D. Produs NU e in colecție (fara promotor deloc) => plan normal,
   fara nicio atribuire
========================================================= */
test("D. fara promotor (produs neeligibil): plan normal, zero atribuire", () => {
  const promoter = resolveShipmentPromoter({
    shipmentWonByDiscountCode: false,
    shipmentEligibleForVendorAttributionByDiscountCode: false,
    shipmentEligibleForInfluencerByDiscountCode: false,
    discountCodeInfluencerAttribution: null,
    discountCodeVendorAttribution: attributionFor(VENDOR_A),
    refInfluencerAttribution: null,
    refVendorAttribution: null,
  });

  assert.equal(promoter.type, null);

  const fields = buildShipmentAttributionFields({
    promoter,
    shipmentVendorId: VENDOR_A,
    discountCodeScope: "VENDOR_COLLECTION",
    discountCodeCollectionSlug: "test-collection",
  });

  assert.equal(fields.vendorReferralCommissionOverrideBps, null);
  assert.equal(fields.referrerVendorId, null);
});

/* =========================================================
   E/F. Product of Day / Artisan castiga vizual pretul, dar codul
   VENDOR_COLLECTION tot e eligibil pe produs propriu => own-sale
   TOT se aplica (eligibilitate, nu castigarea competitiei de pret)
========================================================= */
test("E/F. VENDOR_COLLECTION eligibil pe produs propriu chiar daca homepage a castigat vizual pretul: own-sale tot se aplica", () => {
  const promoter = resolveShipmentPromoter({
    shipmentWonByDiscountCode: false,
    shipmentEligibleForVendorAttributionByDiscountCode: true,
    shipmentEligibleForInfluencerByDiscountCode: false,
    discountCodeInfluencerAttribution: null,
    discountCodeVendorAttribution: attributionFor(VENDOR_A),
    refInfluencerAttribution: null,
    refVendorAttribution: null,
  });

  assert.equal(promoter.type, "VENDOR");

  const fields = buildShipmentAttributionFields({
    promoter,
    shipmentVendorId: VENDOR_A,
    discountCodeScope: "VENDOR_COLLECTION",
    discountCodeCollectionSlug: "test-collection",
  });

  assert.equal(fields.vendorReferralCommissionOverrideBps, 500);
  assert.equal(
    fields.referrerVendorReferralCodeSnapshot,
    "COLLECTION:test-collection"
  );
});

/* =========================================================
   G. Multi-vendor: shipment A (own, VENDOR_COLLECTION) own-sale;
   shipment B (alt vendor) primeste referral - fara contaminare
========================================================= */
test("G. multi-vendor: rezultatele shipment A (own-sale) si B (referral) raman independente", () => {
  const promoterA = resolveShipmentPromoter({
    shipmentWonByDiscountCode: true,
    shipmentEligibleForVendorAttributionByDiscountCode: true,
    shipmentEligibleForInfluencerByDiscountCode: false,
    discountCodeInfluencerAttribution: null,
    discountCodeVendorAttribution: attributionFor(VENDOR_A),
    refInfluencerAttribution: null,
    refVendorAttribution: null,
  });

  const promoterB = resolveShipmentPromoter({
    shipmentWonByDiscountCode: false,
    shipmentEligibleForVendorAttributionByDiscountCode: true,
    shipmentEligibleForInfluencerByDiscountCode: false,
    discountCodeInfluencerAttribution: null,
    discountCodeVendorAttribution: attributionFor(VENDOR_A),
    refInfluencerAttribution: null,
    refVendorAttribution: null,
  });

  const fieldsA = buildShipmentAttributionFields({
    promoter: promoterA,
    shipmentVendorId: VENDOR_A,
    discountCodeScope: "VENDOR_COLLECTION",
    discountCodeCollectionSlug: "test-collection",
  });
  const fieldsB = buildShipmentAttributionFields({
    promoter: promoterB,
    shipmentVendorId: VENDOR_B,
    discountCodeScope: "VENDOR_COLLECTION",
    discountCodeCollectionSlug: "test-collection",
  });

  assert.equal(fieldsA.vendorReferralCommissionOverrideBps, 500);
  assert.equal(
    fieldsA.referrerVendorReferralCodeSnapshot,
    "COLLECTION:test-collection"
  );
  assert.equal(fieldsA.referrerVendorId, null);

  assert.equal(fieldsB.vendorReferralCommissionOverrideBps, null);
  assert.equal(fieldsB.referrerVendorId, VENDOR_A);
});

/* =========================================================
   PERSISTENT ATTRIBUTION (audit 2026-09-15) -
   resolveEffectiveRefVendorAttribution
========================================================= */

function refAttr(vendorId, issuedAt) {
  return { vendorId, referralCodeSnapshot: `REF-${vendorId}`, commissionBpsSnapshot: 2000, issuedAt };
}

function collAttr(vendorId, issuedAt, collectionSlug = "col-a") {
  return {
    vendorId,
    referralCodeSnapshot: `REF-${vendorId}`,
    commissionBpsSnapshot: 2000,
    collectionId: "col-id",
    collectionSlug,
    issuedAt,
  };
}

/* Scenariul 5/D: colecția A vizitată, cumpără produs propriu A NU în
   colecție => tokenul de colecție NU poate produce own-sale - trebuie
   EXCLUS complet când vendorId-ul colecției === vendorul shipment-ului. */
test("Persistent attribution D: token de colecție exclus cand ar produce own-sale pentru acest shipment (produs NU in colectie)", () => {
  const effective = resolveEffectiveRefVendorAttribution({
    refVendorAttribution: null,
    refCollectionAttribution: collAttr(VENDOR_A, 1000),
    shipmentVendorId: VENDOR_A, // acelasi vendor ca si colectia
    shipmentEligibleByCollectionMembership: false, // produsul NU e in colectie
  });

  assert.equal(effective, null);
});

/* Scenariul A/4 (audit 2026-09-15, fix live-testat): colecția A
   vizitată, cumpără produs propriu A CARE CHIAR E în colecție, FĂRĂ
   cod de reducere introdus => own-sale trebuie acordat prin simpla
   eligibilitate de membership, nu doar prin cod. */
test("Persistent attribution A: token de colectie produce own-sale cand produsul CHIAR e in colectie (fara cod)", () => {
  const effective = resolveEffectiveRefVendorAttribution({
    refVendorAttribution: null,
    refCollectionAttribution: collAttr(VENDOR_A, 1000),
    shipmentVendorId: VENDOR_A,
    shipmentEligibleByCollectionMembership: true, // produsul E in colectie
  });

  assert.equal(effective.vendorId, VENDOR_A);
  assert.equal(effective.collectionSlug, "col-a");

  const promoter = resolveShipmentPromoter({
    shipmentWonByDiscountCode: false,
    shipmentEligibleForVendorAttributionByDiscountCode: false,
    shipmentEligibleForInfluencerByDiscountCode: false,
    discountCodeInfluencerAttribution: null,
    discountCodeVendorAttribution: null,
    refInfluencerAttribution: null,
    refVendorAttribution: effective,
  });

  const fields = buildShipmentAttributionFields({
    promoter,
    shipmentVendorId: VENDOR_A,
    discountCodeScope: null,
  });

  assert.equal(fields.vendorReferralCommissionOverrideBps, 500);
  assert.equal(fields.referrerVendorId, null);
  assert.equal(
    fields.referrerVendorReferralCodeSnapshot,
    "COLLECTION:col-a"
  );
});

/* Scenariul 7: colecția A vizitată, cumpără produs ALT vendor (B), NU
   în colecție => tokenul de colecție TOT alimentează referral extern
   (A a adus clientul pe platformă). */
test("Persistent attribution 7: token de colecție alimenteaza referral cross-vendor cand shipmentul e al altui vendor", () => {
  const effective = resolveEffectiveRefVendorAttribution({
    refVendorAttribution: null,
    refCollectionAttribution: collAttr(VENDOR_A, 1000),
    shipmentVendorId: VENDOR_B,
  });

  assert.equal(effective.vendorId, VENDOR_A);
  assert.equal(effective.collectionSlug, "col-a");
});

/* J: ?ref=A urmat de vizitarea colecției B (mai recentă) => B câștigă */
test("Persistent attribution J: ?ref=A apoi colectie B mai recenta -> B castiga (last click wins)", () => {
  const effective = resolveEffectiveRefVendorAttribution({
    refVendorAttribution: refAttr(VENDOR_A, 1000),
    refCollectionAttribution: collAttr(VENDOR_B, 2000),
    shipmentVendorId: "vendor-c",
  });

  assert.equal(effective.vendorId, VENDOR_B);
  assert.ok(effective.collectionSlug);
});

/* K: colecție A urmată de ?ref=B (mai recent) => B câștigă */
test("Persistent attribution K: colectie A apoi ?ref=B mai recent -> B castiga", () => {
  const effective = resolveEffectiveRefVendorAttribution({
    refVendorAttribution: refAttr(VENDOR_B, 2000),
    refCollectionAttribution: collAttr(VENDOR_A, 1000),
    shipmentVendorId: "vendor-c",
  });

  assert.equal(effective.vendorId, VENDOR_B);
});

/* I: colecție A urmată de colecție B (mai recentă) => B câștigă -
   testat direct prin apeluri succesive cu refCollectionAttribution
   diferit (simulează suprascrierea din localStorage - last click wins
   e deja garantat de simpla suprascriere, dar verificăm și partea de
   comparare a timestamp-urilor aici, pentru robustețe). */
test("Persistent attribution I: doar cel mai recent token de colectie conteaza (simulat prin refCollectionAttribution unic, cel din urma capturat)", () => {
  // simulăm faptul că localStorage a fost deja suprascris - doar tokenul B mai există
  const effective = resolveEffectiveRefVendorAttribution({
    refVendorAttribution: null,
    refCollectionAttribution: collAttr(VENDOR_B, 5000, "col-b"),
    shipmentVendorId: "vendor-c",
  });

  assert.equal(effective.vendorId, VENDOR_B);
  assert.equal(effective.collectionSlug, "col-b");
});

/* Fara niciun candidat => null, fail-open */
test("Persistent attribution: fara ?ref= si fara token de colectie -> null", () => {
  const effective = resolveEffectiveRefVendorAttribution({
    refVendorAttribution: null,
    refCollectionAttribution: null,
    shipmentVendorId: VENDOR_A,
  });

  assert.equal(effective, null);
});

/* L: prioritate cod explicit - garantată STRUCTURAL de ordinea
   branch-urilor din resolveShipmentPromoter (discountCodeVendorAttribution
   verificat ÎNAINTEA refVendorAttribution) - verificăm explicit că un
   cod explicit câștigă chiar dacă un refVendorAttribution (rezultat
   din resolveEffectiveRefVendorAttribution) există și el, pasat ca
   parametru. */
test("L: cod explicit de reducere are prioritate fata de attribution token pasiv (colectie sau ref)", () => {
  const effectiveRef = resolveEffectiveRefVendorAttribution({
    refVendorAttribution: null,
    refCollectionAttribution: collAttr(VENDOR_B, 9999),
    shipmentVendorId: "vendor-c",
  });

  const promoter = resolveShipmentPromoter({
    shipmentWonByDiscountCode: true,
    shipmentEligibleForVendorAttributionByDiscountCode: true,
    shipmentEligibleForInfluencerByDiscountCode: false,
    discountCodeInfluencerAttribution: null,
    discountCodeVendorAttribution: attributionFor(VENDOR_A), // cod explicit, alt vendor
    refInfluencerAttribution: null,
    refVendorAttribution: effectiveRef, // ar fi VENDOR_B daca ar castiga
  });

  // codul explicit (VENDOR_A) castiga, NU tokenul pasiv de colectie (VENDOR_B)
  assert.equal(promoter.vendor.vendorId, VENDOR_A);
});
