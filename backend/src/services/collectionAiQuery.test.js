// Rulare: node --test src/services/collectionAiQuery.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyStoreDiversity,
  bucharestDayKey,
  interpretCollectionPrompt,
  mergeAiFilters,
} from "./collectionAiQuery.js";

test("interpretare: exemplul din specificație", () => {
  const q = interpretCollectionPrompt("Vreau 20 de cadouri pentru Crăciun, sub 100 lei, din magazine diferite");
  assert.equal(q.count, 20);
  assert.equal(q.maxPrice, 100);
  assert.equal(q.minPrice, null);
  assert.equal(q.occasion, "christmas");
  assert.equal(q.diverseStores, true);
});

test("interpretare: botez, interval de preț, personalizare", () => {
  const q = interpretCollectionPrompt("Găsește 15 mărturii de botez personalizate între 10 și 40 lei");
  assert.equal(q.count, 15);
  assert.equal(q.minPrice, 10);
  assert.equal(q.maxPrice, 40);
  assert.equal(q.occasion, "baptism");
  assert.equal(q.personalizable, true);
  assert.ok(q.keywords.includes("marturii"));
});

test("interpretare: suma în lei nu e confundată cu numărul de produse; nimic inventat", () => {
  const q = interpretCollectionPrompt("lumânări parfumate până în 80 lei");
  assert.equal(q.count, null);
  assert.equal(q.maxPrice, 80);
  assert.equal(q.occasion, null);
  assert.equal(q.diverseStores, false);
  assert.deepEqual(interpretCollectionPrompt("").keywords, []);
});

test("interpretare: „sărbători de iarnă” (frază mai lungă) înaintea lui „sărbători”", () => {
  assert.equal(interpretCollectionPrompt("decor pentru sărbători de iarnă").occasion, "winter_holidays");
});

test("mergeAiFilters: filtrele alese în interfață au prioritate", () => {
  const merged = mergeAiFilters(
    { scope: "own", occasion: "wedding", maxPrice: "60" },
    { occasion: "christmas", maxPrice: 100, minPrice: 20 }
  );
  assert.equal(merged.scope, "own");
  assert.equal(merged.occasion, "wedding");
  assert.equal(merged.maxPrice, "60");
  assert.equal(merged.minPrice, 20, "completat din text");
});

test("applyStoreDiversity: cel mult un produs per magazin, ordinea AI păstrată", () => {
  const products = [
    { id: "a1", vendorId: "A" },
    { id: "a2", vendorId: "A" },
    { id: "b1", vendorId: "B" },
    { id: "c1", vendorId: "C" },
  ];
  assert.deepEqual(applyStoreDiversity(products, { perStore: 1, limit: 10 }).map((p) => p.id), ["a1", "b1", "c1"]);
  assert.deepEqual(applyStoreDiversity(products, { perStore: 1, limit: 2 }).map((p) => p.id), ["a1", "b1"]);
});

test("bucharestDayKey: ziua după ora României (miezul nopții la 21:00 UTC vara)", () => {
  assert.equal(bucharestDayKey(new Date("2026-10-19T10:00:00Z")), "2026-10-19");
  assert.equal(bucharestDayKey(new Date("2026-10-19T21:30:00Z")), "2026-10-20");
});
