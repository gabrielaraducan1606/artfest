// Rulare: node --test api/structuredData.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_ITEMLIST_ITEMS,
  buildBreadcrumbList,
  buildLinkItemList,
  buildProductItemList,
} from "./structuredData.js";
import {
  buildCollectionStructuredData,
  buildCollectionsIndexStructuredData,
  collectionBreadcrumbs,
} from "./collectionSeo.js";
import {
  buildCategoryStructuredData,
  categoryBreadcrumbs,
} from "./categorySeo.js";

/* ---------- BreadcrumbList ---------- */

test("BreadcrumbList: pași în ordine, poziții 1..n, URL-uri absolute", () => {
  const out = buildBreadcrumbList([
    { name: "Acasă", url: "https://www.artfest.ro/" },
    { name: " Colecții ", url: "https://www.artfest.ro/colectii" },
  ]);

  assert.equal(out["@type"], "BreadcrumbList");
  assert.deepEqual(
    out.itemListElement.map((e) => [e.position, e.name, e.item]),
    [
      [1, "Acasă", "https://www.artfest.ro/"],
      [2, "Colecții", "https://www.artfest.ro/colectii"],
    ]
  );
});

test("BreadcrumbList: pași invalizi omiși; < 2 pași valizi => null (nu inventăm)", () => {
  assert.equal(buildBreadcrumbList([{ name: "Acasă", url: "https://a.ro/" }]), null);
  assert.equal(buildBreadcrumbList([{ name: "", url: "https://a.ro/" }, { name: "x", url: "/relativ" }]), null);
  assert.equal(buildBreadcrumbList(undefined), null);
  assert.equal(
    buildBreadcrumbList([
      { name: "A", url: "https://a.ro/" },
      { name: "", url: "https://a.ro/x" },
      { name: "C", url: "https://a.ro/c" },
    ]).itemListElement.length,
    2
  );
});

/* ---------- ItemList ---------- */

test("ItemList de produse: doar id + titlu, limitat", () => {
  assert.equal(buildProductItemList([]), null);
  assert.equal(buildProductItemList([{ id: "", title: "x" }, null, { id: "a" }]), null);

  const many = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, title: `P${i}` }));
  assert.equal(buildProductItemList(many).itemListElement.length, MAX_ITEMLIST_ITEMS);
  assert.equal(
    buildProductItemList([{ id: "a b", title: "T" }]).itemListElement[0].url,
    "https://www.artfest.ro/produs/a%20b"
  );
});

test("ItemList de linkuri: doar intrări cu nume și URL http(s)", () => {
  assert.equal(buildLinkItemList([{ name: "x", url: "/r" }]), null);
  assert.equal(
    buildLinkItemList([{ name: "A", url: "https://a.ro/a" }, { name: "", url: "https://a.ro/b" }])
      .numberOfItems,
    1
  );
});

/* ---------- colecții ---------- */

const COLLECTION = { slug: "nunta", title: "Colecția Nuntă", seoTitle: "Idei nuntă" };

test("colecție: breadcrumbs vizibile și JSON-LD vin din aceeași sursă (Acasă > Colecții > titlu)", () => {
  const crumbs = collectionBreadcrumbs(COLLECTION);
  assert.deepEqual(
    crumbs.map((c) => [c.name, c.to]),
    [
      ["Acasă", "/"],
      ["Colecții", "/colectii"],
      ["Colecția Nuntă", "/colectii/nunta"],
    ]
  );

  const [, breadcrumb] = buildCollectionStructuredData({
    collection: COLLECTION,
    items: [],
  });
  assert.deepEqual(
    breadcrumb.itemListElement.map((e) => e.name),
    crumbs.map((c) => c.name)
  );
  assert.deepEqual(
    breadcrumb.itemListElement.map((e) => e.item),
    crumbs.map((c) => c.url)
  );
});

test("colecție: ultimul pas = canonical-ul colecției (neschimbat de breadcrumb)", () => {
  const [page, breadcrumb] = buildCollectionStructuredData({
    collection: COLLECTION,
    items: [],
  });
  assert.equal(page.url, "https://www.artfest.ro/colectii/nunta");
  assert.equal(breadcrumb.itemListElement.at(-1).item, page.url);
});

test("colecție fără slug => niciun JSON-LD", () => {
  assert.deepEqual(buildCollectionStructuredData({ collection: {} }), []);
  assert.deepEqual(buildCollectionStructuredData(), []);
});

test("index colecții: ItemList doar din colecții reale; BreadcrumbList Acasă > Colecții", () => {
  const [page, breadcrumb] = buildCollectionsIndexStructuredData([
    { slug: "nunta", title: "Nuntă" },
    { slug: "", title: "Fără slug" },
    { slug: "x", title: "" },
  ]);

  assert.equal(page.url, "https://www.artfest.ro/colectii");
  assert.deepEqual(
    page.mainEntity.itemListElement.map((e) => e.url),
    ["https://www.artfest.ro/colectii/nunta"]
  );
  assert.equal(breadcrumb.itemListElement.length, 2);

  const [empty] = buildCollectionsIndexStructuredData([]);
  assert.ok(!("mainEntity" in empty));
});

/* ---------- categorii ---------- */

const CATEGORY = {
  slug: "lumanari-parfumate",
  label: "Lumânări parfumate",
  h1: "Lumânări parfumate",
  title: "Lumânări parfumate handmade",
  description: "Descriere.",
  faq: [{ q: "Întrebare?", a: "Răspuns." }],
};

test("categorie: breadcrumbs Acasă > Categorii > categorie, aceeași sursă pentru UI și JSON-LD", () => {
  const crumbs = categoryBreadcrumbs(CATEGORY);
  assert.deepEqual(
    crumbs.map((c) => [c.name, c.to]),
    [
      ["Acasă", "/"],
      ["Categorii", "/categorii"],
      ["Lumânări parfumate", "/categorii/lumanari-parfumate"],
    ]
  );

  const nodes = buildCategoryStructuredData({ category: CATEGORY, items: [] });
  const breadcrumb = nodes.find((n) => n["@type"] === "BreadcrumbList");
  assert.deepEqual(
    breadcrumb.itemListElement.map((e) => e.item),
    crumbs.map((c) => c.url)
  );
});

test("categorie: FAQPage doar când există FAQ valid; ItemList doar cu produse reale", () => {
  const withFaq = buildCategoryStructuredData({ category: CATEGORY, items: [] });
  assert.ok(withFaq.some((n) => n["@type"] === "FAQPage"));
  assert.ok(!("mainEntity" in withFaq[0]));

  const noFaq = buildCategoryStructuredData({
    category: { ...CATEGORY, faq: [{ q: "", a: "" }] },
    items: [{ id: "p1", title: "Produs" }],
  });
  assert.ok(!noFaq.some((n) => n["@type"] === "FAQPage"));
  assert.equal(noFaq[0].mainEntity.numberOfItems, 1);
});
