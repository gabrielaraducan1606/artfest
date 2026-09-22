// src/routes/sitemap.test.js
//
// GET /sitemap.xml - fără DB real. Prisma e fals și APLICĂ efectiv clauzele
// `where` trimise de cod. Verifică:
//  - URL-urile de categorie sunt EXACT paginile rezolvate de frontend
//    (comparație cu frontend/src/constants/seoCategories.js - monorepo);
//  - o colecție intră în sitemap DOAR dacă e activă și are cel puțin un
//    produs public;
//  - numărul de interogări NU crește cu numărul de colecții (fără N+1).
//
// Rulare: node --experimental-test-module-mocks --test src/routes/sitemap.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5"; // niciodată contactat

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import {
  SEO_CATEGORIES_BY_SLUG,
  getCategoryBySlug,
} from "../../../frontend/src/constants/seoCategories.js";
import { CATEGORIES } from "../constants/categories.js";
import {
  CATEGORIES_WITHOUT_PAGE,
  getCategoryPageSlugs,
} from "../constants/categorySlugs.js";
import { matchWhere, project } from "../testing/matchWhere.js";

function collection(overrides = {}) {
  return {
    slug: "col",
    isActive: true,
    updatedAt: new Date("2026-05-01T00:00:00Z"),
    rules: { categories: ["c1"] },
    items: [],
    ...overrides,
  };
}

function product(overrides = {}) {
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
    updatedAt: new Date("2026-05-02T00:00:00Z"),
    service: {
      isActive: true,
      status: "ACTIVE",
      vendor: { isActive: true },
      type: { code: "products" },
    },
    ...overrides,
  };
}

async function fetchSitemap({ collections = [], products = [] } = {}) {
  const calls = { collection: [], product: [] };

  const db = {
    collection: {
      findMany: async (args) => {
        calls.collection.push(args);
        return collections
          .filter((c) => matchWhere(c, args.where))
          .map((c) => project(c, args.select));
      },
    },
    product: {
      findMany: async (args) => {
        calls.product.push(args);
        return products
          .filter((p) => matchWhere(p, args.where))
          .map((p) => project(p, args.select));
      },
    },
    serviceProfile: { findMany: async () => [] },
  };

  const restore = mock.module("../db.js", { namedExports: { prisma: db } });
  const mod = await import(`./sitemap.js?t=${Date.now()}-${Math.random()}`);

  const app = express();
  app.use("/", mod.default);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));

  const res = await fetch(
    `http://127.0.0.1:${server.address().port}/sitemap.xml`
  );
  const xml = await res.text();

  return {
    status: res.status,
    xml,
    calls,
    locs: [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]),
    cleanup: async () => {
      await new Promise((resolve) => server.close(resolve));
      restore.restore();
    },
  };
}

const CAT_PREFIX = "https://www.artfest.ro/categorii/";
const COL_PREFIX = "https://www.artfest.ro/colectii/";

const collectionLocs = (locs) =>
  locs.filter((l) => l.startsWith(COL_PREFIX)).map((l) => l.slice(COL_PREFIX.length));

/* ---------- categorii ---------- */

test("categorii: sitemap-ul listează EXACT paginile rezolvate de frontend (fără URL-uri moarte, fără pagini lipsă)", async (t) => {
  const { locs, cleanup } = await fetchSitemap();
  t.after(cleanup);

  const sitemapSlugs = locs
    .filter((l) => l.startsWith(CAT_PREFIX))
    .map((l) => l.slice(CAT_PREFIX.length));

  const frontendSlugs = Object.keys(SEO_CATEGORIES_BY_SLUG);

  // "Altele" (cheia "alte") e categoria-fallback: are pagină în frontend,
  // dar a fost exclusă deliberat din sitemap și înainte (nu e navigare).
  const deliberatelyExcluded = new Set(["altele"]);

  const dead = sitemapSlugs.filter((s) => !getCategoryBySlug(s)?.key);
  const missing = frontendSlugs.filter(
    (s) => !sitemapSlugs.includes(s) && !deliberatelyExcluded.has(s)
  );

  assert.deepEqual(dead, [], "URL-uri din sitemap pe care frontend-ul nu le rezolvă");
  assert.deepEqual(missing, [], "pagini de categorie lipsă din sitemap");
  assert.equal(new Set(sitemapSlugs).size, sitemapSlugs.length, "duplicate");
});

test("categorii: categoriile fără pagină în frontend sunt într-adevăr fără pagină (lista de excluderi nu e depășită)", () => {
  const frontendKeys = new Set(
    Object.values(SEO_CATEGORIES_BY_SLUG).map((c) => c.key)
  );

  for (const key of CATEGORIES_WITHOUT_PAGE) {
    if (key === "alte") continue;
    assert.ok(
      !frontendKeys.has(key),
      `${key} are acum pagină în frontend - scoate-l din CATEGORIES_WITHOUT_PAGE`
    );
  }

  const slugs = new Set(getCategoryPageSlugs());
  const withPage = CATEGORIES.filter((k) => !CATEGORIES_WITHOUT_PAGE.has(k));
  assert.ok(withPage.length > 0 && slugs.size > 0);
});

/* ---------- colecții: doar active ȘI cu produse publice ---------- */

test("colecție ACTIVĂ cu produse => în sitemap; canonical == <loc>", async (t) => {
  const { locs, cleanup } = await fetchSitemap({
    collections: [collection({ slug: "nunta" })],
    products: [product({ category: "c1" })],
  });
  t.after(cleanup);

  assert.deepEqual(collectionLocs(locs), ["nunta"]);
  assert.ok(locs.includes("https://www.artfest.ro/colectii/nunta"));
});

