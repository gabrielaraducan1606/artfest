// src/routes/googleShoppingFeed.test.js
//
// Teste deterministe pentru GET /google-shopping-feed.xml - FĂRĂ DB real.
// Mocăm STRICT "../db.js" (Prisma) cu node:test mock.module, la fel ca
// în adminOrdersRoutes.refund.test.js: rulăm CODUL REAL al rutei
// (googleShoppingFeed.js, neatins), doar cu un `prisma.product.findMany`
// fals, in-memory, care aplică efectiv clauza `where` trimisă de rută
// (nu doar întoarce tot ce am seedat) - ca să testăm chiar filtrele din
// query, nu o reimplementare paralelă a lor.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/googleShoppingFeed.test.js

process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:5"; // niciodată contactat cu adevărat

import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

/* =========================================================
   Matcher generic pentru clauza `where` folosită de
   googleShoppingFeed.js: egalitate simplă, operatori
   {gt,gte,lt,lte,not,in,isEmpty,equals}, OR de sub-clauze, și
   obiecte imbricate pentru relații (service, service.vendor,
   service.type).
========================================================= */

const OPERATOR_KEYS = new Set([
  "gt",
  "gte",
  "lt",
  "lte",
  "not",
  "in",
  "isEmpty",
  "equals",
]);

function isOperatorObject(cond) {
  return (
    cond &&
    typeof cond === "object" &&
    !Array.isArray(cond) &&
    Object.keys(cond).every((k) => OPERATOR_KEYS.has(k))
  );
}

function matchesWhere(row, where) {
  for (const [key, cond] of Object.entries(where)) {
    if (key === "OR") {
      if (!cond.some((sub) => matchesWhere(row, sub))) return false;
      continue;
    }

    if (key === "AND") {
      if (!cond.every((sub) => matchesWhere(row, sub))) return false;
      continue;
    }

    const val = row?.[key];

    if (isOperatorObject(cond)) {
      if ("equals" in cond && val !== cond.equals) return false;
      if ("gt" in cond && !(val > cond.gt)) return false;
      if ("gte" in cond && !(val >= cond.gte)) return false;
      if ("lt" in cond && !(val < cond.lt)) return false;
      if ("lte" in cond && !(val <= cond.lte)) return false;
      if ("not" in cond && val === cond.not) return false;
      if ("in" in cond && !cond.in.includes(val)) return false;
      if ("isEmpty" in cond) {
        const empty = Array.isArray(val) ? val.length === 0 : true;
        if (empty !== cond.isEmpty) return false;
      }
    } else if (cond && typeof cond === "object" && !Array.isArray(cond)) {
      // relație imbricată (service, service.vendor, service.type ...)
      if (!val || !matchesWhere(val, cond)) return false;
    } else {
      if (val !== cond) return false;
    }
  }

  return true;
}

// `promos.collections` / `promos.features` = rânduri seedate pentru
// serviciul REAL de promoții (productPromotionPrice.js), care e apelat de
// feed cu acest `prisma` fals. `where`-ul lor se aplică efectiv (inclusiv
// startsAt/endsAt), nu se întoarce tot ce e seedat. `usedModels` arată ce
// modele a interogat feed-ul: doar sursele PUBLICE de preț, niciodată
// campanii sau coduri de reducere.
function makeFakeDb(seededProducts, promos = {}) {
  const usedModels = new Set();
  const collections = promos.collections || [];
  const features = promos.features || [];

  return {
    usedModels,
    product: {
      findMany: async ({ where }) => {
        usedModels.add("product");
        return seededProducts.filter((p) => matchesWhere(p, where));
      },
    },
    collection: {
      findMany: async ({ where }) => {
        usedModels.add("collection");
        return collections.filter((c) => matchesWhere(c, where));
      },
    },
    homepageFeature: {
      findMany: async ({ where }) => {
        usedModels.add("homepageFeature");
        return features.filter((f) => matchesWhere(f, where));
      },
    },
  };
}

/* =========================================================
   Fixtures - un produs "de bază" valid (READY, tot aprobat,
   magazin activ, tip "products"), pe care fiecare test îl
   suprascrie punctual.
========================================================= */

function baseProduct(overrides = {}) {
  return {
    id: "prod-base",
    serviceId: "svc-base",
    title: "Produs test",
    description: "Descriere produs test",
    priceCents: 12345,
    currency: "RON",
    images: ["/img/prod.jpg"],
    isActive: true,
    isHidden: false,
    moderationStatus: "APPROVED",
    category: "decor",
    availability: "READY",
    nextShipDate: null,
    orderMode: "DIRECT",
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    service: {
      isActive: true,
      status: "ACTIVE",
      vendor: { isActive: true, displayName: "Vendor Test" },
      profile: { displayName: "Magazin Test" },
      type: { code: "products" },
    },
    ...overrides,
  };
}

