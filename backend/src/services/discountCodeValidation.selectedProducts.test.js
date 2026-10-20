// src/services/discountCodeValidation.selectedProducts.test.js
//
// Protecția suplimentară pentru codurile VENDOR cu SELECTED_PRODUCTS
// (validateDiscountCode, cu `db` simulat - fără Postgres):
//  - reduc DOAR produsele selectate ale vendorului care a creat codul;
//  - niciodată produsul altui magazin, nici dacă e în DiscountCodeProduct
//    (produs mutat între magazine / rând vechi);
//  - nu se aplică cererilor personalizate fără produs asociat;
//  - codurile PLATFORM / INFLUENCER cu SELECTED_PRODUCTS și celelalte scope-uri
//    rămân neschimbate.
//
// Rulare: node --test src/services/discountCodeValidation.selectedProducts.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildDiscountCodePromotionsByProductId,
  validateDiscountCode,
} from "./discountCodeValidation.js";

const baseCode = {
  id: "dc-1",
  code: "CANI20",
  ownerType: "VENDOR",
  vendorId: "vendor-a",
  influencerId: null,
  scope: "SELECTED_PRODUCTS",
  vendorCollectionId: null,
  discountType: "PERCENT",
  discountPercent: 20,
  discountAmountCents: null,
  currency: "RON",
  minimumOrderCents: null,
  maxDiscountCents: null,
  fundingSource: "VENDOR",
  platformFundingBps: 0,
  vendorFundingBps: 10000,
  status: "ACTIVE",
  isActive: true,
  startsAt: null,
  endsAt: null,
  usageLimit: null,
  usageLimitPerUser: null,
  usedCount: 0,
};

function fakeDb(code, links) {
  return {
    discountCode: { findUnique: async ({ where }) => (where.code === code.code ? code : null) },
    discountCodeRedemption: { count: async () => 0 },
    discountCodeProduct: {
      findMany: async ({ where }) =>
        links
          .filter((productId) => where.productId.in.includes(productId))
          .map((productId) => ({ productId })),
    },
  };
}

const item = (id, vendorId, priceCents = 10000) => ({
  product: { id, priceCents, service: { vendorId } },
  qty: 1,
});

// cerere personalizată: linie fără produs real (doar lineKey)
const customLine = (vendorId) => ({
  lineKey: "custom:req-1",
  product: { id: null, priceCents: 15000, service: { vendorId } },
  qty: 1,
});

test("cod VENDOR SELECTED_PRODUCTS: doar produsul selectat al vendorului (nu și cel neselectat)", async () => {
  const v = await validateDiscountCode({
    code: "CANI20",
    cartItems: [item("a1", "vendor-a"), item("a2", "vendor-a")],
    db: fakeDb(baseCode, ["a1"]),
  });
  assert.equal(v.valid, true);
  assert.deepEqual([...v.eligibleProductIds], ["a1"]);
});

test("cod VENDOR SELECTED_PRODUCTS: produsul ALTUI magazin nu e redus, chiar dacă e pe listă (mutat între magazine)", async () => {
  const v = await validateDiscountCode({
    code: "CANI20",
    cartItems: [item("a1", "vendor-a"), item("b1", "vendor-b")],
    db: fakeDb(baseCode, ["a1", "b1"]),
  });
  assert.equal(v.valid, true);
  assert.deepEqual([...v.eligibleProductIds], ["a1"]);

  const promos = buildDiscountCodePromotionsByProductId(v, { cartItems: [item("a1", "vendor-a"), item("b1", "vendor-b")] });
  assert.equal(promos.has("a1"), true);
  assert.equal(promos.has("b1"), false);
});

test("cod VENDOR SELECTED_PRODUCTS: coș doar cu produsul altui magazin -> cod invalid, nicio reducere", async () => {
  const v = await validateDiscountCode({
    code: "CANI20",
    cartItems: [item("b1", "vendor-b")],
    db: fakeDb(baseCode, ["b1"]),
  });
  assert.equal(v.valid, false);
  assert.equal(v.error, "discount_code_no_eligible_products");
});

