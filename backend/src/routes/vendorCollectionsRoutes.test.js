// src/routes/vendorCollectionsRoutes.test.js
//
// Editorul VendorCollection, pe routerele REALE (vendorCollectionsRoutes.js):
//   GET    /api/vendor/collections/:id/product-search  - produse publice din TOT marketplace-ul
//   POST   /api/vendor/collections/:id/products        - revalidare eligibilitate, orice vendor
//   DELETE /api/vendor/collections/:id/products/:pid
//   GET    /api/public/vendor-collections/:slug         - pagina publică
//
// Ownerul colecției NU devine seller: produsul păstrează vendorul real.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/vendorCollectionsRoutes.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
// AI simulat - NICIUN apel real către OpenAI (vezi fakeOpenai mai jos)
process.env.OPENAI_API_KEY = "test-key-fara-apeluri-reale";
process.env.AI_VENDOR_COLLECTIONS_ENABLED = "1";

import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

/* =========================================================
   Fake DB minimal (filtrele Prisma folosite de aceste rute)
========================================================= */

let tables;

function opMatch(value, cond) {
  if (cond === null) return value === null || value === undefined;
  if (cond instanceof Date || typeof cond !== "object" || Array.isArray(cond)) return value === cond;

  if ("is" in cond) return cond.is === null ? !value : Boolean(value) && matches(value, cond.is);

  const ops = ["in", "notIn", "not", "equals", "contains", "mode", "gte", "lte", "gt", "lt", "has", "hasSome", "startsWith"];
  if (!Object.keys(cond).every((k) => ops.includes(k))) return value && typeof value === "object" && matches(value, cond);

  for (const [op, v] of Object.entries(cond)) {
    if (op === "in" && !v.includes(value)) return false;
    if (op === "notIn" && v.includes(value)) return false;
    if (op === "not" && value === v) return false;
    if (op === "equals" && value !== v) return false;
    if (op === "gte" && !(value >= v)) return false;
    if (op === "lte" && !(value <= v)) return false;
    if (op === "gt" && !(value > v)) return false;
    if (op === "lt" && !(value < v)) return false;
    if (op === "has" && !(Array.isArray(value) && value.includes(v))) return false;
    if (op === "hasSome" && !(Array.isArray(value) && v.some((x) => value.includes(x)))) return false;
    if (op === "startsWith" && !String(value ?? "").startsWith(v)) return false;
    if (op === "contains") {
      const insensitive = cond.mode === "insensitive";
      const hay = String(value ?? "");
      if (!(insensitive ? hay.toLowerCase().includes(String(v).toLowerCase()) : hay.includes(v))) return false;
    }
  }
  return true;
}

function matches(row, where = {}) {
  for (const [key, cond] of Object.entries(where || {})) {
    if (key === "AND") {
      if (!(Array.isArray(cond) ? cond : [cond]).every((w) => matches(row, w))) return false;
    } else if (key === "OR") {
      if (!cond.some((w) => matches(row, w))) return false;
    } else if (key === "collectionId_productId") {
      if (row.collectionId !== cond.collectionId || row.productId !== cond.productId) return false;
    } else if (!opMatch(row?.[key], cond)) {
      return false;
    }
  }
  return true;
}

// relații calculate (pentru where / include / select)
const RELATIONS = {
  vendorCollection: {
    vendor: (row) => tables.vendor.find((v) => v.id === row.vendorId) || null,
    items: (row, spec) => {
      let items = tables.vendorCollectionItem
        .filter((i) => i.collectionId === row.id)
        .map((i) => ({ ...i, product: tables.product.find((p) => p.id === i.productId) || null }));
      if (spec && typeof spec === "object" && spec.where) items = items.filter((i) => matches(i, spec.where));
      return items;
    },
  },
  vendorCollectionItem: {
    product: (row) => tables.product.find((p) => p.id === row.productId) || null,
  },
};

function enrich(name, row, keys) {
  if (!row || !RELATIONS[name]) return row;
  const out = { ...row };
  for (const [k, spec] of keys) if (spec && RELATIONS[name][k]) out[k] = RELATIONS[name][k](row, spec);
  return out;
}

function model(name) {
  const rows = () => (tables[name] ||= []);
  const filtered = (where) =>
    rows().filter((r) => matches(enrich(name, r, Object.entries(where || {}).map(([k]) => [k, true])), where));
  const shape = (r, { include, select } = {}) => enrich(name, { ...r }, Object.entries(include || select || {}));

  return {
    findMany: async ({ where, skip = 0, take, include, select } = {}) => {
      const out = filtered(where).slice(skip, take ? skip + take : undefined);
      return out.map((r) => shape(r, { include, select }));
    },
    findFirst: async ({ where, include, select } = {}) => {
      const r = filtered(where)[0];
      return r ? shape(r, { include, select }) : null;
    },
    findUnique: async ({ where, include, select } = {}) => {
      const r = filtered(where)[0];
      return r ? shape(r, { include, select }) : null;
    },
    count: async ({ where } = {}) => filtered(where).length,
    create: async ({ data }) => {
      const row = { id: `${name}_${rows().length + 1}`, createdAt: new Date(), updatedAt: new Date(), visits: 0, clicks: 0, ...data };
      rows().push(row);
      return { ...row };
    },
    createMany: async ({ data }) => {
      // cheia unică a tabelului (VendorCollectionItem / AiUsageDaily)
      const uniq = (r) =>
        name === "aiUsageDaily"
          ? `${r.feature}|${r.scope}|${r.subjectId}|${r.day}`
          : `${r.collectionId}|${r.productId}`;
      const defaults =
        name === "aiUsageDaily"
          ? { requests: 0, failures: 0, inputTokens: 0, outputTokens: 0, costMicroUsd: 0, lockedUntil: null }
          : {};
      for (const d of data) {
        if (!rows().some((r) => uniq(r) === uniq(d))) rows().push({ createdAt: new Date(), ...defaults, ...d });
      }
      return { count: data.length };
    },
    updateMany: async ({ where, data }) => {
      const hit = filtered(where);
      for (const r of hit) {
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === "object" && !(v instanceof Date) && "increment" in v) r[k] = Number(r[k] || 0) + v.increment;
          else if (v && typeof v === "object" && !(v instanceof Date) && "decrement" in v) r[k] = Number(r[k] || 0) - v.decrement;
          else r[k] = v;
        }
      }
      return { count: hit.length };
    },
    aggregate: async ({ where, _sum = {} }) => {
      const hit = filtered(where);
      const sum = {};
      for (const k of Object.keys(_sum)) sum[k] = hit.reduce((a, r) => a + Number(r[k] || 0), 0);
      return { _sum: sum };
    },
    update: async ({ where, data }) => {
      const r = filtered(where)[0];
      if (!r) throw new Error(`${name}.update not found`);
      for (const [k, v] of Object.entries(data)) r[k] = v && typeof v === "object" && "increment" in v ? Number(r[k] || 0) + v.increment : v;
      return { ...r };
    },
    delete: async ({ where }) => {
      const r = filtered(where)[0];
      if (!r) throw new Error(`${name}.delete not found`);
      tables[name] = rows().filter((x) => x !== r);
      return r;
    },
    deleteMany: async ({ where } = {}) => {
      const hit = filtered(where);
      tables[name] = rows().filter((x) => !hit.includes(x));
      return { count: hit.length };
    },
  };
}

