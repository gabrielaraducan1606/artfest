// src/services/discountCodeValidation.vendorCollection.test.js
//
// Teste deterministe, unitare, pentru garda de finanțare din
// buildDiscountCodePromotionsByProductId (audit 2026-09-15): o
// reducere de colecție finanțată de VENDOR nu poate fi aplicată la
// preț pe produsul unui ALT vendor (ar reduce netul vendorului
// greșit, fără mecanism de redirecționare în schema actuală).
//
// Funcție PURĂ (nu atinge DB) - import direct.

process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:5";

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildDiscountCodePromotionsByProductId } from "./discountCodeValidation.js";

const VENDOR_A = "vendor-a";
const VENDOR_B = "vendor-b";

function makeValidation({ scope, fundingSource, vendorId = VENDOR_A }) {
  return {
    valid: true,
    discountCode: {
      id: "code-1",
      code: "COLECTIE10",
      vendorId,
      scope,
      fundingSource,
      platformFundingBps: fundingSource === "PLATFORM" ? 10000 : 0,
      vendorFundingBps: fundingSource === "VENDOR" ? 10000 : 0,
    },
    eligibleProductIds: new Set(["prod-own", "prod-other"]),
    effectiveDiscountPercent: 10,
  };
}

const cartItems = [
  { product: { id: "prod-own", service: { vendorId: VENDOR_A } } },
  { product: { id: "prod-other", service: { vendorId: VENDOR_B } } },
];

test("VENDOR_COLLECTION + fundingSource VENDOR: discount aplicat doar produsului propriu, NU produsului altui vendor", () => {
  const validation = makeValidation({
    scope: "VENDOR_COLLECTION",
    fundingSource: "VENDOR",
  });

  const map = buildDiscountCodePromotionsByProductId(validation, {
    cartItems,
  });

  assert.equal(map.has("prod-own"), true);
  assert.equal(map.has("prod-other"), false);
});

test("VENDOR_COLLECTION + fundingSource PLATFORM: discount aplicat AMBELOR produse (Artfest suportă, fără risc pentru niciun vendor)", () => {
  const validation = makeValidation({
    scope: "VENDOR_COLLECTION",
    fundingSource: "PLATFORM",
  });

  const map = buildDiscountCodePromotionsByProductId(validation, {
    cartItems,
  });

  assert.equal(map.has("prod-own"), true);
  assert.equal(map.has("prod-other"), true);
});

test("VENDOR_ALL_PRODUCTS + fundingSource VENDOR: gardă NU se aplică (scope diferit) - neschimbat", () => {
  const validation = makeValidation({
    scope: "VENDOR_ALL_PRODUCTS",
    fundingSource: "VENDOR",
  });

  const map = buildDiscountCodePromotionsByProductId(validation, {
    cartItems,
  });

  assert.equal(map.has("prod-own"), true);
  assert.equal(map.has("prod-other"), true);
});

test("VENDOR_COLLECTION + fundingSource VENDOR, fără cartItems (apelant care nu le trimite): fail-safe, NU aplică discount nicăieri", () => {
  const validation = makeValidation({
    scope: "VENDOR_COLLECTION",
    fundingSource: "VENDOR",
  });

  const map = buildDiscountCodePromotionsByProductId(validation);

  assert.equal(map.size, 0);
});


/* =========================================================
   STATUS EFECTIV (deriveDiscountCodeStatus) - sursa unică pentru
   effectiveStatus (listări vendor / influencer / admin) și pentru
   validateDiscountCode. Aceleași reguli, același verdict.
========================================================= */

const { deriveDiscountCodeStatus, validateDiscountCode, DISCOUNT_CODE_EFFECTIVE_STATUS: S } = await import("./discountCodeValidation.js");

const NOW = new Date("2026-10-05T06:30:00.000Z"); // 09:30 București
const minutes = (m) => new Date(NOW.getTime() + m * 60000);

