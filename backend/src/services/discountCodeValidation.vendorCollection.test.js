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