const dbProxy = new Proxy({}, {
  get: (_t, key) => {
    if (key === "$transaction") return async (fn) => (typeof fn === "function" ? fn(dbProxy) : Promise.all(fn));
    if (typeof key !== "string" || key.startsWith("$") || key === "then") return undefined;
    return model(key);
  },
});

/* =========================================================
   Bootstrap
========================================================= */

let server;
let baseUrl;
let currentUserId = null;

/* AI simulat: răspunsul îl decide fiecare test; apelurile sunt înregistrate */
const aiCalls = [];
let aiReply = () => ({ recommendations: [] });
const fakeOpenai = {
  responses: {
    create: async (args) => {
      aiCalls.push(args);
      const reply = aiReply(args);
      return { output_text: typeof reply === "string" ? reply : JSON.stringify(reply) };
    },
  },
};
let routesModule = null;
const restores = [];

before(async () => {
  restores.push(mock.module("../db.js", { namedExports: { prisma: dbProxy } }));
  restores.push(mock.module("../lib/openai.js", { namedExports: { openai: fakeOpenai } }));
  restores.push(
    mock.module("../api/auth.js", {
      namedExports: {
        authRequired: (req, res, next) => {
          if (!currentUserId) return res.status(401).json({ error: "unauth" });
          req.user = { sub: currentUserId, role: "VENDOR" };
          next();
        },
        requireRole: () => (_q, _s, n) => n(),
        enforceTokenVersion: (_q, _s, n) => n(),
      },
    })
  );

  const mod = await import("./vendorCollectionsRoutes.js");
  routesModule = mod;
  const app = express();
  app.use(express.json());
  app.use("/api/public/vendor-collections", mod.vendorCollectionsPublicRouter);
  app.use("/api/vendor/collections", mod.default);

  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  restores.forEach((r) => r.restore());
});

/* =========================================================
   Seed: A (owner), B (alt vendor), C (vendor inactiv)
========================================================= */

const vendors = {
  a: { id: "vendor-a", userId: "user-a", displayName: "Atelier A", isActive: true, referralCode: null },
  b: { id: "vendor-b", userId: "user-b", displayName: "Atelier B", isActive: true, referralCode: null },
  c: { id: "vendor-c", userId: "user-c", displayName: "Atelier C", isActive: false, referralCode: null },
};

function product(id, v, title, extra = {}, serviceExtra = {}) {
  return {
    id,
    title,
    images: [`https://img/${id}.jpg`],
    priceCents: 5000,
    currency: "RON",
    category: "decor_lumanari",
    isActive: true,
    isHidden: false,
    moderationStatus: "APPROVED",
    availability: "READY",
    createdAt: new Date(),
    service: {
      id: `svc-${v.id}`,
      vendorId: v.id,
      title: `Magazin ${v.displayName}`,
      isActive: true,
      status: "ACTIVE",
      type: { code: "products" },
      profile: { displayName: `Magazinul ${v.displayName}`, slug: `magazin-${v.id}` },
      vendor: { id: v.id, displayName: v.displayName, isActive: v.isActive },
      ...serviceExtra,
    },
    ...extra,
  };
}

beforeEach(() => {
  currentUserId = "user-a";
  tables = {
    vendor: Object.values(vendors).map((v) => ({ ...v })),
    product: [
      product("a1", vendors.a, "Lumânare A1 de soia"),
      product("b1", vendors.b, "Lumânare B1 parfumată"),
      product("b-inactive", vendors.b, "Lumânare inactivă", { isActive: false }),
      product("b-hidden", vendors.b, "Lumânare ascunsă", { isHidden: true }),
      product("b-pending", vendors.b, "Lumânare neaprobată", { moderationStatus: "PENDING" }),
      product("b-draftstore", vendors.b, "Lumânare magazin draft", {}, { status: "DRAFT" }),
      product("c1", vendors.c, "Lumânare vendor inactiv"),
    ],
    vendorCollection: [{ id: "col-a", vendorId: "vendor-a", title: "Colecția A", slug: "colectia-a", isActive: true, sort: "curated", visits: 0, clicks: 0, createdAt: new Date(), updatedAt: new Date() }],
    vendorCollectionItem: [],
  };
});

async function call(method, path, body) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

const searchIds = async (query = "") =>
  (await call("GET", `/api/vendor/collections/col-a/product-search${query}`)).body.products.map((p) => p.id);

/* =========================================================
   Teste
========================================================= */

test("vendor A caută produsul propriu A1 -> găsit, marcat „propriu”, vendorul real A", async () => {
  const res = await call("GET", "/api/vendor/collections/col-a/product-search?q=A1");
  assert.equal(res.status, 200);
  const [a1] = res.body.products;
  assert.equal(a1.id, "a1");
  assert.equal(a1.isOwn, true);
  assert.equal(a1.vendorId, "vendor-a");
  assert.equal(a1.inCollection, false);
  assert.equal(a1.image, "https://img/a1.jpg");
  assert.equal(a1.price, 50);
});

test("vendor A caută produsul B1 al altui vendor -> găsit, marcat „alt magazin”, vendorul real B", async () => {
  const res = await call("GET", "/api/vendor/collections/col-a/product-search?q=parfumat");
  const [b1] = res.body.products;
  assert.equal(b1.id, "b1");
  assert.equal(b1.isOwn, false);
  assert.equal(b1.vendorId, "vendor-b");
  assert.equal(b1.storeName, "Magazinul Atelier B");
});

test("căutare după magazin / vendor și după categorie", async () => {
  assert.deepEqual(await searchIds("?store=atelier%20b"), ["b1"]);
  assert.deepEqual(await searchIds("?store=Magazinul%20Atelier%20A"), ["a1"]);
  assert.deepEqual((await searchIds("?category=decor_lumanari")).sort(), ["a1", "b1"]);
  assert.deepEqual(await searchIds("?category=altceva"), []);
});

test("produse inactive / ascunse / neaprobate / magazin draft / vendor inactiv NU apar", async () => {
  assert.deepEqual((await searchIds()).sort(), ["a1", "b1"]);
});

test("paginare: limit + hasMore", async () => {
  const first = await call("GET", "/api/vendor/collections/col-a/product-search?limit=1&page=1");
  const second = await call("GET", "/api/vendor/collections/col-a/product-search?limit=1&page=2");
  assert.equal(first.body.products.length, 1);
  assert.equal(first.body.hasMore, true);
  assert.equal(second.body.products.length, 1);
  assert.equal(second.body.hasMore, false);
  assert.notEqual(first.body.products[0].id, second.body.products[0].id);
});

