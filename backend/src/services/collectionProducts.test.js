// Rulare: node --test src/services/collectionProducts.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildCollectionRulesClause,
  buildCollectionWhereFromRules,
  collectionHasPublicProducts,
  collectionsWithPublicProducts,
  productMatchesRulesClause,
  publicProductWhere,
} from "./collectionProducts.js";
import { matchWhere, project } from "../testing/matchWhere.js";

const PUBLIC_BASE = {
  isActive: true,
  isHidden: false,
  moderationStatus: "APPROVED",
  service: {
    is: {
      isActive: true,
      status: "ACTIVE",
      vendor: { is: { isActive: true } },
      type: { is: { code: "products" } },
    },
  },
};

/* ---------- where builder (comportament neschimbat) ---------- */

test("reguli goale => doar condițiile de produs public", () => {
  assert.deepEqual(publicProductWhere(), PUBLIC_BASE);
  assert.deepEqual(buildCollectionWhereFromRules({}, []), PUBLIC_BASE);
  assert.deepEqual(buildCollectionWhereFromRules(undefined), PUBLIC_BASE);
  assert.deepEqual(buildCollectionWhereFromRules(null), PUBLIC_BASE);
  assert.deepEqual(buildCollectionWhereFromRules([]), PUBLIC_BASE);
});

test("publicProductWhere întoarce mereu o copie nouă (fără mutații partajate)", () => {
  const a = publicProductWhere();
  a.isActive = false;
  a.service.is.status = "X";
  assert.deepEqual(publicProductWhere(), PUBLIC_BASE);
});

test("toate regulile se traduc în clauze (comportament neschimbat față de varianta din publicProductRoutes)", () => {
  const where = buildCollectionWhereFromRules(
    {
      categories: [" a ", "", "b"],
      acceptsCustom: true,
      minPriceCents: 100,
      maxPriceCents: 900,
      occasionTags: ["nunta"],
      styleTags: ["boho"],
    },
    ["x", "y"]
  );

  assert.deepEqual(where, {
    ...PUBLIC_BASE,
    id: { notIn: ["x", "y"] },
    category: { in: ["a", "b"] },
    acceptsCustom: true,
    priceCents: { gte: 100, lte: 900 },
    occasionTags: { hasSome: ["nunta"] },
    styleTags: { hasSome: ["boho"] },
  });
});

/* ---------- evaluatorul în memorie == clauza Prisma ---------- */

test("productMatchesRulesClause dă EXACT același rezultat ca aplicarea clauzei (oracol matchWhere), pe combinații variate", () => {
  const categories = ["a", "b", "c", undefined];
  const prices = [0, 100, 500, 900, 1000];
  const tagSets = [[], ["nunta"], ["botez"], ["nunta", "boho"], ["boho"]];
  const customs = [true, false];

  const products = [];
  for (const category of categories)
    for (const priceCents of prices)
      for (const occasionTags of tagSets)
        for (const acceptsCustom of customs)
          products.push({
            category,
            priceCents,
            occasionTags,
            styleTags: occasionTags.filter((t) => t === "boho"),
            acceptsCustom,
          });

  const ruleSets = [
    {},
    { categories: ["a"] },
    { categories: ["a", "b"] },
    { categories: [" "] }, // in: [] => nimic
    { acceptsCustom: true },
    { acceptsCustom: false }, // fără efect
    { minPriceCents: 500 },
    { maxPriceCents: 500 },
    { minPriceCents: 100, maxPriceCents: 900 },
    { minPriceCents: null }, // Number(null) === 0
    { minPriceCents: "abc" }, // NaN => ignorat
    { occasionTags: ["nunta"] },
    { styleTags: ["boho"] },
    {
      categories: ["b"],
      acceptsCustom: true,
      minPriceCents: 100,
      occasionTags: ["nunta", "botez"],
      styleTags: ["boho"],
    },
  ];

  let checked = 0;
  for (const rules of ruleSets) {
    const clause = buildCollectionRulesClause(rules);
    for (const product of products) {
      assert.equal(
        productMatchesRulesClause(product, clause),
        matchWhere(product, clause),
        `rules=${JSON.stringify(rules)} product=${JSON.stringify(product)}`
      );
      checked++;
    }
  }
  assert.ok(checked > 1000);
});

/* ---------- lotul: semantică ---------- */

function prod(overrides = {}) {
  return {
    id: "p1",
    category: "c1",
    acceptsCustom: false,
    priceCents: 1000,
    occasionTags: [],
    styleTags: [],
    isActive: true,
    isHidden: false,
    moderationStatus: "APPROVED",
    service: {
      isActive: true,
      status: "ACTIVE",
      vendor: { isActive: true },
      type: { code: "products" },
    },
    ...overrides,
  };
}

// DB fals care APLICĂ clauzele și numără interogările
function fakeDb(products) {
  const calls = [];
  return {
    calls,
    product: {
      findMany: async (args) => {
        calls.push(args);
        return products
          .filter((p) => matchWhere(p, args.where))
          .map((p) => project(p, args.select));
      },
    },
  };
}

test("lot: colecție cu produs care se potrivește => true; fără => false", async () => {
  const db = fakeDb([prod({ id: "a", category: "c1" })]);

  const out = await collectionsWithPublicProducts(db, [
    { rules: { categories: ["c1"] }, items: [] },
    { rules: { categories: ["nimic"] }, items: [] },
    { rules: {}, items: [] }, // fără constrângeri, există un produs public
  ]);

  assert.deepEqual(out, [true, false, true]);
});

