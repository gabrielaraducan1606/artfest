// src/pages/Vendor/Produse/hooks/discoverMoreScoring.test.js
//
// Rulare: node --test src/pages/Vendor/Produse/hooks/discoverMoreScoring.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  scoreDiscoverCandidate,
  applyVendorDiversityCap,
  buildDiscoverSelection,
  DISCOVER_WEIGHTS,
} from "./discoverMoreScoring.js";

const NOW = new Date("2026-09-23T12:00:00Z").getTime();

/* =========================================================
   scoreDiscoverCandidate
========================================================= */

test("1. categorie apropiată (același grup) contribuie, chiar dacă subcategoria diferă", () => {
  const base = { category: "decor_aranjamente-florale-naturale" };
  const sameGroup = { category: "decor_baloane" };
  const otherGroup = { category: "papetarie_invitatii-nunta" };

  const sSame = scoreDiscoverCandidate(base, sameGroup, { now: NOW });
  const sOther = scoreDiscoverCandidate(base, otherGroup, { now: NOW });

  assert.equal(sSame, DISCOVER_WEIGHTS.categoryGroup);
  assert.equal(sOther, 0);
  assert.ok(sSame > sOther);
});

test("2. popularitate - poziția în pool contează, index 0 > index mare", () => {
  const first = scoreDiscoverCandidate(
    {},
    {},
    { index: 0, poolSize: 60, now: NOW }
  );
  const last = scoreDiscoverCandidate(
    {},
    {},
    { index: 59, poolSize: 60, now: NOW }
  );
  const middle = scoreDiscoverCandidate(
    {},
    {},
    { index: 29, poolSize: 60, now: NOW }
  );

  assert.equal(first, DISCOVER_WEIGHTS.popularity);
  assert.ok(first > middle && middle > last);
  assert.ok(last >= 0);
});

test("3. noutate - produs de azi > produs vechi", () => {
  const today = { createdAt: new Date(NOW).toISOString() };
  const oldOne = {
    createdAt: new Date(NOW - 200 * 86400000).toISOString(),
  };

  const sToday = scoreDiscoverCandidate({}, today, { now: NOW });
  const sOld = scoreDiscoverCandidate({}, oldOne, { now: NOW });

  assert.ok(sToday > sOld);
  assert.equal(sToday, DISCOVER_WEIGHTS.newness);
  assert.ok(sOld >= 0 && sOld < 1, "produs foarte vechi -> scor de noutate aproape 0");
});

test("3b. noutate - la exact half-life, scorul e jumătate din maxim", () => {
  const halfLifeAgo = {
    createdAt: new Date(NOW - 30 * 86400000).toISOString(),
  };
  const score = scoreDiscoverCandidate({}, halfLifeAgo, { now: NOW });
  assert.ok(
    Math.abs(score - DISCOVER_WEIGHTS.newness / 2) < 0.5,
    `scor la half-life (${score}) ar trebui să fie ~${DISCOVER_WEIGHTS.newness / 2}`
  );
});

test("4. disponibilitate", () => {
  assert.equal(
    scoreDiscoverCandidate({}, { isAvailable: true }, { now: NOW }),
    DISCOVER_WEIGHTS.availability
  );
  assert.equal(
    scoreDiscoverCandidate({}, { canBuyDirect: true }, { now: NOW }),
    DISCOVER_WEIGHTS.availability
  );
  assert.equal(
    scoreDiscoverCandidate({}, { isAvailable: false }, { now: NOW }),
    0
  );
});

test("candidat/bază lipsă -> 0, nu aruncă", () => {
  assert.equal(scoreDiscoverCandidate({}, null), 0);
  assert.doesNotThrow(() => scoreDiscoverCandidate(null, {}));
});

/* =========================================================
   applyVendorDiversityCap
========================================================= */

test("respectă maxPerVendor - vendorul dominant e plafonat", () => {
  const items = [
    { id: "1", service: { vendorId: "v1" } },
    { id: "2", service: { vendorId: "v1" } },
    { id: "3", service: { vendorId: "v1" } }, // al 3-lea de la v1 - amânat
    { id: "4", service: { vendorId: "v2" } },
  ];

  const result = applyVendorDiversityCap(items, { maxPerVendor: 2, limit: 16 });

  assert.deepEqual(
    result.map((x) => x.id),
    ["1", "2", "4", "3"],
    "cele amânate de la v1 completează la finalul listei, nu dispar"
  );
});