test("A1 și B1 pot fi adăugate; ambele marcate „în colecție”; vendorId real păstrat", async () => {
  const add = await call("POST", "/api/vendor/collections/col-a/products", { productIds: ["a1", "b1"] });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  assert.equal(add.body.added, 2);

  const search = (await call("GET", "/api/vendor/collections/col-a/product-search")).body.products;
  assert.ok(search.every((p) => p.inCollection));

  const detail = (await call("GET", "/api/vendor/collections/col-a")).body.collection;
  const sellers = Object.fromEntries(detail.items.map((i) => [i.productId, i.product.service.vendor.id]));
  assert.deepEqual(sellers, { a1: "vendor-a", b1: "vendor-b" }, "ownerul colecției NU devine seller");

  // produsul în sine nu e atins
  assert.equal(tables.product.find((p) => p.id === "b1").service.vendorId, "vendor-b");
});

test("produs inactiv / neeligibil nu poate fi adăugat (revalidare backend)", async () => {
  for (const id of ["b-inactive", "b-hidden", "b-pending", "b-draftstore", "c1", "nu-exista"]) {
    const res = await call("POST", "/api/vendor/collections/col-a/products", { productIds: [id] });
    assert.equal(res.status, 400, id);
    assert.equal(res.body.error, "no_valid_products", id);
  }
  assert.equal(tables.vendorCollectionItem.length, 0);
});

test("duplicatul e blocat", async () => {
  await call("POST", "/api/vendor/collections/col-a/products", { productIds: ["b1"] });
  const again = await call("POST", "/api/vendor/collections/col-a/products", { productIds: ["b1"] });
  assert.equal(again.status, 200);
  assert.equal(again.body.added, 0);
  assert.equal(tables.vendorCollectionItem.filter((i) => i.productId === "b1").length, 1);
});

test("produsul poate fi scos din colecție", async () => {
  await call("POST", "/api/vendor/collections/col-a/products", { productIds: ["a1", "b1"] });
  const del = await call("DELETE", "/api/vendor/collections/col-a/products/b1");
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.deepEqual(tables.vendorCollectionItem.map((i) => i.productId), ["a1"]);
});

test("permisiuni: doar ownerul colecției poate căuta / adăuga / scoate", async () => {
  currentUserId = "user-b";
  assert.equal((await call("GET", "/api/vendor/collections/col-a/product-search")).status, 404);
  assert.equal((await call("POST", "/api/vendor/collections/col-a/products", { productIds: ["b1"] })).status, 404);
  assert.equal((await call("DELETE", "/api/vendor/collections/col-a/products/b1")).status, 404);
  assert.equal(tables.vendorCollectionItem.length, 0);

  currentUserId = null;
  assert.equal((await call("GET", "/api/vendor/collections/col-a/product-search")).status, 401);
});

test("colecția publică afișează ambele produse (A1 propriu + B1 alt vendor), cu vendorul real", async () => {
  await call("POST", "/api/vendor/collections/col-a/products", { productIds: ["a1", "b1"] });
  currentUserId = null;

  const res = await call("GET", "/api/public/vendor-collections/colectia-a");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.collection.vendor.id, "vendor-a", "ownerul colecției");
  const sellers = Object.fromEntries(res.body.collection.products.map((p) => [p.id, p.service.vendor.id]));
  assert.deepEqual(sellers, { a1: "vendor-a", b1: "vendor-b" });
});

/* =========================================================
   FAZA 2 - pagina publică: allOwnProducts, reducere doar pe produse proprii,
   interval startsAt / endsAt (pricing REAL, productPromotionPrice.js)
========================================================= */

function setCollection(extra) {
  Object.assign(tables.vendorCollection[0], { discountPercent: 10, allOwnProducts: false, startsAt: null, endsAt: null, ...extra });
}