test("lot: produsele nepublice nu contează", async () => {
  const notPublic = [
    prod({ id: "1", isActive: false }),
    prod({ id: "2", isHidden: true }),
    prod({ id: "3", moderationStatus: "PENDING" }),
    prod({ id: "4", service: { isActive: false, status: "ACTIVE", vendor: { isActive: true }, type: { code: "products" } } }),
    prod({ id: "5", service: { isActive: true, status: "PAUSED", vendor: { isActive: true }, type: { code: "products" } } }),
    prod({ id: "6", service: { isActive: true, status: "ACTIVE", vendor: { isActive: false }, type: { code: "products" } } }),
    prod({ id: "7", service: { isActive: true, status: "ACTIVE", vendor: { isActive: true }, type: { code: "digital" } } }),
  ];

  assert.deepEqual(
    await collectionsWithPublicProducts(fakeDb(notPublic), [{ rules: {}, items: [] }]),
    [false]
  );
});

test("lot: produs fixat public numără chiar dacă regulile nu se potrivesc; fixat nepublic nu", async () => {
  const db = fakeDb([
    prod({ id: "pin-ok", category: "altceva" }),
    prod({ id: "pin-hidden", category: "altceva", isHidden: true }),
  ]);

  const out = await collectionsWithPublicProducts(db, [
    { rules: { categories: ["nimic"] }, items: [{ productId: "pin-ok", pinned: true, excluded: false }] },
    { rules: { categories: ["nimic"] }, items: [{ productId: "pin-hidden", pinned: true, excluded: false }] },
  ]);

  assert.deepEqual(out, [true, false]);
});

test("lot: produs exclus manual nu se numără (nici ca fixat, nici prin reguli), dar celelalte da", async () => {
  const db = fakeDb([prod({ id: "only", category: "c1" })]);

  assert.deepEqual(
    await collectionsWithPublicProducts(db, [
      { rules: { categories: ["c1"] }, items: [{ productId: "only", excluded: true }] },
      { rules: { categories: ["c1"] }, items: [{ productId: "only", pinned: true, excluded: true }] },
      { rules: { categories: ["c1"] }, items: [] },
    ]),
    [false, false, true]
  );

  const db2 = fakeDb([prod({ id: "x", category: "c1" }), prod({ id: "y", category: "c1" })]);
  assert.deepEqual(
    await collectionsWithPublicProducts(db2, [
      { rules: { categories: ["c1"] }, items: [{ productId: "x", excluded: true }] },
    ]),
    [true] // rămâne y
  );
});

test("lot: rezultatul e aliniat cu intrarea; listă goală/invalidă => []", async () => {
  const db = fakeDb([prod()]);
  assert.deepEqual(await collectionsWithPublicProducts(db, []), []);
  assert.deepEqual(await collectionsWithPublicProducts(db, undefined), []);
  assert.equal(db.calls.length, 0, "fără colecții nu se face nicio interogare");

  assert.deepEqual(
    await collectionsWithPublicProducts(db, [
      { rules: { categories: ["nimic"] } },
      { rules: { categories: ["c1"] } },
      { rules: null },
    ]),
    [false, true, true]
  );
});

test("collectionHasPublicProducts (o colecție) folosește același cod ca lotul", async () => {
  const db = fakeDb([prod({ category: "c1" })]);
  assert.equal(await collectionHasPublicProducts(db, { rules: { categories: ["c1"] } }), true);
  assert.equal(await collectionHasPublicProducts(db, { rules: { categories: ["x"] } }), false);
});

/* ---------- FĂRĂ N+1: număr constant de interogări ---------- */

test("număr CONSTANT de interogări indiferent de numărul colecțiilor (1, 10, 100)", async () => {
  const products = [prod({ id: "a", category: "c1" }), prod({ id: "pin", category: "z" })];

  const makeCollections = (n) =>
    Array.from({ length: n }, (_, i) => ({
      rules: { categories: [i % 2 ? "c1" : "inexistent"] },
      items: i % 3 === 0 ? [{ productId: "pin", pinned: true, excluded: false }] : [],
    }));

  const counts = [];
  for (const n of [1, 10, 100]) {
    const db = fakeDb(products);
    await collectionsWithPublicProducts(db, makeCollections(n));
    counts.push(db.calls.length);
  }

  assert.ok(counts.every((c) => c <= 2), `interogări: ${counts}`);
  // cu 100 de colecții nu se fac mai multe interogări decât cu 10
  assert.equal(counts[2], counts[1]);
});

test("fără fixate și fără reguli nerezolvate => zero sau o singură interogare", async () => {
  // toate rezolvate prin fixate: doar interogarea 1
  const db = fakeDb([prod({ id: "pin" })]);
  await collectionsWithPublicProducts(db, [
    { rules: {}, items: [{ productId: "pin", pinned: true }] },
  ]);
  assert.equal(db.calls.length, 1);

  // fără fixate: doar interogarea 2
  const db2 = fakeDb([prod()]);
  await collectionsWithPublicProducts(db2, [{ rules: {}, items: [] }]);
  assert.equal(db2.calls.length, 1);
});
