// src/pages/Vendor/Produse/hooks/similarProductsScoring.test.js
//
// Rulare: node --test src/pages/Vendor/Produse/hooks/similarProductsScoring.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  splitTags,
  categoryGroup,
  scoreSimilarProduct,
  rankSimilarProducts,
  SIMILAR_PRODUCTS_WEIGHTS,
} from "./similarProductsScoring.js";

/* =========================================================
   splitTags / categoryGroup
========================================================= */

test("splitTags - acceptă array (formatul API actual)", () => {
  assert.deepEqual(splitTags(["Nuntă", "botez", "nuntă"]), ["nuntă", "botez"]);
});

test("splitTags - acceptă și string separat prin virgulă (defensiv)", () => {
  assert.deepEqual(splitTags("Nuntă, Botez"), ["nuntă", "botez"]);
});

test("splitTags - gol/null/undefined -> []", () => {
  assert.deepEqual(splitTags(null), []);
  assert.deepEqual(splitTags(undefined), []);
  assert.deepEqual(splitTags([]), []);
});

test("categoryGroup - extrage prefixul dinaintea '_'", () => {
  assert.equal(categoryGroup("decor_aranjamente-florale-naturale"), "decor");
  assert.equal(categoryGroup("cadouri_botez"), "cadouri");
});

test("categoryGroup - fără '_' -> categoria întreagă", () => {
  assert.equal(categoryGroup("bijuterii"), "bijuterii");
});

test("categoryGroup - gol -> gol", () => {
  assert.equal(categoryGroup(null), "");
});

/* =========================================================
   scoreSimilarProduct - fiecare criteriu, izolat
========================================================= */

const BASE = {
  id: "base",
  category: "decor_aranjamente-florale-naturale",
  materialMain: "lemn",
  occasionTags: ["nunta", "aniversare"],
  styleTags: ["boho", "rustic"],
  color: "alb",
  acceptsCustom: true,
  priceCents: 10000, // 100 lei
  isAvailable: true,
};

test("produs identic pe toate criteriile -> scor = suma tuturor ponderilor", () => {
  const identical = { ...BASE, id: "identical" };
  const score = scoreSimilarProduct(BASE, identical);

  const w = SIMILAR_PRODUCTS_WEIGHTS;
  const expected =
    w.categoryExact +
    w.material +
    (w.occasionTag + w.occasionTagExtra) + // 2 ocazii comune -> +1 bonus
    (w.styleTag + w.styleTagExtra) + // 2 stiluri comune -> +1 bonus
    w.color +
    w.personalizable +
    w.priceProximity + // preț identic -> proximitate maximă
    w.availability;

  assert.equal(score, expected);
});

test("produs complet nepotrivit (dar disponibil) -> scor 0", () => {
  const unrelated = {
    id: "unrelated",
    category: "papetarie_invitatii-nunta",
    materialMain: "hartie",
    occasionTags: ["craciun"],
    styleTags: ["modern"],
    color: "negru",
    acceptsCustom: false,
    priceCents: 100000, // 1000 lei - foarte departe de bază
    isAvailable: false,
  };

  assert.equal(scoreSimilarProduct(BASE, unrelated), 0);
});

test("1. categorie exactă > același grup > categorie diferită", () => {
  const exact = { category: "decor_aranjamente-florale-naturale" };
  const sameGroup = { category: "decor_baloane" };
  const otherGroup = { category: "papetarie_invitatii-nunta" };

  const sExact = scoreSimilarProduct(BASE, exact);
  const sGroup = scoreSimilarProduct(BASE, sameGroup);
  const sOther = scoreSimilarProduct(BASE, otherGroup);

  assert.ok(sExact > sGroup, "categorie exactă trebuie să scoreze mai mult decât același grup");
  assert.ok(sGroup > sOther, "același grup trebuie să scoreze mai mult decât o categorie total diferită");
  assert.equal(sExact, SIMILAR_PRODUCTS_WEIGHTS.categoryExact);
  assert.equal(sGroup, SIMILAR_PRODUCTS_WEIGHTS.categoryGroup);
  assert.equal(sOther, 0);
});

test("2. material comun contribuie independent de categorie", () => {
  const sameMaterial = { category: "altceva_x", materialMain: "Lemn" }; // case-insensitive
  assert.equal(scoreSimilarProduct(BASE, sameMaterial), SIMILAR_PRODUCTS_WEIGHTS.material);
});

test("3. ocazie comună - overlap parțial vs total", () => {
  const oneOverlap = { occasionTags: ["nunta", "craciun"] };
  const bothOverlap = { occasionTags: ["nunta", "aniversare"] };

  const s1 = scoreSimilarProduct(BASE, oneOverlap);
  const s2 = scoreSimilarProduct(BASE, bothOverlap);

  assert.equal(s1, SIMILAR_PRODUCTS_WEIGHTS.occasionTag);
  assert.equal(
    s2,
    SIMILAR_PRODUCTS_WEIGHTS.occasionTag + SIMILAR_PRODUCTS_WEIGHTS.occasionTagExtra
  );
  assert.ok(s2 > s1, "mai multe ocazii comune -> scor mai mare");
});

