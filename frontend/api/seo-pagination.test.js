// frontend/api/seo-pagination.test.js
//
// Paginare crawlabilă ?page=N pentru /categorii/:slug și /colectii/:slug
// (funcțiile Vercel /api/seo-categorie și /api/seo-colectie, cu `fetch`
// fals și shell-ul REAL index.html) + helper-ul pur pagination.js.
//
// Rulare: node --test api/seo-pagination.test.js

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import seoCategorie from "./seo-categorie.js";
import seoColectie from "./seo-colectie.js";
import {
  MAX_PAGE,
  paginationLinks,
  parsePage,
  withPage,
  withPageInTitle,
} from "../src/utils/seo/pagination.js";

const here = dirname(fileURLToPath(import.meta.url));
const SHELL = readFileSync(join(here, "..", "index.html"), "utf8");

const realFetch = globalThis.fetch;

// Comportamentul backend-ului, controlat de fiecare test
let cardsBehavior; // GET /api/public/product-cards
let collectionBehavior; // GET /api/public/collections/:slug
let requested; // URL-urile cerute backend-ului

beforeEach(() => {
  requested = [];
  cardsBehavior = () => ({ status: 200, body: { items: [] } });
  collectionBehavior = () => ({ status: 200, body: {} });

  globalThis.fetch = async (url) => {
    const href = String(url);

    if (href.endsWith("/index.html")) return new Response(SHELL);

    const behavior = href.includes("/api/public/product-cards")
      ? cardsBehavior
      : href.includes("/api/public/collections/")
        ? collectionBehavior
        : null;

    if (!behavior) throw new Error(`fetch neașteptat: ${href}`);

    requested.push(href);
    const out = behavior(href);
    if (out.throws) throw new Error("network_down");
    return new Response(JSON.stringify(out.body), { status: out.status });
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
    setHeader(k, v) {
      res.headers[k.toLowerCase()] = v;
    },
    status(c) {
      res.statusCode = c;
      return res;
    },
    send(b) {
      res.body = b;
      return res;
    },
  };
  return res;
}

async function run(handler, slug, page) {
  const res = fakeRes();
  await handler({ query: { slug, ...(page === undefined ? {} : { page }) } }, res);
  return res;
}

const LD_RE =
  /<script type="application\/ld\+json" data-seo-ssr-jsonld="1">([\s\S]*?)<\/script>/g;

const jsonLd = (html) =>
  [...html.matchAll(LD_RE)].flatMap((m) => {
    const v = JSON.parse(m[1]);
    return Array.isArray(v) ? v : [v];
  });

const canonicals = (html) =>
  [...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map((m) => m[1]);

const titleOf = (html) =>
  html
    .match(/<title>([\s\S]*?)<\/title>/)[1]
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'");

const collectionNode = (html) =>
  jsonLd(html).find((n) => n["@type"] === "CollectionPage");

const pageFromUrl = (href) => Number(new URL(href).searchParams.get("page"));

/* =========================================================
   Helper pur: parsePage / withPage / paginationLinks
========================================================= */

test("parsePage: lipsă => pagina 1 validă; numere valide", () => {
  for (const raw of [undefined, null, ""]) {
    assert.deepEqual(parsePage(raw), { page: 1, valid: true });
  }
  assert.deepEqual(parsePage("1"), { page: 1, valid: true });
  assert.deepEqual(parsePage("2"), { page: 2, valid: true });
  assert.deepEqual(parsePage("37"), { page: 37, valid: true });
  assert.deepEqual(parsePage(String(MAX_PAGE)), { page: MAX_PAGE, valid: true });
});

test("parsePage: 0, negativ, NaN, zecimal, semn, exponent, zero în față, spații, > MAX_PAGE, tipuri greșite => pagina 1 invalidă", () => {
  for (const bad of [
    "0", "-1", "-0", "NaN", "abc", "1.5", "2.0", "+2", "1e3", "02", "00", " 2", "2 ", "0x10",
    String(MAX_PAGE + 1), "99999", "١٢", ["1", "2"], 2, {}, true,
  ]) {
    assert.deepEqual(parsePage(bad), { page: 1, valid: false }, JSON.stringify(bad));
  }
});

test("withPage / withPageInTitle: doar pagina > 1 primește ?page=N și 'Pagina N'", () => {
  assert.equal(withPage("/x", 1), "/x");
  assert.equal(withPage("/x", 2), "/x?page=2");
  assert.equal(withPage("https://a.ro/x", 12), "https://a.ro/x?page=12");
  assert.equal(withPageInTitle("Titlu", 1), "Titlu");
  assert.equal(withPageInTitle("Titlu", 3), "Titlu - Pagina 3");
});

test("paginationLinks: Pagina anterioară / următoare", () => {
  // pagina 1: doar următoarea
  assert.deepEqual(paginationLinks({ basePath: "/c/x", page: 1, hasNext: true }), {
    prev: null,
    next: { page: 2, to: "/c/x?page=2" },
  });

  // pagina 2: anterioara duce la URL-ul CURAT (pagina 1), următoarea la ?page=3
  assert.deepEqual(paginationLinks({ basePath: "/c/x", page: 2, hasNext: true }), {
    prev: { page: 1, to: "/c/x" },
    next: { page: 3, to: "/c/x?page=3" },
  });

  // ultima pagină: doar anterioara
  assert.deepEqual(paginationLinks({ basePath: "/c/x", page: 4, hasNext: false }), {
    prev: { page: 3, to: "/c/x?page=3" },
    next: null,
  });

  // o singură pagină: niciun link
  assert.deepEqual(paginationLinks({ basePath: "/c/x", page: 1, hasNext: false }), {
    prev: null,
    next: null,
  });
});

test("paginationLinks: pagină invalidă => tratată ca 1; nicio legătură spre page=0/negativ; plafon MAX_PAGE", () => {
  for (const bad of [0, -2, NaN, 1.5, undefined]) {
    const { prev, next } = paginationLinks({ basePath: "/c/x", page: bad, hasNext: true });
    assert.equal(prev, null, String(bad));
    assert.equal(next.to, "/c/x?page=2", String(bad));
  }

  const last = paginationLinks({ basePath: "/c/x", page: MAX_PAGE, hasNext: true });
  assert.equal(last.next, null);
});

/* =========================================================
   /categorii/:slug?page=N
========================================================= */

const CAT = "invitatii-nunta";
const CAT_URL = "https://www.artfest.ro/categorii/invitatii-nunta";

// 8 produse/pagină, 3 pagini pline; dincolo de a 3-a => listă goală
function pagedCards() {
  cardsBehavior = (href) => {
    const page = pageFromUrl(href);
    if (page > 3) return { status: 200, body: { items: [] } };
    return {
      status: 200,
      body: {
        items: Array.from({ length: 8 }, (_, i) => ({
          id: `c${page}-${i}`,
          title: `Produs pagina ${page} nr ${i}`,
        })),
      },
    };
  };
}

test("categorie: page=1 sau lipsă => canonical CURAT, fără sufix în titlu", async () => {
  pagedCards();
  for (const page of [undefined, "1"]) {
    const res = await run(seoCategorie, CAT, page);
    assert.deepEqual(canonicals(res.body), [CAT_URL], String(page));
    assert.ok(!/Pagina \d/.test(titleOf(res.body)), String(page));
  }
});

test("categorie: page=2 => canonical PROPRIU ?page=2 (nu spre pagina 1), titlu 'Pagina 2', og:url la fel", async () => {
  pagedCards();
  const res = await run(seoCategorie, CAT, "2");

  assert.equal(res.statusCode, 200);
  assert.deepEqual(canonicals(res.body), [`${CAT_URL}?page=2`]);
  assert.match(titleOf(res.body), /- Pagina 2 • Artfest$/);
  assert.match(res.body, new RegExp(`og:url" content="${CAT_URL.replace(/\//g, "\\/")}\\?page=2"`));
});

test("categorie: canonical diferit pe fiecare pagină, niciodată spre pagina 1 pentru N>1", async () => {
  pagedCards();
  const seen = new Set();
  for (const page of ["1", "2", "3"]) {
    const [canon] = canonicals((await run(seoCategorie, CAT, page)).body);
    assert.ok(!seen.has(canon), `duplicat ${canon}`);
    seen.add(canon);
  }
  assert.equal(seen.size, 3);
});

test("categorie: API-ul e cerut pentru PAGINA respectivă (page=N&limit=8)", async () => {
  pagedCards();
  await run(seoCategorie, CAT, "3");
  assert.equal(pageFromUrl(requested[0]), 3);
  assert.match(requested[0], /limit=8/);
});

test("categorie: ItemList DIFERIT pe page=1 vs page=2 - doar produsele paginii, poziții continue", async () => {
  pagedCards();
  const p1 = collectionNode((await run(seoCategorie, CAT, "1")).body);
  const p2 = collectionNode((await run(seoCategorie, CAT, "2")).body);

  const urls1 = p1.mainEntity.itemListElement.map((e) => e.url);
  const urls2 = p2.mainEntity.itemListElement.map((e) => e.url);

  assert.equal(urls1.length, 8);
  assert.equal(urls2.length, 8);
  assert.ok(urls1.every((u) => u.includes("/produs/c1-")));
  assert.ok(urls2.every((u) => u.includes("/produs/c2-")));
  assert.equal(urls1.filter((u) => urls2.includes(u)).length, 0);

  assert.deepEqual(
    p2.mainEntity.itemListElement.map((e) => e.position),
    [9, 10, 11, 12, 13, 14, 15, 16]
  );
  assert.equal(p1.url, CAT_URL);
  assert.equal(p2.url, `${CAT_URL}?page=2`);
});

test("categorie: BreadcrumbList rămâne pe URL-ul de bază; FAQPage doar pe pagina 1", async () => {
  pagedCards();
  const n1 = jsonLd((await run(seoCategorie, CAT, "1")).body);
  const n2 = jsonLd((await run(seoCategorie, CAT, "2")).body);

  assert.ok(n1.some((n) => n["@type"] === "FAQPage"));
  assert.ok(!n2.some((n) => n["@type"] === "FAQPage"));
  assert.equal(
    n2.find((n) => n["@type"] === "BreadcrumbList").itemListElement.at(-1).item,
    CAT_URL
  );
});

test("categorie: page invalid (0, negativ, NaN, zecimal, cu semn, exponent, prea mare, listă) => pagina 1, canonical curat, niciodată ?page=0", async () => {
  pagedCards();
  for (const bad of ["0", "-1", "-3", "abc", "NaN", "1.5", "+2", "1e3", "02", " 2", "99999", ["1", "2"]]) {
    const res = await run(seoCategorie, CAT, bad);
    assert.equal(res.statusCode, 200, JSON.stringify(bad));
    assert.deepEqual(canonicals(res.body), [CAT_URL], JSON.stringify(bad));
    assert.ok(!/page=(0|-|NaN)/.test(res.body), JSON.stringify(bad));
  }
  // și API-ul a fost cerut pentru pagina 1
  assert.ok(requested.every((u) => pageFromUrl(u) === 1));
});

test("categorie: page dincolo de ultima => 404 REAL + noindex, fără canonical și fără CollectionPage/ItemList/JSON-LD", async () => {
  pagedCards();

  for (const beyond of ["4", "7", "500"]) {
    const res = await run(seoCategorie, CAT, beyond);

    assert.equal(res.statusCode, 404, `page=${beyond}`);
    assert.match(res.body, /<meta name="robots" content="noindex" data-seo="1" \/>/);
    assert.ok(!res.body.includes('content="index, follow"'));
    assert.ok(!res.body.includes('rel="canonical"'));
    assert.ok(!res.body.includes("application/ld+json"));
    assert.ok(!res.body.includes("CollectionPage"));
    assert.ok(!res.body.includes("ItemList"));
    assert.ok(!res.body.includes('property="og:url"'));
    assert.match(titleOf(res.body), /^Pagină indisponibilă \| Artfest$/);
  }
});

test("categorie: dincolo de ultima NU redirecționează la ultima pagină și NU devine page=1 (API-ul e cerut pentru pagina cerută)", async () => {
  pagedCards();
  const res = await run(seoCategorie, CAT, "7");

  assert.equal(res.statusCode, 404);
  assert.ok(!res.headers.location, "fără redirect");
  assert.equal(requested.length, 1);
  assert.equal(pageFromUrl(requested[0]), 7);
});

test("categorie: ultima pagină reală rămâne 200 indexabilă (limita 404 e exact după ultima)", async () => {
  pagedCards(); // 3 pagini pline
  const last = await run(seoCategorie, CAT, "3");
  assert.equal(last.statusCode, 200);
  assert.deepEqual(canonicals(last.body), [`${CAT_URL}?page=3`]);

  const after = await run(seoCategorie, CAT, "4");
  assert.equal(after.statusCode, 404);
});

test("categorie: eroare de backend pe page>1 NU e pagină goală (fără noindex, fără ItemList inventat)", async () => {
  for (const behavior of [() => ({ throws: true }), () => ({ status: 500, body: {} })]) {
    cardsBehavior = behavior;
    const res = await run(seoCategorie, CAT, "2");

    assert.equal(res.statusCode, 200);
    assert.ok(!res.body.includes('content="noindex"'));
    assert.deepEqual(canonicals(res.body), [`${CAT_URL}?page=2`]);
    assert.ok(!("mainEntity" in collectionNode(res.body)));
  }
});

test("categorie: slug invalid = 404 real + noindex indiferent de ?page=, fără cereri către backend", async () => {
  pagedCards();
  for (const page of [undefined, "1", "2", "0"]) {
    const res = await run(seoCategorie, "categorie-inexistenta", page);
    assert.equal(res.statusCode, 404);
    assert.match(res.body, /content="noindex"/);
  }
  assert.equal(requested.length, 0);
});

/* =========================================================
   /colectii/:slug?page=N
========================================================= */

const COL = "nunta";
const COL_URL = "https://www.artfest.ro/colectii/nunta";

const COLLECTION = {
  slug: COL,
  title: "Colecția Nuntă",
  seoTitle: "Idei handmade pentru nuntă",
  seoDescription: "Invitații și mărturii pentru nuntă.",
  heroImage: "https://cdn.artfest.ro/hero.jpg",
};

// 24 produse/pagină, 2 pagini pline; dincolo de a 2-a => listă goală
function pagedCollection() {
  collectionBehavior = (href) => {
    const page = pageFromUrl(href);
    const items =
      page > 2
        ? []
        : Array.from({ length: 24 }, (_, i) => ({
            id: `k${page}-${i}`,
            title: `Produs colecție ${page}-${i}`,
          }));
    return { status: 200, body: { collection: COLLECTION, items, hasMore: page < 2 } };
  };
}

test("colecție: page=1 sau lipsă => canonical CURAT; page=2 => ?page=2 propriu, titlu 'Pagina 2'", async () => {
  pagedCollection();

  for (const page of [undefined, "1"]) {
    const res = await run(seoColectie, COL, page);
    assert.deepEqual(canonicals(res.body), [COL_URL], String(page));
    assert.ok(!/Pagina \d/.test(titleOf(res.body)));
  }

  const res2 = await run(seoColectie, COL, "2");
  assert.deepEqual(canonicals(res2.body), [`${COL_URL}?page=2`]);
  assert.match(titleOf(res2.body), /Idei handmade pentru nuntă - Pagina 2 • Artfest$/);
});

test("colecție: API-ul e cerut pentru pagina respectivă (page=N&limit=24)", async () => {
  pagedCollection();
  await run(seoColectie, COL, "2");
  assert.equal(pageFromUrl(requested[0]), 2);
  assert.match(requested[0], /limit=24/);
});

test("colecție: ItemList DIFERIT pe page=1 vs page=2, poziții continue, fără produse comune", async () => {
  pagedCollection();
  const p1 = collectionNode((await run(seoColectie, COL, "1")).body);
  const p2 = collectionNode((await run(seoColectie, COL, "2")).body);

  const urls1 = p1.mainEntity.itemListElement.map((e) => e.url);
  const urls2 = p2.mainEntity.itemListElement.map((e) => e.url);

  assert.equal(urls1.length, 24);
  assert.equal(urls2.length, 24);
  assert.equal(urls1.filter((u) => urls2.includes(u)).length, 0);
  assert.equal(p1.mainEntity.itemListElement[0].position, 1);
  assert.equal(p2.mainEntity.itemListElement[0].position, 25);
  assert.equal(p2.mainEntity.itemListElement.at(-1).position, 48);
  assert.equal(p2.url, `${COL_URL}?page=2`);
});

test("colecție: BreadcrumbList Acasă > Colecții > titlu rămâne pe URL-ul de bază", async () => {
  pagedCollection();
  const crumbs = jsonLd((await run(seoColectie, COL, "2")).body).find(
    (n) => n["@type"] === "BreadcrumbList"
  );
  assert.deepEqual(
    crumbs.itemListElement.map((e) => e.item),
    ["https://www.artfest.ro/", "https://www.artfest.ro/colectii", COL_URL]
  );
});

test("colecție: page invalid => pagina 1, canonical curat, niciodată ?page=0", async () => {
  pagedCollection();
  for (const bad of ["0", "-1", "abc", "NaN", "1.5", "+2", "1e3", "02", "99999", ["1", "2"]]) {
    const res = await run(seoColectie, COL, bad);
    assert.equal(res.statusCode, 200, JSON.stringify(bad));
    assert.deepEqual(canonicals(res.body), [COL_URL], JSON.stringify(bad));
    assert.ok(!/page=(0|-|NaN)/.test(res.body));
  }
  assert.ok(requested.every((u) => pageFromUrl(u) === 1));
});

test("colecție: page dincolo de ultima => 404 REAL + noindex, fără canonical și fără CollectionPage/ItemList/JSON-LD; ultima pagină reală rămâne 200", async () => {
  pagedCollection(); // 2 pagini pline

  const last = await run(seoColectie, COL, "2");
  assert.equal(last.statusCode, 200);
  assert.deepEqual(canonicals(last.body), [`${COL_URL}?page=2`]);

  for (const beyond of ["3", "9", "500"]) {
    const res = await run(seoColectie, COL, beyond);

    assert.equal(res.statusCode, 404, `page=${beyond}`);
    assert.match(res.body, /<meta name="robots" content="noindex" data-seo="1" \/>/);
    assert.ok(!res.body.includes('content="index, follow"'));
    assert.ok(!res.body.includes('rel="canonical"'));
    assert.ok(!res.body.includes("application/ld+json"));
    assert.ok(!res.body.includes("CollectionPage"));
    assert.ok(!res.body.includes("ItemList"));
    assert.ok(!res.body.includes("BreadcrumbList"));
    assert.ok(!res.body.includes('property="og:url"'));
    assert.match(titleOf(res.body), /^Pagină indisponibilă \| Artfest$/);
  }
});

test("colecție: dincolo de ultima NU redirecționează și NU devine page=1 (API-ul e cerut pentru pagina cerută)", async () => {
  pagedCollection();
  const res = await run(seoColectie, COL, "9");

  assert.equal(res.statusCode, 404);
  assert.ok(!res.headers.location, "fără redirect");
  assert.equal(pageFromUrl(requested[0]), 9);
});

test("colecție: slug inexistent rămâne 404", async () => {
  pagedCollection();

  collectionBehavior = () => ({ status: 404, body: { error: "collection_not_found" } });
  for (const page of [undefined, "1", "2"]) {
    const res = await run(seoColectie, "nu-exista", page);
    assert.equal(res.statusCode, 404);
    assert.match(res.body, /content="noindex"/);
  }
});

test("HTML brut pentru ?page=N diferă de shell-ul generic (înainte: identic pe toate paginile)", async () => {
  pagedCards();
  const html = (await run(seoCategorie, CAT, "3")).body;
  assert.notEqual(html, SHELL);
  assert.ok(html.includes('rel="canonical"'));
});
