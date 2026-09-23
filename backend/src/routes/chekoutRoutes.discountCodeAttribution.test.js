// src/routes/chekoutRoutes.discountCodeAttribution.test.js
//
// Teste pentru fluxul "Elimină codul, dar păstrează atribuirea"
// (discountCodeAttribution hint, vezi frontend/src/utils/discountCodeAttribution.js
// + resolveDiscountCodeAttributionHintValidation din chekoutRoutes.js).
//
// resolveDiscountCodeAttributionHintValidation() e testată izolat,
// cu un `db` FAKE injectat (mirror al pattern-ului deja folosit de
// discountCodeValidation.js - "Accept opțional `db`... permite
// reutilizare identică... fără cod duplicat") - nu atinge Postgres
// real, nu are nevoie de DATABASE_URL valid.
//
// resolveShipmentPromoter (NEMODIFICATĂ de acest fix) e reutilizată
// direct din chekoutRoutes.ownSale.test.js - aici verificăm STRICT
// că un candidat de atribuire produs din hint (nu din codul activ)
// se comportă IDENTIC în precedență (regula existentă, neschimbată).

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveDiscountCodeAttributionHintValidation,
  resolveShipmentPromoter,
} from "./chekoutRoutes.js";

const CART_ITEMS = [
  {
    product: {
      id: "prod-1",
      priceCents: 10000,
      service: { vendorId: "vendor-a" },
    },
    qty: 1,
  },
];

/*
 * Fabrică minimă de `db` fake - implementează STRICT metodele
 * atinse de validateDiscountCode() pentru scope ALL_PRODUCTS (cel
 * mai simplu, fără DiscountCodeProduct/CollectionItem).
 */
function fakeDb({ discountCode = null, redemptionsCount = 0 } = {}) {
  return {
    discountCode: {
      findUnique: async () => discountCode,
    },
    discountCodeRedemption: {
      count: async () => redemptionsCount,
    },
  };
}

function baseInfluencerCode(overrides = {}) {
  return {
    id: "dc-influencer-1",
    code: "INFCODE10",
    status: "ACTIVE",
    isActive: true,
    startsAt: null,
    endsAt: null,
    currency: "RON",
    usageLimit: null,
    usageLimitPerUser: null,
    usedCount: 0,
    scope: "ALL_PRODUCTS",
    discountType: "PERCENT",
    discountPercent: 10,
    discountAmountCents: null,
    maxDiscountCents: null,
    minimumOrderCents: null,
    influencerId: "influencer-1",
    vendorId: null,
    ...overrides,
  };
}

function baseVendorCode(overrides = {}) {
  return {
    ...baseInfluencerCode({ influencerId: null, vendorId: "vendor-x" }),
    id: "dc-vendor-1",
    code: "VENDCODE10",
    ...overrides,
  };
}

/* =========================================================
   H. Fara hint => comportamentul actual (null), fara nicio
   interogare in DB (short-circuit).
========================================================= */
test("H. fara attribution hint: rezultat null, DB nu e interogat", async () => {
  const throwingDb = {
    discountCode: {
      findUnique: async () => {
        throw new Error("nu ar trebui apelat fara hint");
      },
    },
  };

  const result = await resolveDiscountCodeAttributionHintValidation({
    hint: null,
    cartItems: CART_ITEMS,
    currency: "RON",
    db: throwingDb,
  });

  assert.equal(result, null);
});

/* =========================================================
   A. Cod influencer valid, eliminat din UI (hint prezent) =>
   backend il revalideaza si confirma influencerId real din DB.
========================================================= */
test("A. cod influencer valid (doar hint, codul eliminat): revalidat cu succes, influencerId confirmat din DB", async () => {
  const db = fakeDb({ discountCode: baseInfluencerCode() });

  const result = await resolveDiscountCodeAttributionHintValidation({
    hint: { discountCodeId: "dc-influencer-1", code: "INFCODE10" },
    cartItems: CART_ITEMS,
    currency: "RON",
    db,
  });

  assert.ok(result?.valid);
  assert.equal(result.discountCode.influencerId, "influencer-1");
  assert.ok(result.eligibleProductIds.has("prod-1"));
});

/* =========================================================
   B. Cod vendor valid, eliminat din UI => mirror identic cu A,
   pentru vendorId.
========================================================= */
test("B. cod vendor valid (doar hint, codul eliminat): revalidat cu succes, vendorId confirmat din DB", async () => {
  const db = fakeDb({ discountCode: baseVendorCode() });

  const result = await resolveDiscountCodeAttributionHintValidation({
    hint: { discountCodeId: "dc-vendor-1", code: "VENDCODE10" },
    cartItems: CART_ITEMS,
    currency: "RON",
    db,
  });

  assert.ok(result?.valid);
  assert.equal(result.discountCode.vendorId, "vendor-x");
  assert.equal(result.discountCode.influencerId, null);
});

/* =========================================================
   D. Hint manipulat in frontend (discountCodeId nu corespunde
   codului real) => backend NU accepta, revine null (fail-open,
   nu blocheaza comanda - doar ignora atribuirea).
========================================================= */
test("D. hint manipulat (discountCodeId nu corespunde codului): respins, null", async () => {
  const db = fakeDb({ discountCode: baseInfluencerCode() });

  const result = await resolveDiscountCodeAttributionHintValidation({
    hint: {
      discountCodeId: "cu-totul-alt-id",
      code: "INFCODE10",
    },
    cartItems: CART_ITEMS,
    currency: "RON",
    db,
  });

  assert.equal(result, null);
});