const base = (extra = {}) => ({
  id: "dc-1",
  code: "TEST10",
  ownerType: "VENDOR",
  vendorId: "vendor-a",
  influencerId: null,
  scope: "ALL_PRODUCTS",
  vendorCollectionId: null,
  influencerCollectionId: null,
  discountType: "PERCENT",
  discountPercent: 10,
  discountAmountCents: null,
  currency: "RON",
  minimumOrderCents: null,
  maxDiscountCents: null,
  fundingSource: "PLATFORM",
  status: "ACTIVE",
  isActive: true,
  startsAt: null,
  endsAt: null,
  usageLimit: null,
  usageLimitPerUser: null,
  usedCount: 0,
  ...extra,
});

/* ---------- regulile de bază ---------- */

test("programat: startsAt în viitor -> SCHEDULED", () => {
  assert.equal(deriveDiscountCodeStatus(base({ startsAt: minutes(60) }), NOW), S.SCHEDULED);
});

test("activ: acum între startsAt și endsAt -> ACTIVE", () => {
  assert.equal(deriveDiscountCodeStatus(base({ startsAt: minutes(-60), endsAt: minutes(60) }), NOW), S.ACTIVE);
});

test("expirat: endsAt trecut -> EXPIRED (chiar dacă isActive=true, cazul din DEV)", () => {
  assert.equal(deriveDiscountCodeStatus(base({ startsAt: minutes(-60 * 24 * 20), endsAt: minutes(-60 * 24 * 9) }), NOW), S.EXPIRED);
});

test("inactiv: isActive=false sau status DISABLED -> DISABLED (are prioritate)", () => {
  assert.equal(deriveDiscountCodeStatus(base({ isActive: false }), NOW), S.DISABLED);
  assert.equal(deriveDiscountCodeStatus(base({ status: "DISABLED" }), NOW), S.DISABLED);
  assert.equal(deriveDiscountCodeStatus(base({ isActive: false, endsAt: minutes(-10) }), NOW), S.DISABLED);
  assert.equal(deriveDiscountCodeStatus(null, NOW), S.DISABLED);
});

test("epuizat: usedCount >= usageLimit -> EXHAUSTED; sub limită -> ACTIVE", () => {
  assert.equal(deriveDiscountCodeStatus(base({ usageLimit: 5, usedCount: 5 }), NOW), S.EXHAUSTED);
  assert.equal(deriveDiscountCodeStatus(base({ usageLimit: 5, usedCount: 7 }), NOW), S.EXHAUSTED);
  assert.equal(deriveDiscountCodeStatus(base({ usageLimit: 5, usedCount: 4 }), NOW), S.ACTIVE);
  // ordinea validării: expirat înaintea epuizat
  assert.equal(deriveDiscountCodeStatus(base({ usageLimit: 1, usedCount: 1, endsAt: minutes(-1) }), NOW), S.EXPIRED);
});

test("fără endsAt / fără startsAt -> ACTIVE dacă isActive=true", () => {
  assert.equal(deriveDiscountCodeStatus(base(), NOW), S.ACTIVE);
  assert.equal(deriveDiscountCodeStatus(base({ startsAt: minutes(-1) }), NOW), S.ACTIVE);
});

test("boundary timezone: comparație pe instanța UTC, endsAt == acum -> EXPIRED; o secundă înainte -> ACTIVE", () => {
  // „până la 05.10.2026, 09:30” ora României = 06:30Z
  const endsAtLocal930 = new Date("2026-10-05T06:30:00.000Z");
  assert.equal(deriveDiscountCodeStatus(base({ endsAt: endsAtLocal930 }), NOW), S.EXPIRED);
  assert.equal(deriveDiscountCodeStatus(base({ endsAt: endsAtLocal930 }), new Date(NOW.getTime() - 1000)), S.ACTIVE);

  // aceleași momente ca string ISO (ca din JSON) sau cu offset +03:00 -> același rezultat
  assert.equal(deriveDiscountCodeStatus(base({ endsAt: "2026-10-05T09:30:00+03:00" }), NOW), S.EXPIRED);
  assert.equal(deriveDiscountCodeStatus(base({ startsAt: "2026-10-05T09:31:00+03:00" }), NOW), S.SCHEDULED);
  assert.equal(deriveDiscountCodeStatus(base({ startsAt: "2026-10-05T09:30:00+03:00" }), NOW), S.ACTIVE, "startsAt == acum -> deja activ");
});

