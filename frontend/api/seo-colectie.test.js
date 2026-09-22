// frontend/api/seo-colectie.test.js
//
// Teste pentru funcția Vercel /api/seo-colectie: HTML brut pentru
// /colectii/:slug. Fără rețea reală: `fetch` global e înlocuit cu un fals
// care servește (a) shell-ul REAL (frontend/index.html) și (b) răspunsul
// endpoint-ului public GET /api/public/collections/:slug.
//
// Rulare: node --test api/seo-colectie.test.js

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import handler from "./seo-colectie.js";
import {
  buildCollectionJsonLd,
  collectionCanonicalUrl,
} from "../src/utils/seo/collectionSeo.js";

const here = dirname(fileURLToPath(import.meta.url));
const SHELL = readFileSync(join(here, "..", "index.html"), "utf8");

const realFetch = globalThis.fetch;

let apiBehavior;

beforeEach(() => {
  apiBehavior = () => ({ status: 200, body: {} });

  globalThis.fetch = async (url) => {
    const href = String(url);

    if (href.endsWith("/index.html")) {
      return new Response(SHELL, { status: 200 });
    }

    if (href.includes("/api/public/collections")) {
      const out = apiBehavior(href);
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

// toate nodurile JSON-LD din HTML (un <script> poate conține un array)
function jsonLdBlocks(html) {
  return [...html.matchAll(LD_SCRIPT_RE)].flatMap((m) => {
    const value = JSON.parse(m[1]);
    return Array.isArray(value) ? value : [value];
  });
}

function jsonLdScriptCount(html) {
  return [...html.matchAll(LD_SCRIPT_RE)].length;
}

function metaContent(html, attr, name) {
  const m = html.match(
    new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`)
  );
  return m ? m[1] : null;
}

const COLLECTION = {
  id: "c1",
  slug: "nunta",
  title: "Colecția Nuntă",
  subtitle: "Tot ce îți trebuie pentru nuntă",
  description: "<p>Text lung</p>",
  seoTitle: "Idei handmade pentru nuntă",
  seoDescription: "Invitații, mărturii și decor handmade pentru nuntă.",
  heroImage: "https://cdn.artfest.ro/hero.jpg",
};

const PRODUCTS = [
  { id: "p1", title: "Invitație florală" },
  { id: "p2", title: "Mărturie din ceară" },
];

function serve(collection, items) {
  apiBehavior = () => ({ status: 200, body: { collection, items } });
}

/* ---------- HTML brut pentru colecție validă ---------- */

test("colecție validă: title, description, canonical, og:* în HTML brut", async () => {
  serve(COLLECTION, PRODUCTS);
  const res = await run("nunta");
  const html = res.body;

  assert.equal(res.statusCode, 200);
  assert.match(
    html,
    /<title>Idei handmade pentru nuntă • Artfest<\/title>/
  );
  assert.equal(
    metaContent(html, "name", "description"),
    "Invitații, mărturii și decor handmade pentru nuntă."
  );
  assert.match(
    html,
    /<link rel="canonical" href="https:\/\/www\.artfest\.ro\/colectii\/nunta" data-seo="1" \/>/
  );
  assert.equal(
    metaContent(html, "property", "og:title"),
    "Idei handmade pentru nuntă • Artfest"
  );
  assert.equal(
    metaContent(html, "property", "og:description"),
    "Invitații, mărturii și decor handmade pentru nuntă."
  );
  assert.equal(
    metaContent(html, "property", "og:url"),
    "https://www.artfest.ro/colectii/nunta"
  );
  assert.equal(
    metaContent(html, "property", "og:image"),
    "https://cdn.artfest.ro/hero.jpg"
  );
  assert.match(res.headers["cache-control"], /s-maxage=300/);
});

test("canonical determinist: /colectii/Nunta (alt case) => același canonical ca /colectii/nunta", async () => {
  serve(COLLECTION, PRODUCTS);
  const res = await run("Nunta"); // API-ul caută case-insensitive
  assert.match(
    res.body,
    /href="https:\/\/www\.artfest\.ro\/colectii\/nunta"/
  );
  assert.ok(!res.body.includes("/colectii/Nunta"));
});

test("fără heroImage => fără og:image", async () => {
  serve({ ...COLLECTION, heroImage: "" }, PRODUCTS);
  const html = (await run("nunta")).body;
  assert.equal(metaContent(html, "property", "og:image"), null);
});

test("heroImage relativ => absolutizat pe backend; data: => omis", async () => {
  serve({ ...COLLECTION, heroImage: "/uploads/hero.jpg" }, PRODUCTS);
  const rel = (await run("nunta")).body;
  assert.equal(
    metaContent(rel, "property", "og:image"),
    "https://artfest.onrender.com/uploads/hero.jpg"
  );

  serve({ ...COLLECTION, heroImage: "data:image/png;base64,AAAA" }, PRODUCTS);
  const data = (await run("nunta")).body;
  assert.equal(metaContent(data, "property", "og:image"), null);
  assert.ok(!jsonLdBlocks(data)[0].image);
});

test("fără seoTitle/seoDescription => fallback pe title/subtitle", async () => {
  serve({ ...COLLECTION, seoTitle: "", seoDescription: "" }, PRODUCTS);
  const html = (await run("nunta")).body;
  assert.match(html, /<title>Colecția Nuntă • Artfest<\/title>/);
  assert.equal(
    metaContent(html, "name", "description"),
    "Tot ce îți trebuie pentru nuntă"
  );
});

/* ---------- JSON-LD ---------- */

test("JSON-LD: CollectionPage cu ItemList din produsele reale", async () => {
  serve(COLLECTION, PRODUCTS);
  const [ld] = jsonLdBlocks((await run("nunta")).body);

  assert.equal(ld["@type"], "CollectionPage");
  assert.equal(ld.url, "https://www.artfest.ro/colectii/nunta");
  assert.equal(ld.name, "Idei handmade pentru nuntă");
  assert.equal(ld.image, "https://cdn.artfest.ro/hero.jpg");

  assert.equal(ld.mainEntity["@type"], "ItemList");
  assert.equal(ld.mainEntity.numberOfItems, 2);
  assert.deepEqual(
    ld.mainEntity.itemListElement.map((e) => [e.position, e.url, e.name]),
    [
      [1, "https://www.artfest.ro/produs/p1", "Invitație florală"],
      [2, "https://www.artfest.ro/produs/p2", "Mărturie din ceară"],
    ]
  );
});

test("ItemList doar pentru produse reale: rândurile fără id/titlu sunt omise", async () => {
  serve(COLLECTION, [
    { id: "p1", title: "Valid" },
    { id: "", title: "Fără id" },
    { id: "p3", title: "   " },
    { title: "Fără câmp id" },
    null,
    { id: 5, title: "Id numeric" },
  ]);
  const [ld] = jsonLdBlocks((await run("nunta")).body);

  assert.equal(ld.mainEntity.numberOfItems, 1);
  assert.deepEqual(
    ld.mainEntity.itemListElement.map((e) => e.name),
    ["Valid"]
  );
});

test("colecție fără produse => CollectionPage FĂRĂ ItemList (nu inventăm listă)", async () => {
  serve(COLLECTION, []);
  const [ld] = jsonLdBlocks((await run("nunta")).body);

  assert.equal(ld["@type"], "CollectionPage");
  assert.ok(!("mainEntity" in ld));
});

test("ItemList limitat la 24 de produse", async () => {
  const many = Array.from({ length: 40 }, (_, i) => ({
    id: `p${i}`,
    title: `Produs ${i}`,
  }));
  serve(COLLECTION, many);
  const [ld] = jsonLdBlocks((await run("nunta")).body);
  assert.equal(ld.mainEntity.itemListElement.length, 24);
});

test("JSON-LD nu poate închide prematur <script> (escape '<')", async () => {
  serve({ ...COLLECTION, seoTitle: "Test </script><b>x" }, PRODUCTS);
  const html = (await run("nunta")).body;
  assert.equal(jsonLdScriptCount(html), 1);
  assert.equal(jsonLdBlocks(html).length, 2); // CollectionPage + BreadcrumbList
  assert.ok(!/<script[^>]*ld\+json[^>]*>[^]*?<\/script><b>/.test(html));
});

/* ---------- 404 ---------- */

test("slug inexistent/inactiv (API 404) => HTTP 404 real + noindex, fără JSON-LD", async () => {
  apiBehavior = () => ({ status: 404, body: { error: "collection_not_found" } });
  const res = await run("nu-exista");
  const html = res.body;

  assert.equal(res.statusCode, 404);
  assert.match(html, /<meta name="robots" content="noindex" data-seo="1" \/>/);
  assert.ok(!html.includes('content="index, follow"'));
  assert.match(html, /<title>Colecție indisponibilă \| Artfest<\/title>/);
  assert.equal(jsonLdBlocks(html).length, 0);
  assert.ok(!html.includes("CollectionPage"));
  assert.ok(!html.includes("ItemList"));
  assert.ok(!html.includes('rel="canonical"'));
});

test("colecție inactivă (API 404) => 404 real + noindex, nu primește metadate", async () => {
  apiBehavior = () => ({ status: 404, body: { error: "collection_not_found" } });
  const res = await run("inactiva");
  assert.equal(res.statusCode, 404);
  assert.match(res.body, /content="noindex"/);
  assert.ok(!res.body.includes('rel="canonical"'));
});

/* ---------- breadcrumbs ---------- */

test("BreadcrumbList: Acasă > Colecții > titlul colecției, cu URL-uri absolute", async () => {
  serve(COLLECTION, PRODUCTS);
  const nodes = jsonLdBlocks((await run("nunta")).body);
  const crumbs = nodes.find((n) => n["@type"] === "BreadcrumbList");

  assert.ok(crumbs, "BreadcrumbList lipsește");
  assert.deepEqual(
    crumbs.itemListElement.map((e) => [e.position, e.name, e.item]),
    [
      [1, "Acasă", "https://www.artfest.ro/"],
      [2, "Colecții", "https://www.artfest.ro/colectii"],
      [3, "Colecția Nuntă", "https://www.artfest.ro/colectii/nunta"],
    ]
  );
});

test("breadcrumb-ul nu schimbă canonical-ul paginii", async () => {
  serve(COLLECTION, PRODUCTS);
  const html = (await run("nunta")).body;
  const canon = [...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map(
    (m) => m[1]
  );
  assert.deepEqual(canon, ["https://www.artfest.ro/colectii/nunta"]);
});

/* ---------- pagina index /colectii (fără slug) ---------- */

test("index /colectii: title/description/canonical + CollectionPage cu ItemList al colecțiilor reale + BreadcrumbList", async () => {
  apiBehavior = () => ({
    status: 200,
    body: {
      items: [
        { slug: "nunta", title: "Nuntă" },
        { slug: "botez", title: "Botez" },
        { slug: "", title: "Fără slug" },
      ],
    },
  });

  const res = await run("");
  const html = res.body;

  assert.equal(res.statusCode, 200);
  assert.match(
    html,
    /<title>Colecții handmade pentru fiecare ocazie • Artfest<\/title>/
  );
  assert.match(
    html,
    /<link rel="canonical" href="https:\/\/www\.artfest\.ro\/colectii" data-seo="1" \/>/
  );

  const nodes = jsonLdBlocks(html);
  const page = nodes.find((n) => n["@type"] === "CollectionPage");
  assert.deepEqual(
    page.mainEntity.itemListElement.map((e) => e.url),
    [
      "https://www.artfest.ro/colectii/nunta",
      "https://www.artfest.ro/colectii/botez",
    ]
  );
  assert.equal(
    nodes.find((n) => n["@type"] === "BreadcrumbList").itemListElement.length,
    2
  );
  assert.notEqual(html, SHELL);
});

test("index /colectii: backend indisponibil => aceleași metadate, fără ItemList inventat", async () => {
  apiBehavior = () => ({ throws: true });
  const res = await run("");

  assert.equal(res.statusCode, 200);
  assert.match(res.body, /rel="canonical" href="https:\/\/www\.artfest\.ro\/colectii"/);

  const page = jsonLdBlocks(res.body).find(
    (n) => n["@type"] === "CollectionPage"
  );
  assert.ok(page);
  assert.ok(!("mainEntity" in page));
});

/* ---------- fail-open ---------- */

test("backend indisponibil / 5xx / JSON invalid / colecție goală => shell neschimbat (fără metadate false)", async () => {
  const cases = [
    () => ({ throws: true }),
    () => ({ status: 500, body: { error: "boom" } }),
    () => ({ status: 200, body: "nu e json {" }),
    () => ({ status: 200, body: { collection: null, items: [] } }),
    () => ({ status: 200, body: { collection: { slug: "", title: "" } } }),
  ];

  for (const behavior of cases) {
    apiBehavior = behavior;
    const res = await run("nunta");
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, SHELL);
    assert.equal(res.headers["cache-control"], "no-store");
  }
});

/* ---------- diferit de homepage ---------- */

test("HTML brut al colecției diferă de shell-ul/homepage-ul generic", async () => {
  // shell-ul generic (ce primea Google înainte): fără canonical/JSON-LD/description
  assert.ok(!SHELL.includes('rel="canonical"'));
  assert.ok(!SHELL.includes("ld+json"));
  assert.ok(!/<meta\s+name="description"/.test(SHELL));
  assert.match(SHELL, /Produse handmade, personalizate și pentru evenimente/);

  serve(COLLECTION, PRODUCTS);
  const html = (await run("nunta")).body;

  assert.notEqual(html, SHELL);
  assert.ok(html.includes('rel="canonical"'));
  assert.ok(html.includes("application/ld+json"));
  assert.ok(html.includes('name="description"'));
  assert.ok(!html.includes("Produse handmade, personalizate și pentru evenimente"));
  // <body> neatins: tot <div id="root"></div>
  assert.ok(html.includes('<div id="root"></div>'));
});

test("două colecții diferite => HTML brut diferit (titlu, canonical, JSON-LD)", async () => {
  serve(COLLECTION, PRODUCTS);
  const a = (await run("nunta")).body;

  serve(
    {
      ...COLLECTION,
      slug: "botez",
      title: "Colecția Botez",
      seoTitle: "Idei pentru botez",
      seoDescription: "Mărturii de botez.",
    },
    [{ id: "z1", title: "Lumânare botez" }]
  );
  const b = (await run("botez")).body;

  assert.notEqual(a, b);
  assert.match(b, /colectii\/botez/);
  assert.ok(!b.includes("colectii/nunta"));
  assert.ok(!b.includes("Invitație florală"));
});

/* ---------- builder comun (funcție serverless + pagina React) ---------- */

test("builder: același JSON-LD indiferent de resolver când URL-urile sunt absolute", () => {
  const server = buildCollectionJsonLd({
    collection: COLLECTION,
    items: PRODUCTS,
    resolveImage: (u) => u,
  });
  const client = buildCollectionJsonLd({
    collection: COLLECTION,
    items: PRODUCTS,
    resolveImage: (u) => `${u}`,
  });
  assert.deepEqual(server, client);
});

test("builder: fără slug => null; canonical determinist", () => {
  assert.equal(buildCollectionJsonLd({ collection: {}, items: PRODUCTS }), null);
  assert.equal(buildCollectionJsonLd(), null);
  assert.equal(
    collectionCanonicalUrl("nunta"),
    "https://www.artfest.ro/colectii/nunta"
  );
});
