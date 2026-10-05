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

  const ops = ["in", "notIn", "not", "equals", "contains", "mode", "gte", "lte", "gt", "lt", "has"];
  if (!Object.keys(cond).every((k) => ops.includes(k))) return value && typeof value === "object" && matches(value, cond);

  for (const [op, v] of Object.entries(cond)) {
    if (op === "in" && !v.includes(value)) return false;
    if (op === "notIn" && v.includes(value)) return false;
    if (op === "not" && value === v) return false;
    if (op === "equals" && value !== v) return false;
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
      for (const d of data) {
        if (!rows().some((r) => r.collectionId === d.collectionId && r.productId === d.productId)) rows().push({ createdAt: new Date(), ...d });
      }
      return { count: data.length };
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
const restores = [];

before(async () => {
  restores.push(mock.module("../db.js", { namedExports: { prisma: dbProxy } }));
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
