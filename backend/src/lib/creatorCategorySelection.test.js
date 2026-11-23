// Selecția mixtă de categorii Artfest Creators: grupe întregi, categorii individuale,
// excluderi (selecție parțială), limita de 6, valori vechi, catalog care crește.
import test from "node:test";
import assert from "node:assert/strict";
import { CATEGORIES } from "../constants/categories.js";
import { creatorCategoryOptions } from "../services/creators/creatorCatalogCategories.js";
import {
  categoryGroupState,
  countCategoryPreferences,
  expandCreatorCategories,
  isCategorySelected,
  parseCategorySelection,
  selectedInGroup,
  toggleCategory,
  toggleCategoryGroup,
  validateCategorySelection,
} from "./creatorCategorySelection.js";

const CAT = creatorCategoryOptions();
const bijuterii = CAT.filter((c) => c.group === "bijuterii").map((c) => c.value);

test("„Selectează toate”: o grupă întreagă = un singur token, o singură preferință", () => {
  const { list, limited } = toggleCategoryGroup([], "bijuterii", CAT);
  assert.equal(limited, false);
  assert.deepEqual(list, ["group:bijuterii"]);
  assert.equal(countCategoryPreferences(list, CAT), 1);
  assert.equal(categoryGroupState(list, "bijuterii", CAT), "full");
  assert.ok(bijuterii.every((k) => isCategorySelected(list, k, CAT)));
  assert.equal(selectedInGroup(list, "bijuterii", CAT), bijuterii.length);
});

test("deselectarea unei subcategorii dintr-o grupă întreagă => parțial, tot o preferință; reselectarea => din nou întreagă", () => {
  let list = toggleCategoryGroup([], "bijuterii", CAT).list;
  list = toggleCategory(list, bijuterii[0], CAT).list;
  assert.deepEqual(list, ["group:bijuterii", `exclude:${bijuterii[0]}`]);
  assert.equal(categoryGroupState(list, "bijuterii", CAT), "partial");
  assert.equal(isCategorySelected(list, bijuterii[0], CAT), false);
  assert.equal(selectedInGroup(list, "bijuterii", CAT), bijuterii.length - 1);
  assert.equal(countCategoryPreferences(list, CAT), 1);
  list = toggleCategory(list, bijuterii[0], CAT).list;
  assert.deepEqual(list, ["group:bijuterii"]);
  // „Selectează toate” pe o grupă parțială => întreagă; pe una întreagă => nimic
  list = toggleCategory(list, bijuterii[1], CAT).list;
  list = toggleCategoryGroup(list, "bijuterii", CAT).list;
  assert.deepEqual(list, ["group:bijuterii"]);
  assert.deepEqual(toggleCategoryGroup(list, "bijuterii", CAT).list, []);
});

test("deselectarea tuturor subcategoriilor unei grupe întregi => grupa dispare", () => {
  let list = toggleCategoryGroup([], "bijuterii", CAT).list;
  for (const k of bijuterii) list = toggleCategory(list, k, CAT).list;
  assert.deepEqual(list, []);
});

test("categorii individuale fără grupa întreagă; alese toate => devin automat grupa întreagă", () => {
  let list = toggleCategory([], bijuterii[0], CAT).list;
  list = toggleCategory(list, bijuterii[1], CAT).list;
  assert.deepEqual(list, [bijuterii[0], bijuterii[1]]);
  assert.equal(categoryGroupState(list, "bijuterii", CAT), "partial");
  assert.equal(countCategoryPreferences(list, CAT), 2);
  const many = CAT.filter((c) => c.group === "home").map((c) => c.value);
  let home = [];
  for (const k of many.slice(0, -1)) home = toggleCategory(home, k, CAT, 99).list;
  home = toggleCategory(home, many.at(-1), CAT, 99).list;
  assert.deepEqual(home, ["group:home"]);
});

test("limita de 6: grupele și categoriile individuale se numără, excluderile nu", () => {
  let list = [];
  for (const g of ["decor", "papetarie", "ceremonie", "home", "bijuterii"]) list = toggleCategoryGroup(list, g, CAT).list;
  list = toggleCategory(list, "cadouri_anime-manga", CAT).list;
  assert.equal(countCategoryPreferences(list, CAT), 6);
  assert.equal(toggleCategoryGroup(list, "arta", CAT).limited, true);
  assert.equal(toggleCategory(list, "party_cake-toppers", CAT).limited, true);
  // excluderile într-o grupă selectată sunt permise și la limită
  const withExclusions = toggleCategory(list, bijuterii[0], CAT);
  assert.equal(withExclusions.limited, false);
  assert.equal(countCategoryPreferences(withExclusions.list, CAT), 6);
  assert.equal(validateCategorySelection(withExclusions.list, { catalog: CAT }).ok, true);
  assert.equal(validateCategorySelection([...list, "group:arta"], { catalog: CAT }).ok, false);
});

test("subcategorii adăugate ulterior în catalog: incluse automat de grupa întreagă (nu de lista statică)", () => {
  const list = ["group:bijuterii", `exclude:${bijuterii[0]}`];
  const grown = [...CAT, { value: "bijuterii_brose-noi", group: "bijuterii" }];
  const before = expandCreatorCategories(list, CAT);
  const after = expandCreatorCategories(list, grown);
  assert.equal(before.has("bijuterii_brose-noi"), false);
  assert.equal(after.has("bijuterii_brose-noi"), true);
  assert.equal(after.has(bijuterii[0]), false);
  assert.equal(after.size, bijuterii.length);
});

test("valori vechi: grupă fără prefix = grupă întreagă; necunoscutele se păstrează; „alte” rămâne categorie", () => {
  const sel = parseCategorySelection(["decor", "party", "necunoscut", "alte"], CAT);
  assert.deepEqual([...sel.groups.keys()], ["decor", "party"]);
  assert.deepEqual(sel.unknown, ["necunoscut"]);
  assert.ok(sel.singles.has("alte"));
  assert.equal(categoryGroupState(["decor"], "decor", CAT), "full");
  // atingerea altei grupe nu rescrie valorile vechi
  const other = toggleCategory(["decor", "party"], "cadouri_anime-manga", CAT).list;
  assert.deepEqual(other, ["decor", "party", "cadouri_anime-manga"]);
  // atingerea grupei vechi o trece în forma nouă
  const touched = toggleCategory(["decor"], "decor_baloane", CAT).list;
  assert.deepEqual(touched, ["group:decor", "exclude:decor_baloane"]);
});

test("validarea: valorile noi trebuie să fie din catalog; cele deja salvate se păstrează", () => {
  assert.equal(validateCategorySelection(["group:bijuterii", "cadouri_anime-manga"], { catalog: CAT }).ok, true);
  for (const bad of [["group:inexistent"], ["decor"], ["exclude:bijuterii_bratari"], ["servicii_dj"]]) {
    assert.equal(validateCategorySelection(bad, { catalog: CAT }).ok, false, JSON.stringify(bad));
  }
  assert.equal(validateCategorySelection(["decor", "party"], { catalog: CAT, existing: ["decor", "party"] }).ok, true);
  assert.equal(CAT.length, CATEGORIES.length);
});
