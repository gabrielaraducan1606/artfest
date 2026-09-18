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

function makeFakeDb(seededProducts) {
  return {
    product: {
      findMany: async ({ where }) => {
        return seededProducts.filter((p) => matchesWhere(p, where));
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

async function freshApp(seededProducts) {
  const moduleMockDb = mock.module("../db.js", {
    namedExports: { prisma: makeFakeDb(seededProducts) },
  });

  const mod = await import(
    `./googleShoppingFeed.js?t=${Date.now()}-${Math.random()}`
  );

  return { router: mod.default, restore: () => moduleMockDb.restore() };
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
async function fetchFeed(seededProducts) {
  const { router, restore } = await freshApp(seededProducts);
  const { baseUrl, stop } = await startServer(router);

  const res = await fetch(`${baseUrl}/google-shopping-feed.xml`);
  const text = await res.text();

  const cleanup = async () => {
    await stop();
    restore();
  };

  return { status: res.status, xml: text, cleanup };
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
   E. MADE_TO_ORDER + nextShipDate -> backorder + availability_date
========================================================= */

test("E. MADE_TO_ORDER cu nextShipDate => backorder + g:availability_date", async (t) => {
  const p = baseProduct({
    id: "prod-e-mto",
    availability: "MADE_TO_ORDER",
    nextShipDate: new Date("2026-11-15T00:00:00Z"),
  });
  const { xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  const block = itemBlockFor(xml, "prod-e-mto");
  assert.ok(block, "produsul MADE_TO_ORDER cu dată validă trebuie să fie în feed");
  assert.equal(tagValue(block, "g:availability"), "backorder");
  assert.equal(
    tagValue(block, "g:availability_date"),
    "2026-11-15T00:00:00.000Z"
  );
});

/* =========================================================
   F. MADE_TO_ORDER fără nextShipDate -> absent din feed
========================================================= */

test("F. MADE_TO_ORDER fără nextShipDate => exclus din feed", async (t) => {
  const p = baseProduct({
    id: "prod-f-mto-no-date",
    availability: "MADE_TO_ORDER",
    nextShipDate: null,
  });
  const { xml, cleanup } = await fetchFeed([p]);
  t.after(cleanup);

  assert.equal(itemBlockFor(xml, "prod-f-mto-no-date"), null);
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
