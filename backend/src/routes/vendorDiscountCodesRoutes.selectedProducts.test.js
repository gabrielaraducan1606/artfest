// src/routes/vendorDiscountCodesRoutes.selectedProducts.test.js
//
// Coduri de reducere VENDOR - „Doar anumite produse” (SELECTED_PRODUCTS),
// pe ruta REALĂ, cu Prisma SIMULAT (in-memory, fără nicio conexiune la DB):
//  - creare / editare cu verificarea STRICTĂ a apartenenței produselor;
//  - limita de 300 de produse, lista goală, produse trimise pentru alte moduri;
//  - finanțare 100% vendor, plafon 50% (ca „Doar produsele mele”), și la editare;
//  - codurile existente (VENDOR_ALL_PRODUCTS / ALL_PRODUCTS / VENDOR_COLLECTION)
//    se comportă exact ca înainte;
//  - căutarea și „Toate rezultatele filtrate”: DOAR produsele publice ale vendorului;
//  - starea produselor la editare: inactive / mutate la alt magazin / șterse.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/vendorDiscountCodesRoutes.selectedProducts.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5/x";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test-key-fara-apeluri-reale";

import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

/* =========================================================
   Prisma simulat - respectă filtrele pe relații ({ is: ... })
========================================================= */

let seq = 0;
const nextId = (p) => `${p}_${++seq}`;
let tables;

function matchValue(value, cond) {
  if (cond === undefined) return true;
  if (cond === null) return value === null || value === undefined;
  if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
  if (typeof cond !== "object" || Array.isArray(cond)) return value === cond;

  if ("is" in cond) return cond.is === null ? value == null : value != null && matches(value, cond.is);

  const ops = ["in", "notIn", "not", "equals", "contains", "mode", "gte", "lte", "gt", "lt", "hasSome", "has", "startsWith"];
  if (!Object.keys(cond).some((k) => ops.includes(k))) {
    return value != null && typeof value === "object" && matches(value, cond);
  }

  for (const [op, v] of Object.entries(cond)) {
    const insensitive = cond.mode === "insensitive";
    if (op === "in" && !v.includes(value)) return false;
    if (op === "notIn" && v.includes(value)) return false;
    if (op === "not") {
      if (v !== null && typeof v === "object") {
        if (matchValue(value, v)) return false;
      } else if (v === null ? value == null : value === v) return false;
    }
    if (op === "equals" && value !== v) return false;
    if (op === "contains") {
      const a = String(value ?? "");
      if (!(insensitive ? a.toLowerCase().includes(String(v).toLowerCase()) : a.includes(v))) return false;
    }
    if (op === "gte" && !(value >= v)) return false;
    if (op === "lte" && !(value <= v)) return false;
    if (op === "gt" && !(value > v)) return false;
    if (op === "lt" && !(value < v)) return false;
    if (op === "hasSome" && !(Array.isArray(value) && value.some((x) => v.includes(x)))) return false;
    if (op === "has" && !(Array.isArray(value) && value.includes(v))) return false;
    if (op === "startsWith" && !String(value ?? "").startsWith(v)) return false;
  }
  return true;
}

function matches(row, where = {}) {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === "AND") {
      if (!(Array.isArray(cond) ? cond : [cond]).every((w) => matches(row, w))) return false;
      continue;
    }
    if (key === "OR") {
      if (!cond.some((w) => matches(row, w))) return false;
      continue;
    }
    if (key === "NOT") {
      if ((Array.isArray(cond) ? cond : [cond]).some((w) => matches(row, w))) return false;
      continue;
    }
    if (!matchValue(row?.[key], cond)) return false;
  }
  return true;
}

// produsul „văzut” de Prisma: cu service/vendor/type ca relații
const productView = (p) => {
  const vendor = tables.vendor.find((v) => v.id === p.service.vendorId) || null;
  return { ...p, service: { ...p.service, vendor } };
};