/* =========================================================
   Bootstrap: mock module ÎNAINTE de a importa router-ul real,
   apoi îl montăm pe un Express real (http real, port efemer).
========================================================= */

async function freshApp(seededProducts, promos) {
  const fakeDb = makeFakeDb(seededProducts, promos);

  const moduleMockDb = mock.module("../db.js", {
    namedExports: { prisma: fakeDb },
  });

  const mod = await import(
    `./googleShoppingFeed.js?t=${Date.now()}-${Math.random()}`
  );

  return {
    router: mod.default,
    fakeDb,
    restore: () => moduleMockDb.restore(),
  };
}

async function startServer(router) {
  const app = express();
  app.use("/", router);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

// Pornește un router proaspăt (cu produsele date seedate în fake DB),
// face request-ul real HTTP, și întoarce și un `cleanup()` pe care
// fiecare test trebuie să-l lege de `t.after` (server + mock.module
// per test, ca testele să nu se influențeze între ele).
async function fetchFeed(seededProducts, promos) {
  const { router, fakeDb, restore } = await freshApp(seededProducts, promos);
  const { baseUrl, stop } = await startServer(router);

  const res = await fetch(`${baseUrl}/google-shopping-feed.xml`);
  const text = await res.text();

  const cleanup = async () => {
    await stop();
    restore();
  };

  return { status: res.status, xml: text, cleanup, fakeDb };
}

/* =========================================================
   Helper: extrage blocul <item>...</item> care conține un
   anumit <g:id>, pentru asserturi punctuale pe câmpuri.
========================================================= */

function itemBlockFor(xml, id) {
  const marker = `<g:id>${id}</g:id>`;
  const markerIdx = xml.indexOf(marker);
  if (markerIdx === -1) return null;

  const start = xml.lastIndexOf("<item>", markerIdx);
  const end = xml.indexOf("</item>", markerIdx) + "</item>".length;

  return xml.slice(start, end);
}

function tagValue(block, tag) {
  const m = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1] : null;
}

/* =========================================================
   A. READY + preț -> in_stock + price
========================================================= */