test("colecție activă FĂRĂ produse => absentă din sitemap", async (t) => {
  const { locs, cleanup } = await fetchSitemap({
    collections: [
      collection({ slug: "goala", rules: { categories: ["nimic"] } }),
    ],
    products: [product({ category: "c1" })],
  });
  t.after(cleanup);

  assert.deepEqual(collectionLocs(locs), []);
});

test("colecție INACTIVĂ => absentă, chiar dacă ar avea produse", async (t) => {
  const { locs, calls, cleanup } = await fetchSitemap({
    collections: [collection({ slug: "inactiva", isActive: false })],
    products: [product({ category: "c1" })],
  });
  t.after(cleanup);

  assert.deepEqual(collectionLocs(locs), []);
  assert.deepEqual(calls.collection[0].where, { isActive: true });
});

test("produsele nepublice nu contează: colecția cu doar produse ascunse/neaprobate/de alt tip => absentă", async (t) => {
  const { locs, cleanup } = await fetchSitemap({
    collections: [collection({ slug: "doar-nepublice" })],
    products: [
      product({ id: "a", isHidden: true }),
      product({ id: "b", moderationStatus: "PENDING" }),
      product({ id: "c", isActive: false }),
      product({
        id: "d",
        service: {
          isActive: true,
          status: "ACTIVE",
          vendor: { isActive: true },
          type: { code: "digital" },
        },
      }),
    ],
  });
  t.after(cleanup);

  assert.deepEqual(collectionLocs(locs), []);
});

test("produs fixat public => colecția intră; produs exclus => nu se numără", async (t) => {
  const { locs, cleanup } = await fetchSitemap({
    collections: [
      collection({
        slug: "cu-pinned",
        rules: { categories: ["nimic"] },
        items: [{ productId: "pin", pinned: true, excluded: false }],
      }),
      collection({
        slug: "exclusa",
        rules: { categories: ["c1"] },
        items: [{ productId: "p1", pinned: false, excluded: true }],
      }),
    ],
    products: [product({ id: "p1", category: "c1" }), product({ id: "pin", category: "altceva" })],
  });
  t.after(cleanup);

  assert.deepEqual(collectionLocs(locs), ["cu-pinned"]);
});

test("colecții cu și fără produse, împreună: doar cele cu produse, lastmod păstrat", async (t) => {
  const { locs, xml, cleanup } = await fetchSitemap({
    collections: [
      collection({ slug: "a", rules: { categories: ["c1"] } }),
      collection({ slug: "b", rules: { categories: ["nimic"] } }),
      collection({ slug: "c", rules: {} }),
      collection({ slug: "d", isActive: false }),
    ],
    products: [product({ category: "c1" })],
  });
  t.after(cleanup);

  assert.deepEqual(collectionLocs(locs).sort(), ["a", "c"]);
  assert.match(xml, /colectii\/a<\/loc>\s*<lastmod>2026-05-01<\/lastmod>/);
});

/* ---------- FĂRĂ N+1 ---------- */

test("număr CONSTANT de interogări indiferent de numărul colecțiilor (1, 10, 100)", async (t) => {
  const products = [product({ id: "p1", category: "c1" }), product({ id: "pin", category: "z" })];

  const make = (n) =>
    Array.from({ length: n }, (_, i) =>
      collection({
        slug: `c-${i}`,
        rules: { categories: [i % 2 ? "c1" : "inexistent"] },
        items: i % 3 === 0 ? [{ productId: "pin", pinned: true, excluded: false }] : [],
      })
    );

  const counts = [];
  for (const n of [1, 10, 100]) {
    const { calls, cleanup } = await fetchSitemap({ collections: make(n), products });
    counts.push({ collection: calls.collection.length, product: calls.product.length });
    await cleanup();
  }

  // interogări pe colecții: mereu 1
  assert.deepEqual(counts.map((c) => c.collection), [1, 1, 1]);
  // pe produse: sitemap-ul (produse) + max 2 pentru colecții, dar NICIODATĂ
  // mai multe pentru 100 de colecții decât pentru 10
  assert.ok(counts.every((c) => c.product <= 3), JSON.stringify(counts));
  assert.equal(counts[2].product, counts[1].product);
  t.diagnostic(`interogări (colecții/produse) pentru 1/10/100 colecții: ${JSON.stringify(counts)}`);
});

/* ---------- restul sitemap-ului ---------- */

test("pagina index /colectii e în sitemap, alături de /categorii", async (t) => {
  const { locs, cleanup } = await fetchSitemap();
  t.after(cleanup);

  assert.ok(locs.includes("https://www.artfest.ro/colectii"));
  assert.ok(locs.includes("https://www.artfest.ro/categorii"));
});

test("URL-urile paginate (?page=N) NU sunt în sitemap (se descoperă prin linkuri Următoarea/Anterioara)", async (t) => {
  const { locs, cleanup } = await fetchSitemap({
    collections: [collection({ slug: "nunta" })],
    products: [product()],
  });
  t.after(cleanup);

  assert.ok(locs.every((l) => !l.includes("?")));
});

test("sitemap-ul răspunde 200 XML valid (urlset)", async (t) => {
  const { status, xml, cleanup } = await fetchSitemap();
  t.after(cleanup);

  assert.equal(status, 200);
  assert.ok(xml.startsWith("<?xml"));
  assert.ok(xml.includes("<urlset"));
});