function discountCodeView(code, include) {
  if (!code) return null;
  const out = { ...code };
  if (include?.vendorCollection) {
    out.vendorCollection = tables.vendorCollection.find((c) => c.id === code.vendorCollectionId) || null;
  }
  if (include?._count) {
    out._count = {
      redemptions: 0,
      products: tables.discountCodeProduct.filter((l) => l.discountCodeId === code.id).length,
    };
  }
  return out;
}

const sortRows = (rows, orderBy) => {
  const list = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
  return [...rows].sort((a, b) => {
    for (const o of list) {
      const [[k, dir]] = Object.entries(o);
      const d = a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0;
      if (d) return dir === "desc" ? -d : d;
    }
    return 0;
  });
};

function makePrisma() {
  const proxy = {
    vendor: {
      findUnique: async ({ where }) => tables.vendor.find((v) => matches(v, where)) || null,
    },
    vendorCollection: {
      findFirst: async ({ where }) => tables.vendorCollection.find((c) => matches(c, where)) || null,
    },
    product: {
      findMany: async ({ where, orderBy, skip = 0, take } = {}) => {
        let rows = tables.product.map(productView).filter((p) => matches(p, where));
        rows = sortRows(rows, orderBy).slice(skip);
        return take ? rows.slice(0, take) : rows;
      },
      count: async ({ where } = {}) => tables.product.map(productView).filter((p) => matches(p, where)).length,
    },
    discountCode: {
      findUnique: async ({ where, include }) => discountCodeView(tables.discountCode.find((c) => matches(c, where)), include),
      findFirst: async ({ where, include }) => discountCodeView(tables.discountCode.find((c) => matches(c, where)), include),
      findMany: async ({ where, include } = {}) =>
        tables.discountCode.filter((c) => matches(c, where)).map((c) => discountCodeView(c, include)),
      create: async ({ data, include }) => {
        if (tables.discountCode.some((c) => c.code === data.code)) {
          throw Object.assign(new Error("unique"), { code: "P2002" });
        }
        const row = { id: nextId("dc"), createdAt: new Date(), updatedAt: new Date(), ...data };
        tables.discountCode.push(row);
        return discountCodeView(row, include);
      },
      update: async ({ where, data, include }) => {
        const row = tables.discountCode.find((c) => matches(c, where));
        if (!row) throw new Error("discountCode.update: not found");
        Object.assign(row, data, { updatedAt: new Date() });
        return discountCodeView(row, include);
      },
    },
    discountCodeProduct: {
      findMany: async ({ where }) =>
        tables.discountCodeProduct
          .filter((l) => matches(l, where))
          .map((l) => {
            const p = tables.product.find((x) => x.id === l.productId);
            return { productId: l.productId, product: p ? productView(p) : null };
          }),
      createMany: async ({ data, skipDuplicates }) => {
        let count = 0;
        for (const d of data) {
          const dup = tables.discountCodeProduct.some(
            (l) => l.discountCodeId === d.discountCodeId && l.productId === d.productId
          );
          if (dup) {
            if (skipDuplicates) continue;
            throw Object.assign(new Error("unique"), { code: "P2002" });
          }
          tables.discountCodeProduct.push({ createdAt: new Date(), ...d });
          count += 1;
        }
        return { count };
      },
      deleteMany: async ({ where }) => {
        const before = tables.discountCodeProduct.length;
        tables.discountCodeProduct = tables.discountCodeProduct.filter((l) => !matches(l, where));
        return { count: before - tables.discountCodeProduct.length };
      },
    },
    aiUsageDaily: {},
  };
  proxy.$transaction = async (fn) => (typeof fn === "function" ? fn(proxy) : Promise.all(fn));
  return proxy;
}

let prisma = null;
const dbProxy = new Proxy({}, { get: (_t, k) => prisma[k] });

/* =========================================================
   Date
========================================================= */