test("A. READY cu preț => g:availability=in stock și g:price prezent", async (t) => {
  const p = baseProduct({ id: "prod-a-ready", availability: "READY" });
  const { status, xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  assert.equal(status, 200);

  const block = itemBlockFor(xml, "prod-a-ready");
  assert.ok(block, "produsul READY trebuie să fie în feed");
  assert.equal(tagValue(block, "g:availability"), "in stock");
  assert.equal(tagValue(block, "g:price"), "123.45 RON");
  assert.ok(!block.includes("<g:availability_date>"));
});

/* =========================================================
   B. SOLD_OUT -> out_of_stock
========================================================= */

test("B. SOLD_OUT => g:availability=out of stock", async (t) => {
  const p = baseProduct({ id: "prod-b-soldout", availability: "SOLD_OUT" });
  const { xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  const block = itemBlockFor(xml, "prod-b-soldout");
  assert.ok(block, "produsul SOLD_OUT trebuie să fie în feed");
  assert.equal(tagValue(block, "g:availability"), "out of stock");
  assert.ok(!block.includes("<g:availability_date>"));
});

/* =========================================================
   C. PREORDER + nextShipDate -> preorder + availability_date
========================================================= */

test("C. PREORDER cu nextShipDate => preorder + g:availability_date ISO 8601", async (t) => {
  const p = baseProduct({
    id: "prod-c-preorder",
    availability: "PREORDER",
    nextShipDate: new Date("2026-12-01T00:00:00Z"),
  });
  const { xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  const block = itemBlockFor(xml, "prod-c-preorder");
  assert.ok(block, "produsul PREORDER cu dată validă trebuie să fie în feed");
  assert.equal(tagValue(block, "g:availability"), "preorder");
  assert.equal(
    tagValue(block, "g:availability_date"),
    "2026-12-01T00:00:00.000Z"
  );
});

/* =========================================================
   D. PREORDER fără nextShipDate -> absent din feed
========================================================= */

test("D. PREORDER fără nextShipDate => exclus din feed", async (t) => {
  const p = baseProduct({
    id: "prod-d-preorder-no-date",
    availability: "PREORDER",
    nextShipDate: null,
  });
  const { xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  assert.equal(itemBlockFor(xml, "prod-d-preorder-no-date"), null);
});

/* =========================================================
   E. MADE_TO_ORDER + nextShipDate -> in stock, FĂRĂ availability_date
   (se poate comanda acum; nextShipDate nu contează pentru Google)
========================================================= */

test("E. MADE_TO_ORDER cu nextShipDate => in stock, fără g:availability_date", async (t) => {
  const p = baseProduct({
    id: "prod-e-mto",
    availability: "MADE_TO_ORDER",
    leadTimeDays: 14,
    nextShipDate: new Date("2026-11-15T00:00:00Z"),
  });
  const { xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  const block = itemBlockFor(xml, "prod-e-mto");
  assert.ok(block, "produsul MADE_TO_ORDER trebuie să fie în feed");
  assert.equal(tagValue(block, "g:availability"), "in stock");
  assert.ok(!block.includes("<g:availability_date>"));
});

/* =========================================================
   F. MADE_TO_ORDER fără nextShipDate -> in stock, în feed
========================================================= */

test("F. MADE_TO_ORDER fără nextShipDate => în feed ca in stock, fără availability_date", async (t) => {
  const p = baseProduct({
    id: "prod-f-mto-no-date",
    availability: "MADE_TO_ORDER",
    leadTimeDays: 10,
    nextShipDate: null,
  });
  const { xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  const block = itemBlockFor(xml, "prod-f-mto-no-date");
  assert.ok(block, "MADE_TO_ORDER fără dată nu mai e exclus");
  assert.equal(tagValue(block, "g:availability"), "in stock");
  assert.ok(!block.includes("<g:availability_date>"));
  assert.ok(!block.includes("backorder"));
});

test("F2. leadTimeDays nu se transformă niciodată într-o dată Google", async (t) => {
  const p = baseProduct({
    id: "prod-f2-lead-time",
    availability: "MADE_TO_ORDER",
    leadTimeDays: 30,
  });
  const { xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  const block = itemBlockFor(xml, "prod-f2-lead-time");
  assert.ok(!block.includes("availability_date"));
  assert.ok(!block.includes("handling_time"));
});

/* =========================================================
   G. QUOTE_ONLY -> absent, explicit (nu doar via priceCents=0)
========================================================= */

test("G. orderMode QUOTE_ONLY => exclus explicit, chiar cu priceCents > 0", async (t) => {
  const p = baseProduct({
    id: "prod-g-quote-only",
    orderMode: "QUOTE_ONLY",
    priceCents: 5000, // deliberat > 0, ca să testăm excluderea explicită
  });
  const { xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  assert.equal(itemBlockFor(xml, "prod-g-quote-only"), null);
});

/* =========================================================
   H. service.type.code non-"products" -> absent
========================================================= */

test("H. service non-products => exclus din feed", async (t) => {
  const p = baseProduct({
    id: "prod-h-non-products",
    service: {
      isActive: true,
      status: "ACTIVE",
      vendor: { isActive: true, displayName: "Vendor Test" },
      profile: { displayName: "Magazin Test" },
      type: { code: "workshops" },
    },
  });
  const { xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  assert.equal(itemBlockFor(xml, "prod-h-non-products"), null);
});

/* =========================================================
   I. vendor / service / produs inactiv -> absent
========================================================= */

test("I. vendor inactiv => exclus din feed", async (t) => {
  const p = baseProduct({
    id: "prod-i-vendor-inactive",
    service: {
      isActive: true,
      status: "ACTIVE",
      vendor: { isActive: false, displayName: "Vendor Vechi" },
      profile: { displayName: "Magazin Vechi" },
      type: { code: "products" },
    },
  });
  const { xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  assert.equal(itemBlockFor(xml, "prod-i-vendor-inactive"), null);
});

test("I. service inactiv => exclus din feed", async (t) => {
  const p = baseProduct({
    id: "prod-i-service-inactive",
    service: {
      isActive: false,
      status: "INACTIVE",
      vendor: { isActive: true, displayName: "Vendor Test" },
      profile: { displayName: "Magazin Test" },
      type: { code: "products" },
    },
  });
  const { xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  assert.equal(itemBlockFor(xml, "prod-i-service-inactive"), null);
});

test("I. produs isActive=false => exclus din feed", async (t) => {
  const p = baseProduct({ id: "prod-i-product-inactive", isActive: false });
  const { xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  assert.equal(itemBlockFor(xml, "prod-i-product-inactive"), null);
});

/* =========================================================
   J. moderationStatus != APPROVED -> absent
========================================================= */

test("J. produs neaprobat => exclus din feed", async (t) => {
  const p = baseProduct({
    id: "prod-j-pending",
    moderationStatus: "PENDING",
  });
  const { xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  assert.equal(itemBlockFor(xml, "prod-j-pending"), null);
});

/* =========================================================
   Verificare suplimentară cerută explicit: nu doar funcțiile
   izolate, ci XML-ul final, cu mai multe produse simultan.
========================================================= */

test("XML final: doar produsele eligibile apar, restul lipsesc complet", async (t) => {
  const eligible = baseProduct({ id: "prod-final-eligible" });
  const quoteOnly = baseProduct({
    id: "prod-final-quote",
    orderMode: "QUOTE_ONLY",
    priceCents: 100,
  });
  const oldStoreProduct = baseProduct({
    id: "prod-final-old-store",
    service: {
      isActive: false,
      status: "INACTIVE",
      vendor: { isActive: false, displayName: "Magazin Vechi" },
      profile: { displayName: "Magazin Vechi" },
      type: { code: "products" },
    },
  });

  const { status, xml, cleanup } = await fetchFeed([
    eligible,
    quoteOnly,
    oldStoreProduct,
  ]);
  t.after(cleanup);

  assert.equal(status, 200);
  assert.ok(xml.startsWith("<?xml"));
  assert.ok(itemBlockFor(xml, "prod-final-eligible"));
  assert.equal(itemBlockFor(xml, "prod-final-quote"), null);
  assert.equal(itemBlockFor(xml, "prod-final-old-store"), null);
});

/* =========================================================
   K. Atribute noi din datele existente: color / material /
   additional_image_link / product_type uman / google category
========================================================= */

function allTagValues(block, tag) {
  return [...block.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, "g"))].map(
    (m) => m[1]
  );
}

test("K1. color canonic => label uman în g:color (nu slug-ul intern)", async (t) => {
  const p = baseProduct({ id: "prod-k1-color", color: "grey_light" });
  const { xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  const block = itemBlockFor(xml, "prod-k1-color");
  assert.equal(tagValue(block, "g:color"), "Gri deschis");
  assert.ok(!block.includes("grey_light"));
});

test("K2. color cu alias după '/' => doar prima parte (fără fals bicolor)", async (t) => {
  const p = baseProduct({ id: "prod-k2-ivory", color: "ivory" });
  const { xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  const block = itemBlockFor(xml, "prod-k2-ivory");
  assert.equal(tagValue(block, "g:color"), "Ivory");
});

test("K3. material canonic => label uman în g:material", async (t) => {
  const p = baseProduct({ id: "prod-k3-material", materialMain: "wax_soy" });
  const { xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  const block = itemBlockFor(xml, "prod-k3-material");
  assert.equal(tagValue(block, "g:material"), "Ceară de soia");
  assert.ok(!block.includes("wax_soy"));
});

test("K4. material salvat deja ca label (date istorice) => label canonic", async (t) => {
  const p = baseProduct({
    id: "prod-k4-material-label",
    materialMain: "ceara de soia",
  });
  const { xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  const block = itemBlockFor(xml, "prod-k4-material-label");
  assert.equal(tagValue(block, "g:material"), "Ceară de soia");
});

test("K5. produs fără color/material => tag-urile lipsesc complet", async (t) => {
  const p = baseProduct({
    id: "prod-k5-none",
    color: null,
    materialMain: null,
  });
  const { status, xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  assert.equal(status, 200);
  const block = itemBlockFor(xml, "prod-k5-none");
  assert.ok(block, "produsul fără color/material rămâne în feed");
  assert.ok(!block.includes("<g:color>"));
  assert.ok(!block.includes("<g:material>"));
});

test("K6. slug necunoscut în color/material => nu îl trimitem către Google", async (t) => {
  const p = baseProduct({
    id: "prod-k6-unknown-slug",
    color: "verde_nedefinit",
    materialMain: "material_intern_necunoscut",
  });
  const { xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  const block = itemBlockFor(xml, "prod-k6-unknown-slug");
  assert.ok(!block.includes("<g:color>"));
  assert.ok(!block.includes("<g:material>"));
  assert.ok(!block.includes("verde_nedefinit"));
});

test("K7. imagini 2..N => additional_image_link; principala nu se repetă", async (t) => {
  const p = baseProduct({
    id: "prod-k7-images",
    images: [
      "https://cdn.artfest.ro/a.jpg",
      "https://cdn.artfest.ro/b.jpg",
      "https://cdn.artfest.ro/c.jpg",
    ],
  });
  const { xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  const block = itemBlockFor(xml, "prod-k7-images");
  assert.equal(tagValue(block, "g:image_link"), "https://cdn.artfest.ro/a.jpg");
  assert.deepEqual(allTagValues(block, "g:additional_image_link"), [
    "https://cdn.artfest.ro/b.jpg",
    "https://cdn.artfest.ro/c.jpg",
  ]);
});

test("K8. imagini duplicate / invalide / relative => curățate și absolutizate", async (t) => {
  const p = baseProduct({
    id: "prod-k8-clean-images",
    images: [
      "  /uploads/a.jpg  ", // relativă -> absolutizată
      "https://www.artfest.ro/uploads/a.jpg", // duplicat după absolutizare
      "https://cdn.artfest.ro/b.jpg",
      "https://cdn.artfest.ro/b.jpg", // duplicat exact
      "", // goală
      "   ", // doar spații
      "data:image/png;base64,AAAA", // nu e URL public
      "blob:https://x/y", // nu e URL public
      null,
      42,
    ],
  });
  const { xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  const block = itemBlockFor(xml, "prod-k8-clean-images");
  assert.equal(
    tagValue(block, "g:image_link"),
    "https://www.artfest.ro/uploads/a.jpg"
  );
  assert.deepEqual(allTagValues(block, "g:additional_image_link"), [
    "https://cdn.artfest.ro/b.jpg",
  ]);
});

test("K9. mai mult de 10 imagini suplimentare => maxim 10 în feed", async (t) => {
  const images = Array.from(
    { length: 15 },
    (_, i) => `https://cdn.artfest.ro/img-${i}.jpg`
  );
  const p = baseProduct({ id: "prod-k9-many-images", images });
  const { xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  const block = itemBlockFor(xml, "prod-k9-many-images");
  const extra = allTagValues(block, "g:additional_image_link");
  assert.equal(extra.length, 10);
  assert.equal(extra[0], "https://cdn.artfest.ro/img-1.jpg");
  assert.equal(extra[9], "https://cdn.artfest.ro/img-10.jpg");
});

test("K10. toate imaginile invalide => produsul nu intră în feed (image_link obligatoriu)", async (t) => {
  const p = baseProduct({
    id: "prod-k10-no-valid-image",
    images: ["", "data:image/png;base64,AAAA"],
  });
  const { xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  assert.equal(itemBlockFor(xml, "prod-k10-no-valid-image"), null);
});

test("K11. product_type => eticheta umană ierarhică (escapată), nu slug-ul", async (t) => {
  const p = baseProduct({
    id: "prod-k11-product-type",
    category: "home_lumanari-parfumate",
  });
  const { xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  const block = itemBlockFor(xml, "prod-k11-product-type");
  assert.equal(
    tagValue(block, "g:product_type"),
    "Home &amp; lifestyle handmade &gt; Lumânări parfumate"
  );
  assert.ok(!block.includes("home_lumanari-parfumate"));
});

test("K12. categorie necunoscută/lipsă => product_type 'handmade', fără slug", async (t) => {
  const unknown = baseProduct({
    id: "prod-k12-unknown",
    category: "categorie_stearsa_din_catalog",
  });
  const missing = baseProduct({ id: "prod-k12-missing", category: null });
  const { xml, cleanup } = await fetchFeed([unknown, missing]);
  t.after(cleanup);

  assert.equal(
    tagValue(itemBlockFor(xml, "prod-k12-unknown"), "g:product_type"),
    "handmade"
  );
  assert.equal(
    tagValue(itemBlockFor(xml, "prod-k12-missing"), "g:product_type"),
    "handmade"
  );
  assert.ok(!xml.includes("categorie_stearsa_din_catalog"));
});

test("K13. categorie mapată => g:google_product_category numeric din mapping central", async (t) => {
  const p = baseProduct({
    id: "prod-k13-gpc",
    category: "bijuterii_bratari",
  });
  const { xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  const block = itemBlockFor(xml, "prod-k13-gpc");
  assert.equal(tagValue(block, "g:google_product_category"), "191");
});

test("K14. categorie ambiguă / 'alte' / necunoscută => fără google_product_category", async (t) => {
  const ambiguous = baseProduct({
    id: "prod-k14-ambiguous",
    category: "decor_lumanari-decor", // "Lumânări & suporturi" - mixt, nemapat
  });
  const alte = baseProduct({ id: "prod-k14-alte", category: "alte" });
  const unknown = baseProduct({ id: "prod-k14-unknown", category: "xyz" });
  const { xml, cleanup } = await fetchFeed([ambiguous, alte, unknown]);
  t.after(cleanup);

  for (const id of ["prod-k14-ambiguous", "prod-k14-alte", "prod-k14-unknown"]) {
    const block = itemBlockFor(xml, id);
    assert.ok(block, `${id} rămâne în feed`);
    assert.ok(!block.includes("<g:google_product_category>"), id);
  }
});

test("K15. regresie: price/availability/brand/mpn/title/description rămân neschimbate", async (t) => {
  const p = baseProduct({
    id: "prod-k15-regression",
    color: "red",
    materialMain: "ceramic",
    category: "bijuterii_cercei",
  });
  const { xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  const block = itemBlockFor(xml, "prod-k15-regression");
  assert.equal(tagValue(block, "g:price"), "123.45 RON");
  assert.equal(tagValue(block, "g:availability"), "in stock");
  assert.equal(tagValue(block, "g:brand"), "Magazin Test");
  assert.equal(tagValue(block, "g:mpn"), "prod-k15-regression");
  assert.equal(tagValue(block, "g:identifier_exists"), "no");
  assert.equal(tagValue(block, "title"), "Produs test");
  assert.equal(tagValue(block, "description"), "Descriere produs test");
});

test("K16. consistență feed vs helper JSON-LD: aceleași valori pentru același produs", async (t) => {
  const { buildProductMerchantAttributes } = await import(
    "../constants/productMerchantAttributes.js"
  );

  const p = baseProduct({
    id: "prod-k16-consistency",
    category: "bijuterii_coliere",
    color: "gold",
    materialMain: "metal_silver",
    images: [
      "https://cdn.artfest.ro/1.jpg",
      "https://cdn.artfest.ro/2.jpg",
      "https://cdn.artfest.ro/3.jpg",
    ],
  });
  const { xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  const block = itemBlockFor(xml, "prod-k16-consistency");

  // exact aceeași funcție pe care o apelează ProductDetails.jsx pentru JSON-LD
  const ld = buildProductMerchantAttributes(p, { resolveUrl: (u) => u });

  assert.equal(tagValue(block, "g:color"), ld.color);
  assert.equal(tagValue(block, "g:material"), ld.material);
  assert.equal(
    tagValue(block, "g:product_type"),
    ld.productType.replaceAll("&", "&amp;").replaceAll(">", "&gt;")
  );
  assert.equal(tagValue(block, "g:image_link"), ld.images[0]);
  assert.deepEqual(
    allTagValues(block, "g:additional_image_link"),
    ld.images.slice(1)
  );
});

/* =========================================================
   L. Preț / promoții publice: g:price normal + g:sale_price +
   g:sale_price_effective_date (doar promoții vizibile crawlerului)
========================================================= */

const HOUR = 3600 * 1000;

function homepageFeature(overrides = {}) {
  const now = Date.now();
  return {
    id: "feat-1",
    type: "PRODUCT_OF_DAY",
    productId: "prod-base",
    serviceId: null,
    startsAt: new Date(now - 24 * HOUR),
    endsAt: new Date(now + 24 * HOUR),
    platformDiscountPercent: 20,
    vendorDiscountPercent: 0,
    vendorDiscountStatus: "PENDING",
    ...overrides,
  };
}

function collectionPromo(overrides = {}) {
  const now = Date.now();
  return {
    id: "col-1",
    title: "Colecție test",
    slug: "colectie-test",
    isActive: true,
    rules: {},
    promoEnabled: true,
    promoPercent: 25,
    promoLabel: "Promo colecție",
    promoFundingSource: "PLATFORM_COMMISSION",
    promoStartsAt: new Date(now - 24 * HOUR),
    promoEndsAt: new Date(now + 48 * HOUR),
    ...overrides,
  };
}

// exact formatul din feed: ISO 8601, fără milisecunde, "start/end"
function expectedInterval(start, end) {
  const f = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  return `${f(start)}/${f(end)}`;
}

test("L1. produs normal, fără promoție => doar g:price", async (t) => {
  const p = baseProduct({ id: "prod-l1-normal", priceCents: 10000 });
  const { xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  const block = itemBlockFor(xml, "prod-l1-normal");
  assert.equal(tagValue(block, "g:price"), "100.00 RON");
  assert.ok(!block.includes("<g:sale_price>"));
  assert.ok(!block.includes("<g:sale_price_effective_date>"));
});

test("L2. promoție publică activă (homepage) => price normal + sale_price + effective_date", async (t) => {
  const feature = homepageFeature({ productId: "prod-l2-promo" });
  const p = baseProduct({ id: "prod-l2-promo", priceCents: 10000 });
  const { xml, cleanup } = await fetchFeed([p], { features: [feature] });
  t.after(cleanup);

  const block = itemBlockFor(xml, "prod-l2-promo");
  assert.equal(tagValue(block, "g:price"), "100.00 RON"); // rămâne prețul normal
  assert.equal(tagValue(block, "g:sale_price"), "80.00 RON");
  assert.equal(
    tagValue(block, "g:sale_price_effective_date"),
    expectedInterval(feature.startsAt, feature.endsAt)
  );
});

test("L3. promoție de colecție activă cu interval complet => sale_price + effective_date", async (t) => {
  const col = collectionPromo();
  const p = baseProduct({ id: "prod-l3-collection", priceCents: 20000 });
  const { xml, cleanup } = await fetchFeed([p], { collections: [col] });
  t.after(cleanup);

  const block = itemBlockFor(xml, "prod-l3-collection");
  assert.equal(tagValue(block, "g:price"), "200.00 RON");
  assert.equal(tagValue(block, "g:sale_price"), "150.00 RON");
  assert.equal(
    tagValue(block, "g:sale_price_effective_date"),
    expectedInterval(col.promoStartsAt, col.promoEndsAt)
  );
});

test("L4. promoție expirată => fără sale_price (homepage și colecție)", async (t) => {
  const now = Date.now();
  const expiredFeature = homepageFeature({
    productId: "prod-l4-expired",
    startsAt: new Date(now - 72 * HOUR),
    endsAt: new Date(now - 1 * HOUR),
  });
  const expiredCollection = collectionPromo({
    promoStartsAt: new Date(now - 72 * HOUR),
    promoEndsAt: new Date(now - 1 * HOUR),
  });
  const p = baseProduct({ id: "prod-l4-expired", priceCents: 10000 });
  const { xml, cleanup } = await fetchFeed([p], {
    features: [expiredFeature],
    collections: [expiredCollection],
  });
  t.after(cleanup);

  const block = itemBlockFor(xml, "prod-l4-expired");
  assert.equal(tagValue(block, "g:price"), "100.00 RON");
  assert.ok(!block.includes("<g:sale_price>"));
  assert.ok(!block.includes("<g:sale_price_effective_date>"));
});

test("L4b. promoție încă neînceput (startsAt în viitor) => fără sale_price", async (t) => {
  const now = Date.now();
  const future = homepageFeature({
    productId: "prod-l4b-future",
    startsAt: new Date(now + 2 * HOUR),
    endsAt: new Date(now + 48 * HOUR),
  });
  const p = baseProduct({ id: "prod-l4b-future", priceCents: 10000 });
  const { xml, cleanup } = await fetchFeed([p], { features: [future] });
  t.after(cleanup);

  assert.ok(!itemBlockFor(xml, "prod-l4b-future").includes("<g:sale_price>"));
});

test("L5. colecție fără interval complet => sale_price FĂRĂ effective_date", async (t) => {
  const noDates = collectionPromo({
    id: "col-open",
    promoStartsAt: null,
    promoEndsAt: null,
  });
  const onlyEnd = collectionPromo({
    id: "col-only-end",
    rules: { categories: ["cat-only-end"] },
    promoStartsAt: null,
  });
  const a = baseProduct({ id: "prod-l5-open", priceCents: 10000 });
  const b = baseProduct({
    id: "prod-l5-only-end",
    priceCents: 10000,
    category: "cat-only-end",
  });
  const { xml, cleanup } = await fetchFeed([a, b], {
    collections: [noDates, onlyEnd],
  });
  t.after(cleanup);

  for (const [id, sale] of [
    ["prod-l5-open", "75.00 RON"],
    ["prod-l5-only-end", "75.00 RON"],
  ]) {
    const block = itemBlockFor(xml, id);
    assert.equal(tagValue(block, "g:price"), "100.00 RON", id);
    assert.equal(tagValue(block, "g:sale_price"), sale, id);
    assert.ok(!block.includes("<g:sale_price_effective_date>"), id);
  }
});

test("L6. feed-ul folosește DOAR surse publice de preț (fără campanii/coduri de reducere)", async (t) => {
  const p = baseProduct({ id: "prod-l6-public-only" });
  const { status, cleanup, fakeDb } = await fetchFeed([p]);
  t.after(cleanup);

  assert.equal(status, 200);
  assert.deepEqual([...fakeDb.usedModels].sort(), [
    "collection",
    "homepageFeature",
    "product",
  ]);
});

test("L7. QUOTE_ONLY cu promoție activă rămâne exclus din feed", async (t) => {
  const p = baseProduct({
    id: "prod-l7-quote-promo",
    orderMode: "QUOTE_ONLY",
    priceCents: 10000,
  });
  const { xml, cleanup } = await fetchFeed([p], {
    features: [homepageFeature({ productId: "prod-l7-quote-promo" })],
  });
  t.after(cleanup);

  assert.equal(itemBlockFor(xml, "prod-l7-quote-promo"), null);
});

test("L8. artizanul săptămânii (promoție pe serviciu) => sale_price pe produsele lui", async (t) => {
  const feature = homepageFeature({
    id: "feat-artisan",
    type: "ARTISAN_OF_WEEK",
    productId: null,
    serviceId: "svc-artisan",
    platformDiscountPercent: 10,
  });
  const p = baseProduct({
    id: "prod-l8-artisan",
    serviceId: "svc-artisan",
    priceCents: 10000,
  });
  const other = baseProduct({
    id: "prod-l8-other-service",
    serviceId: "svc-other",
    priceCents: 10000,
  });
  const { xml, cleanup } = await fetchFeed([p, other], {
    features: [feature],
  });
  t.after(cleanup);

  assert.equal(
    tagValue(itemBlockFor(xml, "prod-l8-artisan"), "g:sale_price"),
    "90.00 RON"
  );
  assert.ok(
    !itemBlockFor(xml, "prod-l8-other-service").includes("<g:sale_price>")
  );
});

/* =========================================================
   M. Availability: PREORDER cu dată, MADE_TO_ORDER fără dată
========================================================= */

test("M1. PREORDER cu nextShipDate => preorder + availability_date; MADE_TO_ORDER => in stock fără dată", async (t) => {
  const pre = baseProduct({
    id: "prod-m1-pre",
    availability: "PREORDER",
    nextShipDate: new Date("2026-12-01T00:00:00Z"),
  });
  const mto = baseProduct({
    id: "prod-m1-mto",
    availability: "MADE_TO_ORDER",
    leadTimeDays: 7,
  });
  const { xml, cleanup } = await fetchFeed([pre, mto]);
  t.after(cleanup);

  const preBlock = itemBlockFor(xml, "prod-m1-pre");
  assert.equal(tagValue(preBlock, "g:availability"), "preorder");
  assert.equal(
    tagValue(preBlock, "g:availability_date"),
    "2026-12-01T00:00:00.000Z"
  );

  const mtoBlock = itemBlockFor(xml, "prod-m1-mto");
  assert.equal(tagValue(mtoBlock, "g:availability"), "in stock");
  assert.ok(!mtoBlock.includes("<g:availability_date>"));
});

/* =========================================================
   N. Consistență feed <-> JSON-LD (availability + price)
========================================================= */

test("N1. availability: feed și JSON-LD folosesc aceeași mapare pentru fiecare stare", async (t) => {
  const { availabilityToSchemaOrg } = await import(
    "../constants/productMerchantAttributes.js"
  );

  const expected = {
    READY: ["in stock", "https://schema.org/InStock"],
    MADE_TO_ORDER: ["in stock", "https://schema.org/InStock"],
    PREORDER: ["preorder", "https://schema.org/PreOrder"],
    SOLD_OUT: ["out of stock", "https://schema.org/OutOfStock"],
  };

  const products = Object.keys(expected).map((availability) =>
    baseProduct({
      id: `prod-n1-${availability}`,
      availability,
      nextShipDate:
        availability === "PREORDER" ? new Date("2026-12-01T00:00:00Z") : null,
    })
  );

  const { xml, cleanup } = await fetchFeed(products);
  t.after(cleanup);

  for (const [availability, [google, schema]] of Object.entries(expected)) {
    const block = itemBlockFor(xml, `prod-n1-${availability}`);
    assert.equal(tagValue(block, "g:availability"), google, availability);
    assert.equal(availabilityToSchemaOrg(availability), schema, availability);
  }
});

test("N2. price: prețul efectiv din feed = prețul din JSON-LD (cu și fără promoție)", async (t) => {
  const promoFeature = homepageFeature({
    productId: "prod-n2-promo",
    platformDiscountPercent: 15,
  });
  const withPromo = baseProduct({ id: "prod-n2-promo", priceCents: 12345 });
  const noPromo = baseProduct({ id: "prod-n2-plain", priceCents: 9990 });

  const promos = { features: [promoFeature] };
  const { xml, cleanup } = await fetchFeed([withPromo, noPromo], promos);
  t.after(cleanup);

  // Ce calculează endpointul public pentru pagină (ProductDetails afișează
  // finalPriceCents, iar JSON-LD offers.price = displayPrice = final/100).
  // Aceeași funcție de serviciu, aceleași promoții publice.
  const { getPromotionPricingForProduct } = await import(
    "../services/productPromotionPrice.js"
  );
  const db = makeFakeDb([withPromo, noPromo], promos);

  for (const p of [withPromo, noPromo]) {
    const pricing = await getPromotionPricingForProduct(p, { db });
    const jsonLdPrice = pricing.finalPriceCents / 100;

    const block = itemBlockFor(xml, p.id);
    const feedPrice = tagValue(block, "g:price");
    const feedSale = tagValue(block, "g:sale_price");

    // g:price = mereu prețul normal; ce vede utilizatorul = sale_price sau price
    assert.equal(feedPrice, `${(p.priceCents / 100).toFixed(2)} RON`);
    const effective = Number(
      (feedSale || feedPrice).replace(" RON", "")
    );

    assert.equal(effective, jsonLdPrice, p.id);
  }

  assert.ok(itemBlockFor(xml, "prod-n2-promo").includes("<g:sale_price>"));
  assert.ok(!itemBlockFor(xml, "prod-n2-plain").includes("<g:sale_price>"));
});