/* ---------- aceeași regulă pentru toate tipurile de cod ---------- */

const KINDS = {
  "vendor direct": { ownerType: "VENDOR", vendorId: "vendor-a", scope: "VENDOR_ALL_PRODUCTS", fundingSource: "VENDOR" },
  "vendor collection": { ownerType: "VENDOR", vendorId: "vendor-a", scope: "VENDOR_COLLECTION", vendorCollectionId: "vcol-a", fundingSource: "VENDOR" },
  influencer: { ownerType: "INFLUENCER", vendorId: null, influencerId: "inf-1", scope: "ALL_PRODUCTS", fundingSource: "PLATFORM" },
  "general Artfest": { ownerType: "PLATFORM", vendorId: null, scope: "ALL_PRODUCTS", fundingSource: "PLATFORM" },
};

const CASES = {
  SCHEDULED: { startsAt: minutes(60) },
  ACTIVE: { startsAt: minutes(-60), endsAt: minutes(60) },
  EXPIRED: { endsAt: minutes(-60) },
  DISABLED: { isActive: false },
  EXHAUSTED: { usageLimit: 3, usedCount: 3 },
};

// verdictul validării pentru fiecare status efectiv
const EXPECTED_VALIDATION = {
  SCHEDULED: "discount_code_not_started",
  ACTIVE: null,
  EXPIRED: "discount_code_expired",
  DISABLED: "discount_code_inactive",
  EXHAUSTED: "discount_code_usage_limit_reached",
};

// DB minim pentru validateDiscountCode (doar citiri)
function fakeDb(discountCode) {
  return {
    discountCode: { findUnique: async ({ where }) => (where.code === discountCode.code ? { ...discountCode } : null) },
    discountCodeRedemption: { count: async () => 0 },
    discountCodeProduct: { findMany: async () => [] },
    influencerCollectionItem: { findMany: async () => [] },
    vendorCollectionItem: { findMany: async () => [{ productId: "p-a1" }] },
  };
}

const CART = [{ productId: "p-a1", qty: 1, configurationKey: "default", product: { id: "p-a1", priceCents: 10000, service: { vendorId: "vendor-a" } } }];

for (const [kind, kindFields] of Object.entries(KINDS)) {
  test(`${kind}: effectiveStatus și validateDiscountCode dau același verdict pe toate cele 5 statusuri`, async () => {
    for (const [expectedStatus, caseFields] of Object.entries(CASES)) {
      const code = base({ ...kindFields, ...caseFields });

      assert.equal(deriveDiscountCodeStatus(code, NOW), expectedStatus, `${kind} ${expectedStatus}`);

      const validation = await validateDiscountCode({ code: code.code, cartItems: CART, currency: "RON", now: NOW, db: fakeDb(code) });
      assert.equal(validation.valid ? null : validation.error, EXPECTED_VALIDATION[expectedStatus], `${kind} ${expectedStatus}: validare`);
    }
  });
}

test("vendor și influencer: aceeași funcție, același rezultat pentru aceleași date", () => {
  for (const caseFields of Object.values(CASES)) {
    assert.equal(
      deriveDiscountCodeStatus(base({ ...KINDS["vendor direct"], ...caseFields }), NOW),
      deriveDiscountCodeStatus(base({ ...KINDS.influencer, ...caseFields }), NOW)
    );
  }
});