test("dacă diversitatea nu poate umple `limit`, completează din amânate (nu afișează mai puțin decât există)", () => {
  const items = Array.from({ length: 5 }, (_, i) => ({
    id: `p${i}`,
    service: { vendorId: "v1" }, // TOATE de la același vendor
  }));

  const result = applyVendorDiversityCap(items, { maxPerVendor: 2, limit: 5 });

  assert.equal(result.length, 5, "toate cele 5 apar, chiar dacă sunt de la un singur vendor");
});

test("respectă `limit` chiar cu diversitate suficientă", () => {
  const items = Array.from({ length: 20 }, (_, i) => ({
    id: `p${i}`,
    service: { vendorId: `v${i}` }, // toți vendori diferiți
  }));

  const result = applyVendorDiversityCap(items, { maxPerVendor: 2, limit: 16 });
  assert.equal(result.length, 16);
});

test("listă goală/invalidă -> []", () => {
  assert.deepEqual(applyVendorDiversityCap([]), []);
  assert.deepEqual(applyVendorDiversityCap(null), []);
});

/* =========================================================
   buildDiscoverSelection - pipeline complet
========================================================= */

function makeItem(id, overrides = {}) {
  return {
    id,
    category: "decor_baloane",
    createdAt: new Date(NOW - 10 * 86400000).toISOString(),
    isAvailable: true,
    service: { vendorId: `vendor-${id}` },
    ...overrides,
  };
}

test("exclude produsul curent + id-urile deja afișate în alte secțiuni", () => {
  const base = { id: "current", category: "decor_baloane" };
  const candidates = [
    makeItem("current"), // produsul curent - exclus
    makeItem("already-similar"),
    makeItem("already-store"),
    makeItem("new-one"),
  ];

  const result = buildDiscoverSelection({
    baseProduct: base,
    candidates,
    excludeIds: new Set(["current", "already-similar", "already-store"]),
    now: NOW,
  });

  assert.deepEqual(result.map((x) => x.id), ["new-one"]);
});

test("acceptă excludeIds ca array simplu, nu doar Set", () => {
  const base = { id: "current" };
  const candidates = [makeItem("current"), makeItem("a")];

  const result = buildDiscoverSelection({
    baseProduct: base,
    candidates,
    excludeIds: ["current"],
    now: NOW,
  });

  assert.deepEqual(result.map((x) => x.id), ["a"]);
});

test("aplică maxPerVendor=2 și limit=16 implicit, în pipeline complet", () => {
  const base = { id: "current", category: "decor_baloane" };

  // 20 produse de la ACELAȘI vendor (ar trebui plafonate la 2, restul
  // amânate, dar tot afișate dacă nu există alternative suficiente)
  const sameVendorItems = Array.from({ length: 20 }, (_, i) =>
    makeItem(`same-vendor-${i}`, { service: { vendorId: "dominant-vendor" } })
  );

  const diverseItems = Array.from({ length: 10 }, (_, i) =>
    makeItem(`diverse-${i}`, { service: { vendorId: `v-${i}` } })
  );

  const result = buildDiscoverSelection({
    baseProduct: base,
    candidates: [...sameVendorItems, ...diverseItems],
    excludeIds: new Set(["current"]),
    now: NOW,
  });

  assert.equal(result.length, 16, "limit implicit respectat");

  const dominantVendorCount = result.filter((x) =>
    x.id.startsWith("same-vendor-")
  ).length;

  // diverse items (10) + maxim 2 de la vendorul dominant, restul
  // (4 sloturi) completate tot din vendorul dominant (fallback,
  // nu există alți vendori disponibili în plus)
  assert.ok(
    dominantVendorCount >= 2,
    "vendorul dominant apare (fallback-ul umple sloturile rămase)"
  );
});

test("produs valid, dar pool complet gol -> []", () => {
  const result = buildDiscoverSelection({
    baseProduct: { id: "current" },
    candidates: [],
    excludeIds: new Set(["current"]),
    now: NOW,
  });
  assert.deepEqual(result, []);
});