test("4. styleTags comune - la fel, overlap parțial vs total", () => {
  const oneOverlap = { styleTags: ["boho"] };
  assert.equal(scoreSimilarProduct(BASE, oneOverlap), SIMILAR_PRODUCTS_WEIGHTS.styleTag);
});

test("5. culoare comună", () => {
  assert.equal(
    scoreSimilarProduct(BASE, { color: "Alb" }),
    SIMILAR_PRODUCTS_WEIGHTS.color
  );
});

test("6. personalizabil - contează DOAR când ambele sunt true", () => {
  assert.equal(
    scoreSimilarProduct(BASE, { acceptsCustom: true }),
    SIMILAR_PRODUCTS_WEIGHTS.personalizable
  );
  assert.equal(scoreSimilarProduct(BASE, { acceptsCustom: false }), 0);

  const baseNotCustom = { ...BASE, acceptsCustom: false };
  assert.equal(
    scoreSimilarProduct(baseNotCustom, { acceptsCustom: true }),
    0,
    "produsul curent nepersonalizabil - nu acordăm scor doar pt. candidatul personalizabil"
  );
});

test("7. preț apropiat - scade liniar, 0 peste toleranță (60%)", () => {
  const samePrice = { priceCents: 10000 };
  const near = { priceCents: 11000 }; // +10%
  const far = { priceCents: 20000 }; // +100%, peste toleranță

  const sSame = scoreSimilarProduct(BASE, samePrice);
  const sNear = scoreSimilarProduct(BASE, near);
  const sFar = scoreSimilarProduct(BASE, far);

  assert.equal(sSame, SIMILAR_PRODUCTS_WEIGHTS.priceProximity);
  assert.ok(sNear < sSame && sNear > 0, "preț apropiat dar nu identic -> scor parțial");
  assert.equal(sFar, 0, "diferență de preț peste toleranță -> zero");
});

test("8. disponibilitate", () => {
  assert.equal(
    scoreSimilarProduct(BASE, { isAvailable: true }),
    SIMILAR_PRODUCTS_WEIGHTS.availability
  );
  assert.equal(
    scoreSimilarProduct(BASE, { canBuyDirect: true }),
    SIMILAR_PRODUCTS_WEIGHTS.availability
  );
  assert.equal(scoreSimilarProduct(BASE, { isAvailable: false }), 0);
});

test("câmpuri lipsă complet (produs minimal) -> scor 0, nu aruncă", () => {
  assert.doesNotThrow(() => scoreSimilarProduct(BASE, {}));
  assert.equal(scoreSimilarProduct(BASE, {}), 0);
});

test("base sau candidate null/undefined -> 0, nu aruncă", () => {
  assert.equal(scoreSimilarProduct(null, {}), 0);
  assert.equal(scoreSimilarProduct(BASE, null), 0);
  assert.equal(scoreSimilarProduct(undefined, undefined), 0);
});

/* =========================================================
   rankSimilarProducts - ordinea + fallback implicit
========================================================= */

test("rankSimilarProducts - ordonează descrescător după scor", () => {
  const weak = { id: "weak", category: "altceva" };
  const strong = { ...BASE, id: "strong" };
  const medium = { id: "medium", category: BASE.category, color: BASE.color };

  const ranked = rankSimilarProducts(BASE, [weak, strong, medium]);

  assert.deepEqual(
    ranked.map((x) => x.id),
    ["strong", "medium", "weak"]
  );
});

test("rankSimilarProducts - stabil la egalitate de scor (păstrează ordinea de intrare)", () => {
  const a = { id: "a" }; // scor 0
  const b = { id: "b" }; // scor 0

  const ranked = rankSimilarProducts(BASE, [a, b]);
  assert.deepEqual(ranked.map((x) => x.id), ["a", "b"]);
});

test("rankSimilarProducts - fallback implicit: produse fără NICIO potrivire tot apar (nu sunt eliminate)", () => {
  const noMatch = { id: "no-match", category: "altceva_total_diferit" };
  const ranked = rankSimilarProducts(BASE, [noMatch]);

  assert.equal(ranked.length, 1, "secțiunea nu rămâne goală cât timp există orice produs valid");
  assert.equal(ranked[0].id, "no-match");
});

test("rankSimilarProducts - listă goală/invalidă -> []", () => {
  assert.deepEqual(rankSimilarProducts(BASE, []), []);
  assert.deepEqual(rankSimilarProducts(BASE, null), []);
  assert.deepEqual(rankSimilarProducts(BASE, undefined), []);
});