const product = (id, vendorId, extra = {}) => ({
  id,
  title: `Produs ${id}`,
  description: "",
  images: [`https://img.test/${id}.jpg`],
  priceCents: 5000,
  currency: "RON",
  category: "decor",
  occasionTags: [],
  availability: "READY",
  readyQty: 5,
  acceptsCustom: false,
  isActive: true,
  isHidden: false,
  moderationStatus: "APPROVED",
  createdAt: new Date(Date.now() - Number(id.replace(/\D/g, "") || 0) * 1000),
  service: {
    vendorId,
    title: `Magazin ${vendorId}`,
    isActive: true,
    status: "ACTIVE",
    type: { code: "products" },
    profile: { displayName: `Magazin ${vendorId}`, slug: vendorId },
  },
  ...extra,
});

function seed() {
  seq = 0;
  tables = {
    vendor: [
      { id: "vendor-a", userId: "user-a", displayName: "Atelier A", isActive: true },
      { id: "vendor-b", userId: "user-b", displayName: "Atelier B", isActive: true },
    ],
    vendorCollection: [{ id: "col-a", vendorId: "vendor-a", title: "Colecția A", slug: "colectia-a", isActive: true }],
    product: [
      product("a1", "vendor-a", { title: "Cană pictată" }),
      product("a2", "vendor-a", { title: "Cană mare" }),
      product("a3", "vendor-a", { title: "Lumânare" }),
      product("a4", "vendor-a", { title: "Cană ascunsă", isHidden: true }),
      product("a5", "vendor-a", { title: "Cană inactivă", isActive: false }),
      product("b1", "vendor-b", { title: "Cană de la B" }),
    ],
    discountCode: [],
    discountCodeProduct: [],
  };
  prisma = makePrisma();
}

/* =========================================================
   Bootstrap: ruta reală, auth simulat
========================================================= */

let server;
let baseUrl;
let currentUserId = "user-a";
const restores = [];

