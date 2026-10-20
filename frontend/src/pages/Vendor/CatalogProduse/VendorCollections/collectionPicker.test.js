// Rulare: node --test src/pages/Vendor/CatalogProduse/VendorCollections/collectionPicker.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_FILTERS,
  activeFilterCount,
  buildSearchParams,
  isSelectable,
  limitMessage,
  mergeResults,
  remainingCapacity,
  selectVisible,
  serverFilters,
  toggleSelection,
} from "./collectionPicker.js";

test("serverFilters: sursa + doar filtrele completate; prețuri invalide ignorate", () => {
  assert.deepEqual(serverFilters("own", EMPTY_FILTERS), { scope: "own" });
  assert.deepEqual(serverFilters("altceva", EMPTY_FILTERS), { scope: "marketplace" });

  assert.deepEqual(
    serverFilters("marketplace", {
      ...EMPTY_FILTERS,
      q: "  botez ",
      occasion: "baptism",
      minPrice: "10,5",
      maxPrice: "abc",
      personalizable: true,
    }),
    { scope: "marketplace", q: "botez", occasion: "baptism", minPrice: "10.5", personalizable: "1" }
  );
});

test("buildSearchParams: pagină + limită + filtre, identic cu ce primește „selectează toate”", () => {
  const params = buildSearchParams("own", { ...EMPTY_FILTERS, category: "decor_lumanari" }, 2, 24);
  assert.equal(params.get("page"), "2");
  assert.equal(params.get("limit"), "24");
  assert.equal(params.get("scope"), "own");
  assert.equal(params.get("category"), "decor_lumanari");
  assert.equal(params.has("q"), false);
});

test("activeFilterCount: textul căutării nu e un „filtru”", () => {
  assert.equal(activeFilterCount({ ...EMPTY_FILTERS, q: "lumânare" }), 0);
  assert.equal(activeFilterCount({ ...EMPTY_FILTERS, occasion: "wedding", maxPrice: "80", personalizable: true }), 3);
});

test("isSelectable: nu se bifează ce e deja în colecție sau inclus automat", () => {
  assert.equal(isSelectable({ id: "a", inCollection: true }), false);
  assert.equal(isSelectable({ id: "a", isOwn: true }, { allOwnActive: true }), false);
  assert.equal(isSelectable({ id: "a", isOwn: true }, { allOwnActive: false }), true);
  assert.equal(isSelectable({ id: "b", isOwn: false }, { allOwnActive: true }), true);
});

test("toggleSelection respectă limita colecției", () => {
  let state = toggleSelection(new Set(), "p1", 2);
  state = toggleSelection(state.selected, "p2", 2);
  assert.deepEqual([...state.selected], ["p1", "p2"]);

  const blocked = toggleSelection(state.selected, "p3", 2);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.selected.size, 2);

  const removed = toggleSelection(state.selected, "p1", 2);
  assert.deepEqual([...removed.selected], ["p2"]);
});

test("selectVisible: doar bifabilele, până la limită, cu numărul celor care nu au încăput", () => {
  const products = [
    { id: "p1" },
    { id: "p2", inCollection: true },
    { id: "p3" },
    { id: "p4" },
  ];
  const { selected, skipped } = selectVisible(new Set(), products, 2);
  assert.deepEqual([...selected], ["p1", "p3"]);
  assert.equal(skipped, 1);
});

test("remainingCapacity + limitMessage", () => {
  assert.equal(remainingCapacity(298, 300), 2);
  assert.equal(remainingCapacity(305, 300), 0);
  assert.equal(limitMessage({ error: "collection_product_limit", maxProducts: 300, remaining: 4 }), "Colecția poate avea maximum 300 produse. Mai poți adăuga 4.");
  assert.equal(limitMessage({ error: "altceva" }), "");
});

test("serverFilters: magazinul se ignoră pentru sursa „Magazinul meu”", () => {
  assert.deepEqual(serverFilters("own", { ...EMPTY_FILTERS, store: "Atelier B" }), { scope: "own" });
  assert.equal(serverFilters("marketplace", { ...EMPTY_FILTERS, store: "Atelier B" }).store, "Atelier B");
});

test("mergeResults: pagina următoare fără duplicate", () => {
  const merged = mergeResults([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }, { id: "c" }]);
  assert.deepEqual(merged.map((p) => p.id), ["a", "b", "c"]);
});