test("cod VENDOR fără vendorId (date corupte) -> nimic eligibil, fail-closed", async () => {
  const v = await validateDiscountCode({
    code: "CANI20",
    cartItems: [item("a1", "vendor-a")],
    db: fakeDb({ ...baseCode, vendorId: null }, ["a1"]),
  });
  assert.equal(v.valid, false);
});

test("cerere personalizată fără produs asociat: codul cu produse selectate NU se aplică", async () => {
  const onlyCustom = await validateDiscountCode({
    code: "CANI20",
    cartItems: [customLine("vendor-a")],
    db: fakeDb(baseCode, ["a1"]),
  });
  assert.equal(onlyCustom.valid, false);
  assert.equal(onlyCustom.error, "discount_code_no_eligible_products");

  const mixed = await validateDiscountCode({
    code: "CANI20",
    cartItems: [customLine("vendor-a"), item("a1", "vendor-a")],
    db: fakeDb(baseCode, ["a1"]),
  });
  assert.equal(mixed.valid, true);
  assert.deepEqual([...mixed.eligibleProductIds], ["a1"]);
});

test("REG cod PLATFORM SELECTED_PRODUCTS: comportament neschimbat (fără filtrul pe vendor)", async () => {
  const platformCode = { ...baseCode, ownerType: "PLATFORM", vendorId: null, fundingSource: "PLATFORM", platformFundingBps: 10000, vendorFundingBps: 0 };
  const v = await validateDiscountCode({
    code: "CANI20",
    cartItems: [item("a1", "vendor-a"), item("b1", "vendor-b")],
    db: fakeDb(platformCode, ["a1", "b1"]),
  });
  assert.deepEqual([...v.eligibleProductIds].sort(), ["a1", "b1"]);
});

test("REG cod INFLUENCER SELECTED_PRODUCTS: comportament neschimbat", async () => {
  const infCode = { ...baseCode, ownerType: "INFLUENCER", vendorId: null, influencerId: "inf-1" };
  const v = await validateDiscountCode({
    code: "CANI20",
    cartItems: [item("a1", "vendor-a"), item("b1", "vendor-b")],
    db: fakeDb(infCode, ["a1", "b1"]),
  });
  assert.deepEqual([...v.eligibleProductIds].sort(), ["a1", "b1"]);
});

test("REG VENDOR_ALL_PRODUCTS: toate produsele vendorului + cererea personalizată (neschimbat)", async () => {
  const own = { ...baseCode, scope: "VENDOR_ALL_PRODUCTS" };
  const v = await validateDiscountCode({
    code: "CANI20",
    cartItems: [item("a1", "vendor-a"), item("b1", "vendor-b"), customLine("vendor-a")],
    db: fakeDb(own, []),
  });
  assert.deepEqual([...v.eligibleProductIds].sort(), ["a1", "custom:req-1"]);
});

test("REG ALL_PRODUCTS (Artfest): toate produsele din coș (neschimbat)", async () => {
  const all = { ...baseCode, scope: "ALL_PRODUCTS", fundingSource: "PLATFORM", platformFundingBps: 10000, vendorFundingBps: 0, discountPercent: 5 };
  const v = await validateDiscountCode({
    code: "CANI20",
    cartItems: [item("a1", "vendor-a"), item("b1", "vendor-b")],
    db: fakeDb(all, []),
  });
  assert.deepEqual([...v.eligibleProductIds].sort(), ["a1", "b1"]);
});

test("reducerea calculată doar pe subtotalul produselor selectate proprii", async () => {
  const v = await validateDiscountCode({
    code: "CANI20",
    cartItems: [item("a1", "vendor-a", 10000), item("a2", "vendor-a", 30000), item("b1", "vendor-b", 50000)],
    db: fakeDb(baseCode, ["a1", "b1"]),
  });
  assert.equal(v.valid, true);
  assert.equal(v.effectiveDiscountPercent, 20);
  assert.equal(v.estimatedDiscountAmountCents, 2000);
});