async function publicPage() {
  currentUserId = null;
  const res = await call("GET", "/api/public/vendor-collections/colectia-a");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

const priceOf = (page, id) => page.collection.products.find((p) => p.id === id)?.priceCents;

test("pagina publică allOwnProducts: TOATE produsele publice ale ownerului (inclusiv cele noi) + selecțiile cross-vendor", async () => {
  setCollection({ allOwnProducts: true });
  tables.vendorCollectionItem.push({ collectionId: "col-a", productId: "b1", position: 0 });
  tables.product.push(product("a2-nou", vendors.a, "Lumânare A2 publicată ulterior"));

  const page = await publicPage();
  const ids = page.collection.products.map((p) => p.id).sort();
  assert.deepEqual(ids, ["a1", "a2-nou", "b1"], "fără produse inactive / ale vendorilor inactivi");
  assert.equal(page.collection.status, "LIVE");
  assert.equal(page.collection.isLive, true);
});

test("pagina publică: reducerea colecției DOAR pe produsele proprii (a1 4500), NU pe produsul altui vendor (b1 5000)", async () => {
  setCollection({ allOwnProducts: true });
  tables.vendorCollectionItem.push({ collectionId: "col-a", productId: "b1", position: 0 });

  const page = await publicPage();
  assert.equal(priceOf(page, "a1"), 4500);
  assert.equal(priceOf(page, "b1"), 5000);
  const a1 = page.collection.products.find((p) => p.id === "a1");
  assert.equal(a1.originalPriceCents, 5000);
});

test("pagina publică: programată / expirată -> se afișează, dar fără reducere și fără token de atribuire", async () => {
  for (const [extra, status] of [
    [{ startsAt: new Date(Date.now() + 86400000) }, "SCHEDULED"],
    [{ endsAt: new Date(Date.now() - 86400000) }, "EXPIRED"],
  ]) {
    setCollection({ allOwnProducts: true, ...extra });
    const page = await publicPage();
    assert.equal(page.collection.status, status);
    assert.equal(page.collection.isLive, false);
    assert.equal(priceOf(page, "a1"), 5000, status);
    assert.equal(page.attributionToken, null, status);
  }
});

/* =========================================================
   FAZA 3 - editor (câmpuri noi), „Colecțiile magazinului”, legacy /c/:slug
========================================================= */

test("creare cu câmpurile noi: reducere, perioadă, allOwnProducts; stare + link public", async () => {
  const startsAt = new Date(Date.now() - 3600000).toISOString();
  const endsAt = new Date(Date.now() + 86400000).toISOString();

  const res = await call("POST", "/api/vendor/collections", {
    title: "Toamna în atelier",
    description: "Selecție",
    allOwnProducts: true,
    discountPercent: 15,
    startsAt,
    endsAt,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const c = res.body.collection;
  assert.equal(c.allOwnProducts, true);
  assert.equal(c.discountPercent, 15);
  assert.equal(new Date(c.startsAt).toISOString(), startsAt);
  assert.equal(c.status, "LIVE");
  assert.equal(c.publicPath, `/colectie-vendor/${c.slug}`);
});

test("editare: perioadă (setare + ștergere), reducere, allOwnProducts, cover", async () => {
  const future = new Date(Date.now() + 86400000).toISOString();

  let res = await call("PATCH", "/api/vendor/collections/col-a", {
    startsAt: future, discountPercent: 20, allOwnProducts: true, coverImage: "https://img/cover.jpg",
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.collection.status, "SCHEDULED");
  assert.equal(res.body.collection.discountPercent, 20);
  assert.equal(res.body.collection.coverImage, "https://img/cover.jpg");

  res = await call("PATCH", "/api/vendor/collections/col-a", { startsAt: null });
  assert.equal(res.body.collection.startsAt, null, "fără perioadă");
  assert.equal(res.body.collection.status, "LIVE");
});

test("validare: final înainte de început / reducere peste 50% / dată invalidă -> 400", async () => {
  const now = Date.now();
  const bad = [
    { startsAt: new Date(now + 86400000).toISOString(), endsAt: new Date(now).toISOString() },
    { discountPercent: 51 },
    { discountPercent: -1 },
    { startsAt: "nu-e-data" },
  ];
  for (const body of bad) {
    const res = await call("PATCH", "/api/vendor/collections/col-a", body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }

  // perioada se validează și față de valorile existente
  await call("PATCH", "/api/vendor/collections/col-a", { endsAt: new Date(now + 3600000).toISOString() });
  const res = await call("PATCH", "/api/vendor/collections/col-a", { startsAt: new Date(now + 7200000).toISOString() });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "invalid_period");
});

test("„Colecțiile magazinului”: doar colecțiile ACTIVE ÎN INTERVAL ale vendorului magazinului", async () => {
  tables.serviceProfile = [
    { id: "sp-a", slug: "magazin-a", service: { vendorId: "vendor-a", vendor: { isActive: true } } },
    { id: "sp-c", slug: "magazin-c", service: { vendorId: "vendor-c", vendor: { isActive: false } } },
  ];
  tables.vendorCollection.push(
    { id: "col-a2", vendorId: "vendor-a", title: "Viitoare", slug: "viitoare", isActive: true, startsAt: new Date(Date.now() + 86400000), createdAt: new Date() },
    { id: "col-a3", vendorId: "vendor-a", title: "Oprită", slug: "oprita", isActive: false, createdAt: new Date() },
    { id: "col-b", vendorId: "vendor-b", title: "A lui B", slug: "colectia-b", isActive: true, createdAt: new Date() }
  );
  currentUserId = null;

  const res = await call("GET", "/api/public/vendor-collections/store/magazin-a");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.collections.map((c) => c.slug), ["colectia-a"]);
  assert.equal(res.body.collections[0].publicPath, "/colectie-vendor/colectia-a");

  const inactive = await call("GET", "/api/public/vendor-collections/store/magazin-c");
  assert.deepEqual(inactive.body.collections, []);
  const unknown = await call("GET", "/api/public/vendor-collections/store/nu-exista");
  assert.deepEqual(unknown.body.collections, []);
});

test("legacy /c/:slug: campanie MIGRATĂ -> slug-ul colecției; nemigrată / inexistentă -> 404", async () => {
  tables.vendorCampaign = [
    { id: "camp-mig", slug: "toamna-veche", vendorId: "vendor-a" },
    { id: "camp-old", slug: "campanie-nemigrata", vendorId: "vendor-a" },
  ];
  // migrare cu coliziune de slug: colecția are alt slug, maparea merge prin legacyCampaignId
  Object.assign(tables.vendorCollection[0], { legacyCampaignId: "camp-mig" });
  currentUserId = null;

  const migrated = await call("GET", "/api/public/vendor-collections/legacy-campaign/toamna-veche");
  assert.equal(migrated.status, 200);
  assert.equal(migrated.body.collectionSlug, "colectia-a");

  assert.equal((await call("GET", "/api/public/vendor-collections/legacy-campaign/campanie-nemigrata")).status, 404);
  assert.equal((await call("GET", "/api/public/vendor-collections/legacy-campaign/nu-exista")).status, 404);
});

test("pagina publică: fiecare produs are sellerul REAL (magazin + vendor), separat de ownerul colecției", async () => {
  tables.vendorCollectionItem.push({ collectionId: "col-a", productId: "b1", position: 0 });
  const page = await publicPage();
  const b1 = page.collection.products.find((p) => p.id === "b1");
  assert.equal(page.collection.vendor.id, "vendor-a", "ownerul colecției");
  assert.equal(b1.service.vendor.id, "vendor-b", "sellerul real");
  assert.equal(b1.service.profile.displayName, "Magazinul Atelier B");
});

/* =========================================================
   ETAPA 1: sursă (magazinul meu / tot Artfest), filtre, selecție
   multiplă, „selectează toate rezultatele filtrate”, limită 300,
   eliminare în masă, starea produselor din colecție
========================================================= */

// produse suplimentare pentru filtre (prețuri, ocazii, disponibilitate, personalizare)
function seedFilterProducts() {
  tables.product.push(
    product("a-botez", vendors.a, "Mărturie botez A", {
      priceCents: 2500,
      occasionTags: ["Botez"],
      acceptsCustom: true,
      description: "Mărturie personalizată cu numele copilului",
    }),
    product("b-botez", vendors.b, "Cutiuță botez B", {
      priceCents: 7900,
      occasionTags: ["botez", "Ziua mamei"],
      availability: "MADE_TO_ORDER",
    }),
    product("b-scump", vendors.b, "Tablou mare B", { priceCents: 25000, occasionTags: ["Casă nouă"] }),
    product("b-epuizat", vendors.b, "Vază epuizată B", { availability: "SOLD_OUT" })
  );
}

test("sursa „Produse din magazinul meu” -> doar produsele ownerului; „Tot Artfest” -> inclusiv propriile", async () => {
  seedFilterProducts();

  const own = (await searchIds("?scope=own")).sort();
  assert.deepEqual(own, ["a-botez", "a1"]);

  const all = (await searchIds("?scope=marketplace")).sort();
  assert.deepEqual(all, ["a-botez", "a1", "b-botez", "b-epuizat", "b-scump", "b1"]);

  // fără scope = tot Artfest (comportamentul de până acum)
  assert.deepEqual((await searchIds()).sort(), all);
});

test("filtre: buget (min/max în lei), ocazie, disponibilitate, personalizare, text din descriere", async () => {
  seedFilterProducts();

  assert.deepEqual((await searchIds("?maxPrice=80&occasion=baptism")).sort(), ["a-botez", "b-botez"]);
  assert.deepEqual(await searchIds("?minPrice=100"), ["b-scump"]);
  assert.deepEqual(await searchIds("?availability=MADE_TO_ORDER"), ["b-botez"]);
  assert.deepEqual(await searchIds("?personalizable=1"), ["a-botez"]);
  assert.deepEqual(await searchIds("?q=numele%20copilului"), ["a-botez"], "căutarea include descrierea");

  // filtrele nu ocolesc niciodată eligibilitatea publică
  assert.ok(!(await searchIds("?q=Lum%C3%A2nare")).some((id) => /inactive|hidden|pending|draftstore|c1/.test(id)));
});

test("rezultatul are totalul filtrat, limita colecției, disponibilitatea și personalizarea", async () => {
  seedFilterProducts();

  const res = await call("GET", "/api/vendor/collections/col-a/product-search?scope=marketplace&limit=2");
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 6);
  assert.equal(res.body.products.length, 2);
  assert.equal(res.body.hasMore, true);
  assert.equal(res.body.maxProducts, 300);
  assert.equal(res.body.collectionCount, 0);

  const all = (await call("GET", "/api/vendor/collections/col-a/product-search?limit=48")).body.products;
  assert.equal(all.find((p) => p.id === "b-epuizat").soldOut, true);
  assert.equal(all.find((p) => p.id === "a-botez").personalizable, true);
});

test("selecție multiplă (ids): produsele neeligibile sunt raportate, nu adăugate", async () => {
  const res = await call("POST", "/api/vendor/collections/col-a/products", {
    productIds: ["a1", "b1", "b-inactive", "b-hidden", "nu-exista"],
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.added, 2);
  assert.equal(res.body.ineligible, 3);
  assert.deepEqual(tables.vendorCollectionItem.map((i) => i.productId).sort(), ["a1", "b1"]);
});

test("„Selectează toate rezultatele filtrate” = SELECȚIE FIXĂ: doar produsele filtrate și eligibile; cele publicate ulterior NU intră", async () => {
  seedFilterProducts();

  const res = await call("POST", "/api/vendor/collections/col-a/products/select-all", {
    filters: { scope: "marketplace", occasion: "baptism", maxPrice: 80 },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.added, 2);
  assert.deepEqual(tables.vendorCollectionItem.map((i) => i.productId).sort(), ["a-botez", "b-botez"]);

  // un produs nou, care ar îndeplini filtrul, publicat DUPĂ selecție
  tables.product.push(product("b-botez-nou", vendors.b, "Botez nou B", { priceCents: 3000, occasionTags: ["Botez"] }));
  assert.ok(
    !tables.vendorCollectionItem.some((i) => i.productId === "b-botez-nou"),
    "selecția nu se actualizează singură"
  );

  // re-rularea adaugă DOAR ce lipsește (fără dubluri)
  const again = await call("POST", "/api/vendor/collections/col-a/products/select-all", {
    filters: { scope: "marketplace", occasion: "baptism", maxPrice: 80 },
  });
  assert.equal(again.body.added, 1);
  assert.equal(tables.vendorCollectionItem.length, 3);
});

test("„Adaugă toate produsele eligibile din magazinul meu” (fără filtre) -> doar produsele proprii publice", async () => {
  seedFilterProducts();

  const res = await call("POST", "/api/vendor/collections/col-a/products/select-all", {
    filters: { scope: "own" },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(tables.vendorCollectionItem.map((i) => i.productId).sort(), ["a-botez", "a1"]);
});

test("limita de 300: peste limită nu se adaugă nimic parțial și se spune câte mai încap", async () => {
  // 299 deja în colecție
  for (let i = 0; i < 299; i += 1) {
    const id = `bulk-${i}`;
    tables.product.push(product(id, vendors.b, `Produs bulk ${i}`));
    tables.vendorCollectionItem.push({ collectionId: "col-a", productId: id, position: i, createdAt: new Date() });
  }

  const over = await call("POST", "/api/vendor/collections/col-a/products", { productIds: ["a1", "b1"] });
  assert.equal(over.status, 400);
  assert.equal(over.body.error, "collection_product_limit");
  assert.equal(over.body.remaining, 1);
  assert.equal(tables.vendorCollectionItem.length, 299, "nimic adăugat parțial");

  // re-selectarea unui produs existent NU consumă din limită
  const same = await call("POST", "/api/vendor/collections/col-a/products", { productIds: ["bulk-0", "a1"] });
  assert.equal(same.status, 200);
  assert.equal(same.body.added, 1);
  assert.equal(tables.vendorCollectionItem.length, 300);

  const full = await call("POST", "/api/vendor/collections/col-a/products/select-all", {
    filters: { scope: "marketplace" },
  });
  assert.equal(full.status, 400);
  assert.equal(full.body.remaining, 0);
  assert.equal(tables.vendorCollectionItem.length, 300);
});

test("eliminare în masă: doar produsele cerute, doar din colecția proprie; produsele rămân neatinse", async () => {
  await call("POST", "/api/vendor/collections/col-a/products", { productIds: ["a1", "b1"] });
  tables.vendorCollection.push({ id: "col-b", vendorId: "vendor-b", title: "Colecția B", slug: "colectia-b", isActive: true, sort: "curated", visits: 0, clicks: 0, createdAt: new Date(), updatedAt: new Date() });
  tables.vendorCollectionItem.push({ collectionId: "col-b", productId: "b1", position: 0, createdAt: new Date() });

  const res = await call("POST", "/api/vendor/collections/col-a/products/remove", { productIds: ["a1", "b1", "nu-e-in-colectie"] });
  assert.equal(res.status, 200);
  assert.equal(res.body.removed, 2);
  assert.deepEqual(tables.vendorCollectionItem.map((i) => `${i.collectionId}:${i.productId}`), ["col-b:b1"], "colecția altui vendor neatinsă");
  assert.ok(tables.product.some((p) => p.id === "a1") && tables.product.some((p) => p.id === "b1"), "produsele nu se șterg");

  // vendorul A nu poate goli colecția lui B
  const foreign = await call("POST", "/api/vendor/collections/col-b/products/remove", { productIds: ["b1"] });
  assert.equal(foreign.status, 404);
  assert.equal(tables.vendorCollectionItem.length, 1);
});

test("permisiuni: select-all / remove doar pe colecția proprie; neautentificat -> 401", async () => {
  currentUserId = "user-b";
  const sel = await call("POST", "/api/vendor/collections/col-a/products/select-all", { filters: {} });
  assert.equal(sel.status, 404);

  currentUserId = null;
  const anon = await call("POST", "/api/vendor/collections/col-a/products/remove", { productIds: ["a1"] });
  assert.equal(anon.status, 401);
});

test("editor: produsele devenite neeligibile sunt marcate clar (indisponibil / epuizat), fără să fie șterse", async () => {
  seedFilterProducts();
  await call("POST", "/api/vendor/collections/col-a/products", { productIds: ["a1", "b1", "b-epuizat"] });

  // după adăugare: B1 e dezactivat de vendorul lui
  tables.product.find((p) => p.id === "b1").isActive = false;

  const res = await call("GET", "/api/vendor/collections/col-a");
  assert.equal(res.status, 200);
  const status = Object.fromEntries(res.body.collection.items.map((i) => [i.productId, i.status]));
  assert.deepEqual(status, { a1: "available", b1: "unavailable", "b-epuizat": "sold_out" });
  assert.equal(res.body.collection.items.find((i) => i.productId === "a1").isOwn, true);
  assert.equal(res.body.collection.items.find((i) => i.productId === "b1").isOwn, false);
  assert.equal(res.body.collection.maxProducts, 300);

  // pagina publică NU afișează produsul indisponibil
  const page = (await call("GET", "/api/public/vendor-collections/colectia-a")).body;
  assert.ok(!page.collection.products.some((p) => p.id === "b1"));
});

/* =========================================================
   AUDIT ETAPA 1
========================================================= */

test("ocazia: cheia (baptism) găsește eticheta salvată în producție („Botez”) și tagul liber („botez”)", async () => {
  seedFilterProducts();

  assert.deepEqual((await searchIds("?occasion=baptism")).sort(), ["a-botez", "b-botez"]);
  assert.deepEqual(await searchIds("?occasion=new_home"), ["b-scump"]);
  assert.deepEqual(await searchIds("?occasion=mothers_day"), ["b-botez"]);
  assert.deepEqual(await searchIds("?occasion=wedding"), []);
});

test("selectableTotal = exact câte produse noi adaugă „Selectează toate cele N”", async () => {
  seedFilterProducts();
  await call("POST", "/api/vendor/collections/col-a/products", { productIds: ["b1"] });

  const search = await call("GET", "/api/vendor/collections/col-a/product-search?scope=marketplace");
  assert.equal(search.body.total, 6);
  assert.equal(search.body.selectableTotal, 5, "b1 e deja în colecție");

  const add = await call("POST", "/api/vendor/collections/col-a/products/select-all", { filters: { scope: "marketplace" } });
  assert.equal(add.body.added, search.body.selectableTotal);
  assert.equal(new Set(tables.vendorCollectionItem.map((i) => i.productId)).size, tables.vendorCollectionItem.length, "fără duplicate");
});

test("„Include automat toate produsele mele”: produsele proprii nu se adaugă explicit și nu consumă din limită", async () => {
  seedFilterProducts();
  tables.vendorCollection[0].allOwnProducts = true;

  const search = await call("GET", "/api/vendor/collections/col-a/product-search?scope=marketplace");
  assert.equal(search.body.selectableTotal, 4, "doar produsele altor magazine (b1, b-botez, b-scump, b-epuizat)");

  const add = await call("POST", "/api/vendor/collections/col-a/products/select-all", { filters: { scope: "marketplace" } });
  assert.equal(add.status, 200);
  assert.deepEqual(
    tables.vendorCollectionItem.map((i) => i.productId).sort(),
    ["b-botez", "b-epuizat", "b-scump", "b1"]
  );

  const ownOnly = await call("POST", "/api/vendor/collections/col-a/products/select-all", { filters: { scope: "own" } });
  assert.equal(ownOnly.body.added, 0);
});

test("API ocolit (fără frontend): select-all și adăugarea directă nu acceptă produse neeligibile", async () => {
  // filtru care ar „prinde” produsele inactive / ascunse / neaprobate după titlu
  const add = await call("POST", "/api/vendor/collections/col-a/products/select-all", {
    filters: { scope: "marketplace", q: "Lumânare" },
  });
  assert.equal(add.status, 200);
  assert.deepEqual(tables.vendorCollectionItem.map((i) => i.productId).sort(), ["a1", "b1"]);

  const direct = await call("POST", "/api/vendor/collections/col-a/products", {
    productIds: ["b-inactive", "b-hidden", "b-pending", "b-draftstore", "c1"],
  });
  assert.equal(direct.status, 400);
  assert.equal(direct.body.error, "no_valid_products");
  assert.equal(tables.vendorCollectionItem.length, 2);
});

/* =========================================================
   ASISTENT AI („Găsește produse cu AI”) - AI SIMULAT, fără costuri
========================================================= */

beforeEach(() => {
  aiCalls.length = 0;
  aiReply = () => ({ recommendations: [] });
});

// candidații trimiși modelului (din textul cererii către AI)
function aiCandidateIds(callArgs = aiCalls[aiCalls.length - 1]) {
  const text = callArgs.input.find((m) => m.role === "user").content[0].text;
  const start = text.indexOf("PRODUSE CANDIDATE REALE:") + "PRODUSE CANDIDATE REALE:".length;
  const json = text.slice(start, text.indexOf("REGULI:")).trim();
  return JSON.parse(json).map((c) => c.id).sort();
}

function seedChristmas() {
  tables.product.push(
    product("x-a", vendors.a, "Glob Crăciun A", { priceCents: 4500, occasionTags: ["Crăciun"] }),
    product("x-b1", vendors.b, "Brad decorativ B", { priceCents: 6000, occasionTags: ["Crăciun"] }),
    product("x-b2", vendors.b, "Coroniță Crăciun B", { priceCents: 9000, occasionTags: ["Crăciun"] }),
    product("x-b-scump", vendors.b, "Ren mare B", { priceCents: 19000, occasionTags: ["Crăciun"] }),
    product("x-b-epuizat", vendors.b, "Glob epuizat B", { priceCents: 3000, occasionTags: ["Crăciun"], availability: "SOLD_OUT" }),
    product("x-b-inactiv", vendors.b, "Glob inactiv B", { priceCents: 3000, occasionTags: ["Crăciun"], isActive: false })
  );
  const d = { id: "vendor-d", userId: "user-d", displayName: "Atelier D", isActive: true, referralCode: null };
  tables.vendor.push({ ...d });
  tables.product.push(product("x-d", d, "Lumânare Crăciun D", { priceCents: 5000, occasionTags: ["Crăciun"] }));
}

const aiSuggest = (body) => call("POST", "/api/vendor/collections/col-a/ai-suggest", body);

test("AI: cererea scrisă devine filtre reale; doar produse eligibile, în buget, din ocazie, fără epuizate", async () => {
  seedChristmas();

  const res = await aiSuggest({ prompt: "Vreau 20 de cadouri pentru Crăciun, sub 100 lei, din magazine diferite" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(aiCandidateIds(), ["x-a", "x-b1", "x-b2", "x-d"], "fără >100 lei, epuizate, inactive sau alte ocazii");
  assert.equal(res.body.interpretation.occasion, "christmas");
  assert.equal(res.body.interpretation.maxPrice, 100);
  assert.equal(res.body.interpretation.count, 20);
  assert.equal(res.body.interpretation.diverseStores, true);
});

test("AI: răspunsul modelului e filtrat - fără id-uri inventate, duplicate, neeligibile sau deja în colecție; datele vin din DB", async () => {
  seedChristmas();
  tables.vendorCollectionItem.push({ collectionId: "col-a", productId: "x-b1", position: 0, createdAt: new Date() });
  aiReply = () => ({
    recommendations: [
      { productId: "x-b2", reason: "Coroniță potrivită" },
      { productId: "inventat-123", reason: "nu există" },
      { productId: "x-b2", reason: "duplicat" },
      { productId: "x-b-inactiv", reason: "neeligibil" },
      { productId: "x-b1", reason: "deja în colecție" },
      { productId: "x-a", reason: "Glob handmade" },
    ],
  });

  const res = await aiSuggest({ prompt: "cadouri de Crăciun sub 100 lei" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.products.map((p) => p.id), ["x-b2", "x-a"]);
  const coronita = res.body.products[0];
  assert.equal(coronita.priceCents, 9000, "prețul din DB, nu din AI");
  assert.equal(coronita.storeName, "Magazinul Atelier B");
  assert.equal(coronita.reason, "Coroniță potrivită");
  assert.equal(res.body.products[1].isOwn, true);
  assert.equal(tables.vendorCollectionItem.length, 1, "AI-ul NU adaugă nimic în colecție");
});

test("AI: „din magazine diferite” -> cel mult un produs per magazin (aplicat pe server)", async () => {
  seedChristmas();
  aiReply = () => ({
    recommendations: ["x-b1", "x-b2", "x-a", "x-d"].map((productId) => ({ productId, reason: "ok" })),
  });

  const res = await aiSuggest({ prompt: "cadouri de Crăciun din magazine diferite" });
  assert.deepEqual(res.body.products.map((p) => p.id), ["x-b1", "x-a", "x-d"]);
});

test("AI: sursa „Magazinul meu” și filtrele din interfață au prioritate față de text", async () => {
  seedChristmas();
  await aiSuggest({ prompt: "cadouri de Crăciun sub 100 lei", filters: { scope: "own" } });
  assert.deepEqual(aiCandidateIds(), ["x-a"]);

  await aiSuggest({ prompt: "cadouri de Crăciun sub 100 lei", filters: { scope: "marketplace", maxPrice: 50 } });
  assert.deepEqual(aiCandidateIds(), ["x-a", "x-d"], "maxPrice 50 din interfață bate „sub 100” din text");
});

test("AI: limita implicită de 5 solicitări / zi / vânzător (persistentă, AiUsageDaily)", async () => {
  seedChristmas();
  for (let i = 0; i < 5; i += 1) {
    const ok = await aiSuggest({ prompt: "cadouri de Crăciun" });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.meta.remaining, 4 - i);
  }
  assert.equal(aiCalls.length, 5);

  const blocked = await aiSuggest({ prompt: "cadouri de Crăciun" });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error, "ai_vendor_daily_limit");
  assert.match(blocked.body.message, /cele 5 căutări AI de azi/);
  assert.equal(blocked.body.meta.remaining, 0);
  assert.equal(aiCalls.length, 5, "a 6-a solicitare nu mai ajunge la AI");

  // alt vânzător are limita lui
  currentUserId = "user-b";
  tables.vendorCollection.push({ id: "col-b", vendorId: "vendor-b", title: "B", slug: "colectia-b", isActive: true, sort: "curated", visits: 0, clicks: 0, createdAt: new Date(), updatedAt: new Date() });
  const other = await call("POST", "/api/vendor/collections/col-b/ai-suggest", { prompt: "cadouri de Crăciun" });
  assert.equal(other.status, 200);
});

test("AI: fără candidați nu se apelează modelul și nu se consumă din limită", async () => {
  const res = await aiSuggest({ prompt: "cadouri de Crăciun sub 5 lei" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.products, []);
  assert.equal(aiCalls.length, 0);
  assert.equal(res.body.meta.remaining, 5);
});

test("AI: răspuns invalid de la model -> 502, fără adăugări; fără cheie OpenAI -> 503", async () => {
  seedChristmas();
  aiReply = () => "nu e json";
  const bad = await aiSuggest({ prompt: "cadouri de Crăciun" });
  assert.equal(bad.status, 502);
  assert.equal(tables.vendorCollectionItem.length, 0);

  const key = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const off = await aiSuggest({ prompt: "cadouri de Crăciun" });
    assert.equal(off.status, 503);
  } finally {
    process.env.OPENAI_API_KEY = key;
  }
});

test("AI: permisiuni și validare - colecția altuia 404, neautentificat 401, cerere goală 400", async () => {
  currentUserId = "user-b";
  assert.equal((await aiSuggest({ prompt: "cadouri de Crăciun" })).status, 404);

  currentUserId = null;
  assert.equal((await aiSuggest({ prompt: "cadouri de Crăciun" })).status, 401);

  currentUserId = "user-a";
  assert.equal((await aiSuggest({ prompt: " " })).status, 400);
  assert.equal(aiCalls.length, 0);
});

/* =========================================================
   LIMITE AI PERSISTENTE (AiUsageDaily) - AI și Prisma simulate
========================================================= */

const usageRows = () => tables.aiUsageDaily || [];
const vendorUsage = (vendorId = "vendor-a") => usageRows().find((r) => r.scope === "vendor" && r.subjectId === vendorId);
const globalUsage = () => usageRows().find((r) => r.scope === "global");

function withEnv(overrides, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve(fn()).finally(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

test("limite AI: comutatorul AI_VENDOR_COLLECTIONS_ENABLED=0 oprește imediat, fără apel și fără consum", async () => {
  seedChristmas();
  await withEnv({ AI_VENDOR_COLLECTIONS_ENABLED: "0" }, async () => {
    const res = await aiSuggest({ prompt: "cadouri de Crăciun" });
    assert.equal(res.status, 503);
    assert.equal(res.body.error, "ai_disabled");

    const status = await call("GET", "/api/vendor/collections/ai-status");
    assert.equal(status.body.enabled, false);
  });
  assert.equal(aiCalls.length, 0);
  assert.equal(usageRows().length, 0);
});

test("limite AI: /ai-status arată limita și căutările rămase (nu e confundat cu un id de colecție)", async () => {
  seedChristmas();
  const before = await call("GET", "/api/vendor/collections/ai-status");
  assert.equal(before.status, 200);
  assert.deepEqual(
    { enabled: before.body.enabled, available: before.body.available, dailyLimit: before.body.dailyLimit, remaining: before.body.remaining },
    { enabled: true, available: true, dailyLimit: 5, remaining: 5 }
  );

  await aiSuggest({ prompt: "cadouri de Crăciun" });
  assert.equal((await call("GET", "/api/vendor/collections/ai-status")).body.remaining, 4);
});

test("limite AI: limitele se schimbă din env, fără modificări de cod", async () => {
  seedChristmas();
  await withEnv({ AI_VENDOR_COLLECTIONS_VENDOR_DAILY_LIMIT: "2" }, async () => {
    assert.equal((await aiSuggest({ prompt: "cadouri de Crăciun" })).status, 200);
    assert.equal((await aiSuggest({ prompt: "cadouri de Crăciun" })).status, 200);
    const third = await aiSuggest({ prompt: "cadouri de Crăciun" });
    assert.equal(third.status, 429);
    assert.match(third.body.message, /cele 2 căutări AI/);
  });
});

test("limite AI: limita globală pe platformă (50 implicit; aici 2 din env) - vânzătorul refuzat nu pierde din cotă", async () => {
  seedChristmas();
  await withEnv({ AI_VENDOR_COLLECTIONS_GLOBAL_DAILY_LIMIT: "2" }, async () => {
    assert.equal((await aiSuggest({ prompt: "cadouri de Crăciun" })).status, 200);
    assert.equal((await aiSuggest({ prompt: "cadouri de Crăciun" })).status, 200);

    currentUserId = "user-b";
    tables.vendorCollection.push({ id: "col-b", vendorId: "vendor-b", title: "B", slug: "colectia-b", isActive: true, sort: "curated", visits: 0, clicks: 0, createdAt: new Date(), updatedAt: new Date() });
    const refused = await call("POST", "/api/vendor/collections/col-b/ai-suggest", { prompt: "cadouri de Crăciun" });
    assert.equal(refused.status, 503);
    assert.equal(refused.body.error, "ai_global_daily_limit");
    assert.equal(vendorUsage("vendor-b").requests, 0, "cota vânzătorului B restituită");
  });
  assert.equal(aiCalls.length, 2);
});

test("limite AI: bugetul lunar (5 USD implicit) oprește funcția când e atins", async () => {
  seedChristmas();
  const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit" }).format(new Date());
  tables.aiUsageDaily = [
    { feature: "vendor_collections", scope: "global", subjectId: "all", day: `${month}-01`, requests: 0, failures: 0, inputTokens: 0, outputTokens: 0, costMicroUsd: 5_000_000, lockedUntil: null },
  ];
  const res = await aiSuggest({ prompt: "cadouri de Crăciun" });
  assert.equal(res.status, 503);
  assert.equal(res.body.error, "ai_monthly_budget");
  assert.equal(aiCalls.length, 0);
});

test("limite AI: cereri SIMULTANE ale aceluiași vânzător -> una singură ajunge la AI, restul 409", async () => {
  seedChristmas();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  aiReply = () => ({ recommendations: [] });
  const original = fakeOpenai.responses.create;
  fakeOpenai.responses.create = async (args) => {
    aiCalls.push(args);
    await gate; // primul apel „durează”
    return { output_text: JSON.stringify({ recommendations: [] }), usage: { input_tokens: 100, output_tokens: 10 } };
  };

  try {
    const pending = Array.from({ length: 5 }, () => aiSuggest({ prompt: "cadouri de Crăciun" }));
    await new Promise((r) => setTimeout(r, 150));
    release();
    const results = await Promise.all(pending);
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.ok(results.filter((r) => r.status !== 200).every((r) => r.status === 409 && r.body.error === "ai_in_progress"));
    assert.equal(aiCalls.length, 1);
    assert.equal(vendorUsage().requests, 1, "doar cererea care a ajuns la AI a consumat");
    assert.equal(vendorUsage().lockedUntil, null, "lock eliberat după răspuns");
  } finally {
    fakeOpenai.responses.create = original;
  }
});

test("limite AI: timeout / 5xx -> cota NU se restituie (posibil facturat) + cost estimat; 429 de la OpenAI -> restituită", async () => {
  seedChristmas();
  const original = fakeOpenai.responses.create;
  try {
    fakeOpenai.responses.create = async () => {
      const err = new Error("Request timed out.");
      err.name = "APIConnectionTimeoutError";
      throw err;
    };
    const timeout = await aiSuggest({ prompt: "cadouri de Crăciun" });
    assert.equal(timeout.status, 504);
    assert.equal(timeout.body.error, "ai_timeout");
    assert.equal(vendorUsage().requests, 1, "nu se restituie: OpenAI poate fi procesat cererea");
    assert.ok(globalUsage().costMicroUsd > 0, "cost estimat conservator adăugat la buget");

    fakeOpenai.responses.create = async () => {
      const err = new Error("Internal server error");
      err.status = 500;
      throw err;
    };
    assert.equal((await aiSuggest({ prompt: "cadouri de Crăciun" })).status, 502);
    assert.equal(vendorUsage().requests, 2);

    fakeOpenai.responses.create = async () => {
      const err = new Error("Rate limit");
      err.status = 429;
      throw err;
    };
    const busy = await aiSuggest({ prompt: "cadouri de Crăciun" });
    assert.equal(busy.status, 503);
    assert.equal(busy.body.error, "ai_busy");
    assert.equal(vendorUsage().requests, 2, "OpenAI a refuzat (4xx) -> restituită");
    assert.equal(vendorUsage().lockedUntil, null);
  } finally {
    fakeOpenai.responses.create = original;
  }
});

test("limite AI: apelul OpenAI are timeout 20 s, fără retry, gpt-4.1-mini și plafon de tokeni generați", async () => {
  seedChristmas();
  const original = fakeOpenai.responses.create;
  let captured = null;
  fakeOpenai.responses.create = async (params, options) => {
    captured = { params, options };
    return { output_text: JSON.stringify({ recommendations: [] }), usage: { input_tokens: 12000, output_tokens: 900 } };
  };
  try {
    await aiSuggest({ prompt: "cadouri de Crăciun" });
  } finally {
    fakeOpenai.responses.create = original;
  }
  assert.equal(captured.params.model, "gpt-4.1-mini");
  assert.equal(captured.params.max_output_tokens, 1500);
  assert.equal(captured.options.timeout, 20000);
  assert.equal(captured.options.maxRetries, 0);
  assert.ok(captured.options.signal, "anulare dacă vânzătorul închide pagina");
  // costul real din usage: 12000 × 0,40 + 900 × 1,60 = 6240 micro-USD
  assert.equal(globalUsage().costMicroUsd, 6240);
  assert.equal(globalUsage().inputTokens, 12000);
});

test("limite AI: răspuns invalid de la model = facturat -> cota rămâne consumată, costul real înregistrat", async () => {
  seedChristmas();
  const original = fakeOpenai.responses.create;
  fakeOpenai.responses.create = async () => ({ output_text: "nu e json", usage: { input_tokens: 500, output_tokens: 20 } });
  try {
    assert.equal((await aiSuggest({ prompt: "cadouri de Crăciun" })).status, 502);
  } finally {
    fakeOpenai.responses.create = original;
  }
  assert.equal(vendorUsage().requests, 1);
  assert.equal(globalUsage().inputTokens, 500);
});

test("limite AI: repornirea serverului nu resetează limitele (router încărcat din nou, aceeași bază)", async () => {
  seedChristmas();
  for (let i = 0; i < 5; i += 1) await aiSuggest({ prompt: "cadouri de Crăciun" });

  // „repornire”: modul nou, fără nicio stare în memorie, pe aceeași bază simulată
  const fresh = await import(`./vendorCollectionsRoutes.js?restart=${Date.now()}`);
  const app = express();
  app.use(express.json());
  app.use("/api/vendor/collections", fresh.default);
  const server2 = http.createServer(app);
  await new Promise((r) => server2.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${server2.address().port}/api/vendor/collections/col-a/ai-suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "cadouri de Crăciun" }),
    });
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.equal(body.error, "ai_vendor_daily_limit");
    assert.equal(body.meta.remaining, 0);
  } finally {
    await new Promise((r) => server2.close(r));
  }
  assert.equal(aiCalls.length, 5);
});