before(async () => {
  seed();
  const reg = (spec, opts) => restores.push(mock.module(spec, opts));
  reg("../db.js", { namedExports: { prisma: dbProxy } });
  reg("../lib/openai.js", { namedExports: { openai: {} } });
  reg("../services/vendorAttributionStats.js", { namedExports: { getDiscountCodeStats: async () => new Map() } });
  reg("./vendorOrdersRoutes.js", { namedExports: { computeVendorEarningForShipment: async () => null } });
  reg("../api/auth.js", {
    namedExports: {
      authRequired: (req, res, next) => {
        req.user = { sub: currentUserId, role: "VENDOR" };
        next();
      },
      requireRole: () => (_q, _s, n) => n(),
      enforceTokenVersion: (_q, _s, n) => n(),
    },
  });

  const router = (await import("./vendorDiscountCodesRoutes.js")).default;
  const app = express();
  app.use(express.json());
  app.use("/api/vendor/discount-codes", router);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/vendor/discount-codes`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  restores.forEach((r) => r.restore());
});

beforeEach(() => {
  seed();
  currentUserId = "user-a";
});

async function call(method, path, body) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const create = (extra = {}) =>
  call("POST", "/", { code: "CANI20", promotionMode: "SELECTED_PRODUCTS", discountPercent: 20, productIds: ["a1", "a2"], ...extra });

const linksOf = (codeId) =>
  tables.discountCodeProduct.filter((l) => l.discountCodeId === codeId).map((l) => l.productId).sort();

/* =========================================================
   Creare
========================================================= */

test("creare SELECTED_PRODUCTS: scope, finanțare 100% vendor, produsele salvate", async () => {
  const res = await create();
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const dc = res.body.discountCode;
  assert.equal(dc.scope, "SELECTED_PRODUCTS");
  assert.equal(dc.promotionMode, "SELECTED_PRODUCTS");
  assert.equal(dc.fundingSource, "VENDOR");
  assert.equal(dc.vendorDiscountPercent, 20);
  assert.equal(dc.artfestDiscountPercent, 0);
  assert.equal(dc.selectedProductsCount, 2);
  assert.deepEqual(linksOf(dc.id), ["a1", "a2"]);

  const row = tables.discountCode[0];
  assert.equal(row.ownerType, "VENDOR");
  assert.equal(row.vendorId, "vendor-a");
  assert.equal(row.platformFundingBps, 0);
  assert.equal(row.vendorFundingBps, 10000);
  assert.equal(row.vendorCollectionId, null);
});

test("creare: plafon 50% (ca «Doar produsele mele»), nu 5%", async () => {
  assert.equal((await create({ code: "CANI50", discountPercent: 50 })).status, 201);
  const over = await create({ code: "CANI51", discountPercent: 51 });
  assert.equal(over.status, 400);
});

test("creare: un produs al ALTUI magazin -> respins, nimic salvat", async () => {
  const res = await create({ productIds: ["a1", "b1"] });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "products_not_owned");
  assert.equal(res.body.rejectedCount, 1);
  assert.equal(tables.discountCode.length, 0);
  assert.equal(tables.discountCodeProduct.length, 0);
});

test("creare: produs inexistent (șters) -> respins", async () => {
  const res = await create({ productIds: ["a1", "nu-exista"] });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "products_not_owned");
  assert.equal(tables.discountCode.length, 0);
});

test("creare: listă goală / lipsă -> respins", async () => {
  assert.equal((await create({ productIds: [] })).body.error, "products_required");
  assert.equal((await create({ productIds: undefined })).body.error, "products_required");
  assert.equal(tables.discountCode.length, 0);
});

test("creare: peste 300 de produse -> respins (limita per cod)", async () => {
  const many = Array.from({ length: 301 }, (_, i) => `x${i}`);
  const res = await create({ productIds: many });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "too_many_products");
  assert.equal(res.body.maxProducts, 300);
});

test("creare: exact 300 de produse proprii -> acceptat; duplicatele se elimină", async () => {
  for (let i = 0; i < 300; i += 1) tables.product.push(product(`m${i}`, "vendor-a"));
  const ids = Array.from({ length: 300 }, (_, i) => `m${i}`);
  const res = await create({ productIds: [...ids, "m0", "m1"] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(linksOf(res.body.discountCode.id).length, 300);
});

test("creare: produse proprii inactive/ascunse se pot păstra pe cod (apartenența e ce contează)", async () => {
  const res = await create({ productIds: ["a4", "a5"] });
  assert.equal(res.status, 201);
});

test("creare: SELECTED_PRODUCTS + colecție -> respins", async () => {
  const res = await create({ vendorCollectionId: "col-a" });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "collection_not_allowed");
});

test("productIds trimise pentru alte moduri -> respinse (modurile existente neschimbate)", async () => {
  const own = await call("POST", "/", { code: "TOT10", promotionMode: "OWN_PRODUCTS", discountPercent: 10, productIds: ["a1"] });
  assert.equal(own.status, 400);
  assert.equal(own.body.error, "products_not_allowed");
  const all = await call("POST", "/", { code: "ART5", promotionMode: "ALL_ARTFEST", discountPercent: 5, productIds: ["a1"] });
  assert.equal(all.status, 400);
  assert.equal(tables.discountCode.length, 0);
});

/* =========================================================
   Modurile existente - comportament identic
========================================================= */

test("REG «Doar produsele mele»: VENDOR_ALL_PRODUCTS, vendor 0-50%", async () => {
  const res = await call("POST", "/", { code: "TOT10", promotionMode: "OWN_PRODUCTS", discountPercent: 10 });
  assert.equal(res.status, 201);
  assert.equal(res.body.discountCode.scope, "VENDOR_ALL_PRODUCTS");
  assert.equal(res.body.discountCode.promotionMode, "OWN_PRODUCTS");
  assert.equal(res.body.discountCode.fundingSource, "VENDOR");
  assert.equal(res.body.discountCode.selectedProductsCount, 0);
});

test("REG «Toate produsele Artfest»: ALL_PRODUCTS, Artfest maximum 5%", async () => {
  const ok = await call("POST", "/", { code: "ART5", promotionMode: "ALL_ARTFEST", discountPercent: 5 });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.discountCode.scope, "ALL_PRODUCTS");
  assert.equal(ok.body.discountCode.promotionMode, "ALL_ARTFEST");
  assert.equal(ok.body.discountCode.fundingSource, "PLATFORM");
  const over = await call("POST", "/", { code: "ART6", promotionMode: "ALL_ARTFEST", discountPercent: 6 });
  assert.equal(over.status, 400);
});

test("REG colecție proprie: VENDOR_COLLECTION, vendor 0-50%", async () => {
  const res = await call("POST", "/", { code: "COL20", promotionMode: "ALL_ARTFEST", discountPercent: 20, vendorCollectionId: "col-a" });
  assert.equal(res.status, 201);
  assert.equal(res.body.discountCode.scope, "VENDOR_COLLECTION");
  assert.equal(res.body.discountCode.promotionMode, "ALL_ARTFEST");
  assert.equal(res.body.discountCode.fundingSource, "VENDOR");
});

test("REG editare cod ALL_PRODUCTS existent: plafonul 5% Artfest rămâne", async () => {
  const created = await call("POST", "/", { code: "ART5", promotionMode: "ALL_ARTFEST", discountPercent: 5 });
  const id = created.body.discountCode.id;
  assert.equal((await call("PATCH", `/${id}`, { discountPercent: 6 })).status, 400);
  assert.equal((await call("PATCH", `/${id}`, { discountPercent: 3 })).body.discountCode.fundingSource, "PLATFORM");
});

/* =========================================================
   Editare SELECTED_PRODUCTS
========================================================= */

test("editare: procentul rămâne finanțat de vendor (nu devine Artfest 5%)", async () => {
  const id = (await create()).body.discountCode.id;
  const res = await call("PATCH", `/${id}`, { discountPercent: 30 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.discountCode.fundingSource, "VENDOR");
  assert.equal(res.body.discountCode.vendorDiscountPercent, 30);
  assert.equal(tables.discountCode[0].platformFundingBps, 0);
  assert.equal(tables.discountCode[0].scope, "SELECTED_PRODUCTS");
});

test("editare: lista de produse se înlocuiește (scoase + adăugate), restul codului neschimbat", async () => {
  const id = (await create()).body.discountCode.id;
  const res = await call("PATCH", `/${id}`, { productIds: ["a2", "a3"] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(linksOf(id), ["a2", "a3"]);
  assert.equal(res.body.discountCode.selectedProductsCount, 2);
  assert.equal(tables.discountCode[0].discountPercent, 20);
});

test("editare: produs al altui magazin -> respins, lista veche rămâne intactă", async () => {
  const id = (await create()).body.discountCode.id;
  const res = await call("PATCH", `/${id}`, { productIds: ["a3", "b1"] });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "products_not_owned");
  assert.deepEqual(linksOf(id), ["a1", "a2"]);
});

test("editare: lista goală -> respinsă (un cod fără produse nu s-ar aplica nicăieri)", async () => {
  const id = (await create()).body.discountCode.id;
  const res = await call("PATCH", `/${id}`, { productIds: [] });
  assert.equal(res.status, 400);
  assert.deepEqual(linksOf(id), ["a1", "a2"]);
});

test("editare: colecție pe un cod SELECTED_PRODUCTS -> respinsă; scope neschimbat", async () => {
  const id = (await create()).body.discountCode.id;
  const res = await call("PATCH", `/${id}`, { vendorCollectionId: "col-a" });
  assert.equal(res.status, 400);
  assert.equal(tables.discountCode[0].scope, "SELECTED_PRODUCTS");
});

test("editare: productIds pe un cod «Doar produsele mele» -> respinse", async () => {
  const own = await call("POST", "/", { code: "TOT10", promotionMode: "OWN_PRODUCTS", discountPercent: 10 });
  const res = await call("PATCH", `/${own.body.discountCode.id}`, { productIds: ["a1"] });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "products_not_allowed");
});

test("alt vendor nu poate edita / vedea codul", async () => {
  const id = (await create()).body.discountCode.id;
  currentUserId = "user-b";
  assert.equal((await call("PATCH", `/${id}`, { productIds: ["b1"] })).status, 404);
  assert.equal((await call("GET", `/${id}`)).status, 404);
  assert.deepEqual(linksOf(id), ["a1", "a2"]);
});

/* =========================================================
   Detaliu: starea produselor (inactive / mutate / șterse)
========================================================= */

test("GET /:id: produsele cu stare - disponibil, indisponibil, mutat la alt magazin, șters", async () => {
  const id = (await create({ productIds: ["a1", "a5", "a3"] })).body.discountCode.id;

  // a3 „mutat” la alt vendor după creare; un produs șters dispare din listă
  tables.product.find((p) => p.id === "a3").service.vendorId = "vendor-b";
  tables.discountCodeProduct.push({ discountCodeId: id, productId: "sters", createdAt: new Date() });

  const res = await call("GET", `/${id}`);
  assert.equal(res.status, 200);
  const byId = Object.fromEntries(res.body.discountCode.selectedProducts.map((p) => [p.id, p.status]));
  assert.deepEqual(byId, { a1: "available", a5: "unavailable", a3: "other_store" });
  assert.equal(res.body.maxSelectedProducts, 300);
});

test("listă: fiecare cod are tipul corect (promotionMode) și numărul de produse", async () => {
  await create();
  await call("POST", "/", { code: "TOT10", promotionMode: "OWN_PRODUCTS", discountPercent: 10 });
  const res = await call("GET", "/");
  const modes = Object.fromEntries(res.body.discountCodes.map((c) => [c.code, [c.promotionMode, c.selectedProductsCount]]));
  assert.deepEqual(modes, { CANI20: ["SELECTED_PRODUCTS", 2], TOT10: ["OWN_PRODUCTS", 0] });
});

/* =========================================================
   Căutare + „Toate rezultatele filtrate”
========================================================= */

test("product-search: DOAR produsele publice ale vendorului (fără B, fără ascunse/inactive)", async () => {
  const res = await call("GET", "/product-search?q=can%C4%83");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.products.map((p) => p.id).sort(), ["a1", "a2"]);
  assert.equal(res.body.total, 2);
  assert.ok(res.body.products.every((p) => p.isOwn === true));
  assert.equal(res.body.maxProducts, 300);
});

test("product-search: paginare (hasMore) și filtre de preț", async () => {
  const page1 = await call("GET", "/product-search?limit=2&page=1");
  assert.equal(page1.body.products.length, 2);
  assert.equal(page1.body.hasMore, true);
  tables.product.find((p) => p.id === "a3").priceCents = 20000;
  const cheap = await call("GET", "/product-search?maxPrice=100");
  assert.deepEqual(cheap.body.products.map((p) => p.id).sort(), ["a1", "a2"]);
});

test("product-search: parametrul scope=marketplace e ignorat - tot doar produsele proprii", async () => {
  const res = await call("GET", "/product-search?scope=marketplace");
  assert.ok(res.body.products.length > 0);
  assert.ok(res.body.products.every((p) => p.id.startsWith("a")));
});

test("product-ids: toate rezultatele filtrate, plafonate la 300 (truncated)", async () => {
  const res = await call("POST", "/product-ids", { q: "cană" });
  assert.deepEqual(res.body.products.map((p) => p.id).sort(), ["a1", "a2"]);
  assert.equal(res.body.truncated, false);

  for (let i = 0; i < 320; i += 1) tables.product.push(product(`m${i}`, "vendor-a"));
  const big = await call("POST", "/product-ids", {});
  assert.equal(big.body.products.length, 300);
  assert.equal(big.body.truncated, true);
  assert.ok(big.body.total > 300);
  assert.ok(big.body.products.every((p) => !p.id.startsWith("b")));
});
