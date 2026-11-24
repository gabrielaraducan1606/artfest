// Categoriile Creators = TOATE categoriile active din catalogul oficial Artfest
// (constants/categories.js), indiferent dacă au produse publicate.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { CATEGORIES, CATEGORY_GROUP_LABELS, CATEGORY_LABELS, CATEGORY_SET } from "../../constants/categories.js";
import publicCategories from "../../routes/categoriesRoutes.js";
import { creatorCategoryLabel, creatorCategoryLabels, creatorCategoryOptions, isCatalogCategoryKey } from "./creatorCatalogCategories.js";

test("exact aceleași categorii, identificatori și ordine ca filtrele catalogului (GET /api/public/categories)", async () => {
  const app = express();
  app.use("/api/public", publicCategories);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { items } = await fetch(`http://127.0.0.1:${server.address().port}/api/public/categories`).then((r) => r.json());
    const options = creatorCategoryOptions();
    assert.deepEqual(
      options.map((o) => [o.value, o.label, o.group, o.groupLabel]),
      items.map((c) => [c.key, c.label, c.group, c.groupLabel])
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("toate categoriile active din catalog apar, inclusiv cele cu zero produse (fără nicio interogare de produse)", () => {
  const values = creatorCategoryOptions().map((o) => o.value);
  assert.equal(values.length, CATEGORIES.length);
  assert.deepEqual(new Set(values), new Set(CATEGORIES));
  for (const key of ["papetarie_invitatii-nunta", "papetarie_invitatii-botez", "cadouri_anime-manga"]) {
    assert.ok(values.includes(key), key);
  }
  // funcția nu primește și nu folosește baza de date: zero produse nu schimbă nimic
  assert.equal(creatorCategoryOptions.length, 0);
});

test("gruparea oficială: fiecare categorie cu grupa și eticheta grupei din catalog", () => {
  for (const o of creatorCategoryOptions()) {
    assert.equal(o.label, CATEGORY_LABELS[o.value]);
    assert.equal(o.group, o.value.split("_")[0]);
    assert.equal(o.groupLabel, CATEGORY_GROUP_LABELS[o.group] || "Altele");
  }
  const nunta = creatorCategoryOptions().find((o) => o.value === "papetarie_invitatii-nunta");
  assert.equal(nunta.groupLabel, CATEGORY_GROUP_LABELS.papetarie);
});

test("exclus: chei inexistente / de servicii; „cadouri” (categorie de produs din catalog) apare automat", () => {
  const values = new Set(creatorCategoryOptions().map((o) => o.value));
  // „Cadouri” a devenit categorie selectabilă în catalog => apare și aici
  assert.ok(CATEGORY_SET.has("cadouri") && values.has("cadouri"));
  for (const bad of ["servicii_dj", "decor", "party", "inexistent"]) {
    assert.equal(values.has(bad), false, bad);
    assert.equal(isCatalogCategoryKey(bad), false, bad);
  }
  assert.equal(isCatalogCategoryKey("cadouri_anime-manga"), true);
});

test("etichete pentru valorile deja salvate (inclusiv grupele vechi din ciorne)", () => {
  assert.equal(creatorCategoryLabel("cadouri_anime-manga"), CATEGORY_LABELS["cadouri_anime-manga"]);
  assert.match(creatorCategoryLabel("party"), /Candy bar/);
  assert.equal(creatorCategoryLabel("necunoscut"), "necunoscut");
  assert.equal(creatorCategoryLabels().decor, CATEGORY_GROUP_LABELS.decor);
});