/* =========================================================
   D bis. Hint cu un code text valid, dar codul real din DB nu
   mai apartine niciunui influencer/vendor (owner sters/schimbat
   intre timp) - validarea tot reuseste (codul e activ), dar
   apelantul (chekoutRoutes.js) nu va construi nicio atribuire,
   pentru ca influencerId/vendorId vin STRICT din DB, nu din hint.
========================================================= */
test("D bis. hint cu code valid, dar codul real nu are influencerId/vendorId in DB: validare ok, fara owner fals", async () => {
  const db = fakeDb({
    discountCode: baseInfluencerCode({ influencerId: null, vendorId: null }),
  });

  const result = await resolveDiscountCodeAttributionHintValidation({
    // hint-ul "pretinde" un influencerId - dar functia nu-l citeste
    // niciodata de aici, doar code/discountCodeId.
    hint: {
      discountCodeId: "dc-influencer-1",
      code: "INFCODE10",
      influencerId: "influencer-FALS",
    },
    cartItems: CART_ITEMS,
    currency: "RON",
    db,
  });

  assert.ok(result?.valid);
  assert.equal(result.discountCode.influencerId, null);
  assert.equal(result.discountCode.vendorId, null);
});

/* =========================================================
   E. Cod expirat intre validare si checkout => atribuire
   ignorata (fail-open), fara eroare aruncata.
========================================================= */
test("E. cod expirat intre timp: atribuire ignorata, null, fara exceptie", async () => {
  const db = fakeDb({
    discountCode: baseInfluencerCode({
      endsAt: new Date(Date.now() - 60_000), // expirat acum 1 minut
    }),
  });

  const result = await resolveDiscountCodeAttributionHintValidation({
    hint: { discountCodeId: "dc-influencer-1", code: "INFCODE10" },
    cartItems: CART_ITEMS,
    currency: "RON",
    db,
  });

  assert.equal(result, null);
});

/* =========================================================
   E bis. Cod inexistent (sters) => null, fara exceptie.
========================================================= */
test("E bis. cod inexistent in DB: null, fara exceptie", async () => {
  const db = fakeDb({ discountCode: null });

  const result = await resolveDiscountCodeAttributionHintValidation({
    hint: { discountCodeId: "dc-x", code: "NUEXISTA" },
    cartItems: CART_ITEMS,
    currency: "RON",
    db,
  });

  assert.equal(result, null);
});

/* =========================================================
   C. Precedenta NESCHIMBATA: eligibilitate prin cod (indiferent
   daca vine din codul activ sau din hint) castiga ATRIBUIREA chiar
   daca o alta promotie a castigat vizual pretul
   (shipmentWonByDiscountCode=false) - identic pentru INFLUENCER,
   mirror al testelor deja existente pentru VENDOR in
   chekoutRoutes.ownSale.test.js. resolveShipmentPromoter NU a fost
   modificata de acest fix.
========================================================= */
test("C. influencer eligibil prin cod, dar o alta promotie castiga vizual pretul: atribuirea INFLUENCER tot se aplica", () => {
  const promoter = resolveShipmentPromoter({
    shipmentWonByDiscountCode: false, // Product of Day a castigat vizual
    shipmentEligibleForVendorAttributionByDiscountCode: false,
    shipmentEligibleForInfluencerByDiscountCode: true, // dar codul tot e eligibil
    discountCodeInfluencerAttribution: {
      influencerId: "influencer-1",
      referralCodeSnapshot: "REF-influencer-1",
      commissionBpsSnapshot: 1000,
    },
    discountCodeVendorAttribution: null,
    refInfluencerAttribution: null,
    refVendorAttribution: null,
  });

  assert.equal(promoter.type, "INFLUENCER");
  assert.equal(promoter.influencer.influencerId, "influencer-1");
});

/* =========================================================
   Precedenta: atribuire prin cod (live SAU hint) castiga fata de
   ?ref= - regula existenta, neschimbata (verificam explicit ca
   introducerea hint-ului nu rastoarna asta).
========================================================= */
test("Precedenta neschimbata: atribuire prin cod (influencer) castiga fata de ?ref= vendor", () => {
  const promoter = resolveShipmentPromoter({
    shipmentWonByDiscountCode: false,
    shipmentEligibleForVendorAttributionByDiscountCode: false,
    shipmentEligibleForInfluencerByDiscountCode: true,
    discountCodeInfluencerAttribution: {
      influencerId: "influencer-1",
      referralCodeSnapshot: "REF-influencer-1",
      commissionBpsSnapshot: 1000,
    },
    discountCodeVendorAttribution: null,
    refInfluencerAttribution: null,
    refVendorAttribution: {
      vendorId: "vendor-ref",
      referralCodeSnapshot: "REF-vendor-ref",
      commissionBpsSnapshot: 2000,
    },
  });

  assert.equal(promoter.type, "INFLUENCER");
  assert.equal(promoter.influencer.influencerId, "influencer-1");
});
