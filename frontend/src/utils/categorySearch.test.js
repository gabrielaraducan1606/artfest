import test from "node:test";
import assert from "node:assert/strict";

import { filterCategoryOptions, normalizeCategorySearchText } from "./categorySearch.js";
import { CATEGORIES, CATEGORIES_DETAILED, CATEGORY_LABELS } from "../constants/productscategories.js";

const OPTIONS = CATEGORIES_DETAILED.filter((c) => CATEGORIES.includes(c.key));

test("„Cadouri” e o categorie selectabilă, o singură dată, în grupa „Cadouri & personalizate”", () => {
  assert.equal(CATEGORIES.filter((k) => k === "cadouri").length, 1);
  assert.equal(CATEGORY_LABELS.cadouri, "Cadouri");
  const option = OPTIONS.find((o) => o.key === "cadouri");
  assert.equal(option.groupLabel, "Cadouri & personalizate");
  // nicio altă cheie nu are aceeași etichetă
  assert.equal(OPTIONS.filter((o) => o.label === "Cadouri").length, 1);
});

test("normalizare: fără diacritice și fără diferență de litere", () => {
  assert.equal(normalizeCategorySearchText("  Mărțișoare  ȘI Ţesături "), "martisoare si tesaturi");
  assert.equal(normalizeCategorySearchText(null), "");
});

test("căutarea după denumire, fără litere mari/mici sau diacritice", () => {
  const keys = (q) => filterCategoryOptions(OPTIONS, q).options.map((o) => o.key);
  assert.ok(keys("cadouri").includes("cadouri"));
  assert.ok(keys("CADOURI").includes("cadouri_pentru-nasi"));
  assert.deepEqual(keys("cadouri pentru nasi"), ["cadouri_pentru-nasi"]);
  assert.deepEqual(keys("Cadouri pentru NAȘI"), ["cadouri_pentru-nasi"]);
  assert.ok(keys("parinti").includes("cadouri_pentru-parinti"));
  // gol / doar spații = toată lista
  assert.equal(keys("   ").length, OPTIONS.length);
});

test("selecția rămâne în listă când căutarea nu o include; fără rezultate => matches 0", () => {
  const r = filterCategoryOptions(OPTIONS, "zzz-inexistent", "cadouri_botez");
  assert.equal(r.matches, 0);
  assert.deepEqual(r.options.map((o) => o.key), ["cadouri_botez"]);

  const none = filterCategoryOptions(OPTIONS, "zzz-inexistent");
  assert.equal(none.matches, 0);
  assert.equal(none.options.length, 0);

  const hit = filterCategoryOptions(OPTIONS, "botez", "cadouri_botez");
  assert.ok(hit.matches >= 1);
  assert.equal(hit.options.filter((o) => o.key === "cadouri_botez").length, 1);
});
