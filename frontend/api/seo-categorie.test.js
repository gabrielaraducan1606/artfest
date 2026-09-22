// frontend/api/seo-categorie.test.js
//
// Teste pentru funcția Vercel /api/seo-categorie: HTML brut pentru
// /categorii/:slug. Fără rețea reală: `fetch` global e înlocuit cu un fals
// care servește (a) shell-ul REAL (frontend/index.html) și (b) răspunsul
// endpoint-ului public GET /api/public/products. Constantele SEO de
// categorie sunt cele REALE (src/constants/seoCategories.js).
//
// Rulare: node --test api/seo-categorie.test.js

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import handler from "./seo-categorie.js";
import {
  SEO_CATEGORIES,
  getCategoryBySlug,
} from "../src/constants/seoCategories.js";
import { buildCategoryStructuredData } from "../src/utils/seo/categorySeo.js";

const here = dirname(fileURLToPath(import.meta.url));
const SHELL = readFileSync(join(here, "..", "index.html"), "utf8");

const realFetch = globalThis.fetch;

let productsBehavior;
let productsUrls;

beforeEach(() => {
  productsUrls = [];
  productsBehavior = () => ({ status: 200, body: { items: [] } });

  globalThis.fetch = async (url) => {
    const href = String(url);

    if (href.endsWith("/index.html")) {
      return new Response(SHELL, { status: 200 });
    }

    if (href.includes("/api/public/product-cards")) {
      productsUrls.push(href);
      const out = productsBehavior(href);
      if (out.throws) throw new Error("network_down");
      return new Response(
        typeof out.body === "string" ? out.body : JSON.stringify(out.body),
        { status: out.status }
      );
    }

    throw new Error(`fetch neașteptat în test: ${href}`);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function fakeRes() {
  const res = {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(name, value) {
      res.headers[name.toLowerCase()] = value;
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
    send(payload) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

async function run(slug) {
  const res = fakeRes();
  await handler({ query: { slug } }, res);
  return res;
}

const LD_SCRIPT_RE =
  /<script type="application\/ld\+json" data-seo-ssr-jsonld="1">([\s\S]*?)<\/script>/g;

function jsonLdBlocks(html) {
  return [...html.matchAll(LD_SCRIPT_RE)].flatMap((m) => {
    const value = JSON.parse(m[1]);
    return Array.isArray(value) ? value : [value];
  });
}

function metaContent(html, attr, name) {
  const m = html.match(
    new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`)
  );
  return m ? m[1] : null;
}

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');

// o categorie reală, cu override SEO scris de mână (chei corectate)
const SLUG = "invitatii-nunta";
const CATEGORY = getCategoryBySlug(SLUG);

const PRODUCTS = [
  { id: "p1", title: "Invitație florală" },
  { id: "p2", title: "Invitație minimalistă" },
];

/* ---------- HTML brut ---------- */

test("categorie validă: title, description, canonical, og:* în HTML brut", async () => {
  productsBehavior = () => ({ status: 200, body: { items: PRODUCTS } });
  const res = await run(SLUG);
  const html = res.body;

  assert.equal(res.statusCode, 200);

  const expectedTitle = `${CATEGORY.title} | Produse • Artfest`;
  assert.equal(
    decode(html.match(/<title>([\s\S]*?)<\/title>/)[1]),
    expectedTitle
  );
  assert.equal(
    decode(metaContent(html, "name", "description")),
    CATEGORY.description
  );
  assert.match(
    html,
    /<link rel="canonical" href="https:\/\/www\.artfest\.ro\/categorii\/invitatii-nunta" data-seo="1" \/>/
  );
  assert.equal(
    metaContent(html, "property", "og:url"),
    "https://www.artfest.ro/categorii/invitatii-nunta"
  );
  assert.equal(decode(metaContent(html, "property", "og:title")), expectedTitle);
  assert.equal(
    decode(metaContent(html, "property", "og:description")),
    CATEGORY.description
  );
  assert.match(res.headers["cache-control"], /s-maxage=300/);
});

test("override-ul SEO al invitațiilor se aplică acum (cheia corectată)", () => {
  assert.equal(CATEGORY.key, "papetarie_invitatii-nunta");
  assert.equal(CATEGORY.h1, "Invitații nuntă personalizate");
  assert.match(CATEGORY.seoText, /invitații de nuntă handmade/);
});

test("HTML brut diferit de shell/homepage (înainte: doar shell generic)", async () => {
  assert.ok(!SHELL.includes('rel="canonical"'));
  assert.ok(!SHELL.includes("ld+json"));

  const html = (await run(SLUG)).body;
  assert.notEqual(html, SHELL);
  assert.ok(html.includes('rel="canonical"'));
  assert.ok(html.includes("application/ld+json"));
  assert.ok(!html.includes("Produse handmade, personalizate și pentru evenimente"));
  assert.ok(html.includes('<div id="root"></div>'));
});

test("două categorii => HTML brut diferit", async () => {
  const a = (await run("invitatii-nunta")).body;
  const b = (await run("lumanari-parfumate")).body;
  assert.notEqual(a, b);
  assert.match(b, /categorii\/lumanari-parfumate/);
  assert.ok(!b.includes("categorii/invitatii-nunta"));
});

test("canonical determinist: alte query params (ref, sort...) nu îl influențează; doar ?page=N>1 apare în el", async () => {
  const canonOf = async (query) => {
    const res = fakeRes();
    await handler({ query: { slug: SLUG, ...query } }, res);
    return [...res.body.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map(
      (m) => m[1]
    );
  };

  productsBehavior = () => ({ status: 200, body: { items: PRODUCTS } });

  assert.deepEqual(await canonOf({ ref: "abc", sort: "price" }), [
    "https://www.artfest.ro/categorii/invitatii-nunta",
  ]);
  assert.deepEqual(await canonOf({ page: "2", ref: "abc", sort: "price" }), [
    "https://www.artfest.ro/categorii/invitatii-nunta?page=2",
  ]);
});

/* ---------- JSON-LD ---------- */

test("JSON-LD: CollectionPage + ItemList (produse reale) + BreadcrumbList + FAQPage", async () => {
  productsBehavior = () => ({ status: 200, body: { items: PRODUCTS } });
  const nodes = jsonLdBlocks((await run(SLUG)).body);
  const byType = Object.fromEntries(nodes.map((n) => [n["@type"], n]));

  assert.deepEqual(Object.keys(byType).sort(), [
    "BreadcrumbList",
    "CollectionPage",
    "FAQPage",
  ]);

  assert.equal(byType.CollectionPage.url, "https://www.artfest.ro/categorii/invitatii-nunta");
  assert.equal(byType.CollectionPage.name, CATEGORY.h1);

  assert.equal(byType.CollectionPage.mainEntity["@type"], "ItemList");
  assert.deepEqual(
    byType.CollectionPage.mainEntity.itemListElement.map((e) => [e.position, e.url, e.name]),
    [
      [1, "https://www.artfest.ro/produs/p1", "Invitație florală"],
      [2, "https://www.artfest.ro/produs/p2", "Invitație minimalistă"],
    ]
  );

  assert.deepEqual(
    byType.BreadcrumbList.itemListElement.map((e) => [e.position, e.name, e.item]),
    [
      [1, "Acasă", "https://www.artfest.ro/"],
      [2, "Categorii", "https://www.artfest.ro/categorii"],
      [3, CATEGORY.h1, "https://www.artfest.ro/categorii/invitatii-nunta"],
    ]
  );

  assert.equal(byType.FAQPage.mainEntity.length, CATEGORY.faq.length);
});

test("ItemList doar din produse reale: rândurile fără id/titlu sunt omise", async () => {
  productsBehavior = () => ({
    status: 200,
    body: {
      items: [
        { id: "ok", title: "Valid" },
        { id: "", title: "Fără id" },
        { id: "x", title: "  " },
        { title: "Fără câmp id" },
        null,
      ],
    },
  });
  const page = jsonLdBlocks((await run(SLUG)).body).find(
    (n) => n["@type"] === "CollectionPage"
  );
  assert.equal(page.mainEntity.numberOfItems, 1);
});

test("categorie fără produse sau backend indisponibil/5xx/JSON invalid => aceleași metadate, FĂRĂ ItemList", async () => {
  const behaviors = [
    () => ({ status: 200, body: { items: [] } }),
    () => ({ throws: true }),
    () => ({ status: 500, body: { error: "boom" } }),
    () => ({ status: 200, body: "nu e json {" }),
    () => ({ status: 200, body: { items: "nu-e-array" } }),
  ];

  for (const behavior of behaviors) {
    productsBehavior = behavior;
    const res = await run(SLUG);
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /rel="canonical" href="https:\/\/www\.artfest\.ro\/categorii\/invitatii-nunta"/);

    const page = jsonLdBlocks(res.body).find((n) => n["@type"] === "CollectionPage");
    assert.ok(page, "CollectionPage rămâne");
    assert.ok(!("mainEntity" in page), "fără ItemList inventat");
  }
});

test("ItemList limitat la dimensiunea paginii (8); API-ul e cerut cu limit=8, page=1 și cheia categoriei", async () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, title: `Produs ${i}` }));
  productsBehavior = () => ({ status: 200, body: { items: many } });

  const page = jsonLdBlocks((await run(SLUG)).body).find(
    (n) => n["@type"] === "CollectionPage"
  );
  assert.equal(page.mainEntity.itemListElement.length, 8);

  assert.match(productsUrls[0], /category=papetarie_invitatii-nunta/);
  assert.match(productsUrls[0], /limit=8/);
  assert.match(productsUrls[0], /page=1/);
});

/* ---------- 404 ---------- */

test("slug invalid => HTTP 404 real + noindex, fără CollectionPage/ItemList/canonical", async () => {
  for (const slug of ["categorie-inexistenta", "constructor", "__proto__", "toString", "Invitatii-Nunta"]) {
    const res = await run(slug);
    const html = res.body;

    assert.equal(res.statusCode, 404, slug);
    assert.match(html, /<meta name="robots" content="noindex" data-seo="1" \/>/, slug);
    assert.ok(!html.includes('content="index, follow"'), slug);
    assert.match(html, /<title>Categorie indisponibilă \| Artfest<\/title>/, slug);
    assert.ok(!html.includes("application/ld+json"), slug);
    assert.ok(!html.includes("CollectionPage"), slug);
    assert.ok(!html.includes('rel="canonical"'), slug);
  }
  assert.equal(productsUrls.length, 0, "nu cerem produse pentru un slug invalid");
});

test("slug lipsă => shell neschimbat, fără cache", async () => {
  const res = await run("");
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, SHELL);
  assert.equal(res.headers["cache-control"], "no-store");
});

/* ---------- toate categoriile ---------- */

test("TOATE cele 125 de categorii au canonical propriu și title/description nenule", async () => {
  const seenCanonical = new Set();

  for (const category of Object.values(SEO_CATEGORIES)) {
    const res = await run(category.slug);
    assert.equal(res.statusCode, 200, category.slug);

    const canon = res.body.match(/<link rel="canonical" href="([^"]+)"/)[1];
    assert.equal(canon, `https://www.artfest.ro/categorii/${category.slug}`);
    assert.ok(!seenCanonical.has(canon), `canonical duplicat: ${canon}`);
    seenCanonical.add(canon);

    assert.ok(metaContent(res.body, "name", "description"), category.slug);
  }

  assert.equal(seenCanonical.size, Object.keys(SEO_CATEGORIES).length);
});

/* ---------- builder comun (funcție serverless + pagina React) ---------- */

test("builder: fără categorie/slug => array gol", () => {
  assert.deepEqual(buildCategoryStructuredData(), []);
  assert.deepEqual(buildCategoryStructuredData({ category: {} }), []);
});

test("builder: același rezultat pentru aceleași date (funcția și pagina folosesc același cod)", () => {
  const a = buildCategoryStructuredData({ category: CATEGORY, items: PRODUCTS });
  const b = buildCategoryStructuredData({ category: CATEGORY, items: [...PRODUCTS] });
  assert.deepEqual(a, b);
});
