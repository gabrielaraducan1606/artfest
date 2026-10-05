// src/routes/vendorCollectionPhase2.e2e.test.js
//
// FAZA 2 consolidare Colecții (VendorCollection preia pricing-ul VendorCampaign):
//  - allOwnProducts (inclusiv produse publicate ulterior), SELECTED migrat;
//  - reducerea colecției DOAR pe produse proprii, finanțată de vendor (Artfest = 0);
//  - cross-vendor: referral da, reducerea colecției nu;
//  - startsAt / endsAt; influencer + own-sale coexistă;
//  - COD == CARD; refund pe valorile originale;
//  - campaignSlugs vechi -> colecția migrată; campanii nemigrate neschimbate.
// Pricing-ul REAL (productPromotionPrice.js), rutele REALE de checkout.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/vendorCollectionPhase2.e2e.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy";

import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

/* =========================================================
   Fake DB generic (in-memory)
========================================================= */

let seq = 0;
const nextId = (p) => `${p}_${++seq}`;

function matchCond(value, cond) {
  if (cond === undefined) return true;
  if (cond === null) return value === null || value === undefined;
  if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
  if (typeof cond !== "object" || Array.isArray(cond)) return value === cond;
  if ("some" in cond || "every" in cond || "none" in cond || "is" in cond || "path" in cond) return true;
  for (const [op, v] of Object.entries(cond)) {
    if (op === "in" && !v.includes(value)) return false;
    if (op === "notIn" && v.includes(value)) return false;
    if (op === "not" && (v === null ? value === null || value === undefined : value === v)) return false;
    if (op === "equals" && value !== v) return false;
    if (op === "gte" && !(value >= v)) return false;
    if (op === "gt" && !(value > v)) return false;
    if (op === "lte" && !(value <= v)) return false;
    if (op === "lt" && !(value < v)) return false;
  }
  return true;
}

function matchesWhere(row, where = {}) {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === "AND") {
      if (!(Array.isArray(cond) ? cond : [cond]).every((w) => matchesWhere(row, w))) return false;
      continue;
    }
    if (key === "OR") {
      if (!cond.some((w) => matchesWhere(row, w))) return false;
      continue;
    }
    if (key === "NOT") {
      if ((Array.isArray(cond) ? cond : [cond]).some((w) => matchesWhere(row, w))) return false;
      continue;
    }
    const value = row?.[key];
    // filtru JSON Prisma: { path: [...], equals } (ex. idempotența REFUND pe meta.refShipmentId)
    if (cond && typeof cond === "object" && Array.isArray(cond.path) && "equals" in cond) {
      if (cond.path.reduce((o, k) => o?.[k], value) !== cond.equals) return false;
      continue;
    }
    if (value && typeof value === "object" && !(value instanceof Date) && cond && typeof cond === "object" && !Array.isArray(cond)) {
      if (!matchesWhere(value, cond)) return false;
      continue;
    }
    if (!matchCond(value, cond)) return false;
  }
  return true;
}

const RELATIONS = {
  shipment: {
    items: (row, t) => (t.shipmentItem || []).filter((i) => i.shipmentId === row.id),
    order: (row, t) => (t.order || []).find((o) => o.id === row.orderId) || null,
    vendor: (row, t) => (t.vendor || []).find((v) => v.id === row.vendorId) || null,
    vendorEarningEntry: (row, t) => (t.vendorEarningEntry || []).find((e) => e.shipmentId === row.id) || null,
    vendorReferralEarningEntry: (row, t) => (t.vendorReferralEarningEntry || []).find((e) => e.shipmentId === row.id) || null,
  },
  vendorCollectionItem: {
    product: (row, t) => (t.product || []).find((p) => p.id === row.productId) || null,
  },
  shipmentItem: {
    shipment: (row, t) => (t.shipment || []).find((s) => s.id === row.shipmentId) || null,
  },
  order: {
    // computeOrderSplits: include { shipments: { include: { items: true } } }
    shipments: (row, t) =>
      (t.shipment || [])
        .filter((s) => s.orderId === row.id)
        .map((s) => ({ ...s, items: (t.shipmentItem || []).filter((i) => i.shipmentId === s.id) })),
  },
};
let currentTables = null;

function withIncludes(name, row, include) {
  if (!row || !include || !RELATIONS[name]) return row;
  const out = { ...row };
  for (const [k, on] of Object.entries(include)) if (on && RELATIONS[name][k]) out[k] = RELATIONS[name][k](row, currentTables);
  return out;
}

function stripRelations(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v) && ("create" in v || "connect" in v || "createMany" in v)) continue;
    out[k] = v;
  }
  return out;
}

function applyData(row, data) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "increment" in v) row[k] = Number(row[k] || 0) + v.increment;
    else if (v && typeof v === "object" && "decrement" in v) row[k] = Number(row[k] || 0) - v.decrement;
    else row[k] = v;
  }
}

function makeModel(name, rows) {
  // filtre pe relații (ex. { vendorEarningEntry: null }, { shipment: { referrerVendorId } }) - ca Prisma
  const withRelationsForWhere = (r, where) => {
    if (!where || !RELATIONS[name]) return r;
    const o = { ...r };
    for (const k of Object.keys(where)) if (RELATIONS[name][k]) o[k] = RELATIONS[name][k](r, currentTables);
    return o;
  };
  const matches = (r, where) => matchesWhere(withRelationsForWhere(r, where), where);
  const find = (where) => rows.find((r) => matches(r, where));
  return {
    findMany: async ({ where, take, skip, orderBy, include, select } = {}) => {
      let out = rows.filter((r) => matches(r, where));
      if (orderBy && !Array.isArray(orderBy)) {
        const [[k, dir]] = Object.entries(orderBy);
        if (typeof dir === "string") out = [...out].sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (dir === "desc" ? -1 : 1));
      }
      if (skip) out = out.slice(skip);
      if (take) out = out.slice(0, take);
      return out.map((r) => withIncludes(name, { ...r }, include || select));
    },
    findFirst: async ({ where, include, select } = {}) => {
      const r = find(where);
      return r ? withIncludes(name, { ...r }, include || select) : null;
    },
    findUnique: async ({ where, include, select } = {}) => {
      const r = find(where);
      return r ? withIncludes(name, { ...r }, include || select) : null;
    },
    count: async ({ where } = {}) => rows.filter((r) => matchesWhere(r, where)).length,
    create: async ({ data }) => {
      const row = { id: data.id || nextId(name), createdAt: new Date(), updatedAt: new Date(), ...stripRelations(data) };
      // default-ul Prisma Shipment.direction = OUTBOUND
      if (name === "shipment" && row.direction === undefined) row.direction = "OUTBOUND";
      rows.push(row);
      return { ...row };
    },
    createMany: async ({ data }) => {
      for (const d of data) rows.push({ id: d.id || nextId(name), createdAt: new Date(), ...stripRelations(d) });
      return { count: data.length };
    },
    update: async ({ where, data }) => {
      const r = find(where);
      if (!r) throw new Error(`${name}.update: not found`);
      applyData(r, data);
      return { ...r };
    },
    updateMany: async ({ where, data }) => {
      const hit = rows.filter((r) => matchesWhere(r, where));
      hit.forEach((r) => applyData(r, data));
      return { count: hit.length };
    },
    deleteMany: async ({ where } = {}) => {
      const keep = rows.filter((r) => !matchesWhere(r, where));
      const count = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return { count };
    },
    upsert: async ({ where, create, update }) => {
      const r = find(where);
      if (r) {
        applyData(r, update || {});
        return { ...r };
      }
      const row = { id: create.id || nextId(name), createdAt: new Date(), ...stripRelations(create) };
      rows.push(row);
      return { ...row };
    },
    aggregate: async ({ where, _sum } = {}) => {
      const hit = rows.filter((r) => matches(r, where));
      const sums = {};
      for (const k of Object.keys(_sum || {})) sums[k] = hit.length ? hit.reduce((t, r) => t + Number(r[k] || 0), 0) : null;
      return { _sum: sums, _count: { _all: hit.length } };
    },
    groupBy: async () => [],
  };
}

let db;

function makeDb() {
  const tables = {};
  const models = {};
  const proxy = new Proxy(
    {},
    {
      get(_t, key) {
        if (key === "$transaction") return async (fn) => (typeof fn === "function" ? fn(proxy) : Promise.all(fn));
        if (key === "$queryRaw" || key === "$executeRaw") return async () => [];
        if (key === "__tables") return tables;
        if (typeof key !== "string" || key.startsWith("$") || key === "then") return undefined;
        if (!models[key]) {
          tables[key] = tables[key] || [];
          models[key] = makeModel(key, tables[key]);
        }
        return models[key];
      },
    }
  );
  currentTables = tables;
  return proxy;
}

const dbProxy = new Proxy({}, { get: (_t, k) => db[k] });

/* =========================================================
   Bootstrap
========================================================= */

let server;
let baseUrl;
let currentUser = null;
let paymentCalls;
const restores = [];

before(async () => {
  const reg = (spec, opts) => restores.push(mock.module(spec, opts));

  reg("../db.js", { namedExports: { prisma: dbProxy } });
  reg("@prisma/client", {
    namedExports: {
      PrismaClient: class {
        constructor() {
          return dbProxy;
        }
      },
      Prisma: {},
    },
  });
  reg("../api/auth.js", {
    namedExports: {
      authRequired: (req, res, next) => {
        if (!currentUser) return res.status(401).json({ error: "unauth" });
        req.user = { sub: currentUser.id, id: currentUser.id, role: "USER" };
        next();
      },
      requireRole: () => (_q, _s, n) => n(),
      enforceTokenVersion: (_q, _s, n) => n(),
    },
  });

  const actualMailer = await import("../lib/mailer.js");
  reg("../lib/mailer.js", {
    namedExports: { ...actualMailer, sendOrderConfirmationEmail: async () => {}, sendVendorNewOrderEmail: async () => {} },
  });
  const actualNotifications = await import("../services/notifications.js");
  reg("../services/notifications.js", {
    namedExports: {
      ...actualNotifications,
      createVendorNotification: async () => {},
      notifyVendorOnProductSoldOut: async () => {},
      notifyInfluencerPayoutProfileIncomplete: async () => {},
    },
  });
  const actualOrchestrator = await import("../payments/orchestrator.js");
  reg("../payments/orchestrator.js", {
    namedExports: {
      ...actualOrchestrator,
      createPaymentForOrder: async (order) => {
        paymentCalls.push(order.id);
        return { provider: "stripe", redirectUrl: "https://checkout.stripe.test/x" };
      },
    },
  });
  // productPromotionPrice NU e mock-uit: pricing-ul real (collection/homepage = tabele goale)

  const checkoutRouter = (await import("./chekoutRoutes.js")).default;

  const app = express();
  app.use(express.json());
  app.use("/api", checkoutRouter);

  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  restores.forEach((r) => r.restore());
});

/* =========================================================
   Seed - plan 15%, referral cross-vendor 20%, influencer 50%
   A (owner colecții), B (alt vendor)
   Colecții A:
     toata-a     allOwnProducts, 10%           (live)
     selectie-a  items [a1], 10%               (SELECTED migrat)
     cross-a     items [b1] (B), 10%           (doar cross-vendor)
     viitoare-a  allOwnProducts, 10%, startsAt mâine
     expirata-a  allOwnProducts, 10%, endsAt ieri
     toamna-a    allOwnProducts, 15%, legacyCampaignId camp-legacy
   VendorCampaign:
     camp-legacy (A, slug toamna-a, ALL 15%) - MIGRATĂ
     camp-b      (B, slug toamna-b, ALL 20%) - nemigrată (legacy activ)
========================================================= */

const REF = "teo-31b637";
const inAYear = () => new Date(Date.now() + 365 * 86400000);
const tomorrow = () => new Date(Date.now() + 86400000);
const yesterday = () => new Date(Date.now() - 86400000);

function seed() {
  db = makeDb();
  currentUser = null;
  paymentCalls = [];
  const t = db.__tables;

  t.influencerProfile = [
    { id: "inf-1", referralCode: REF, status: "ACTIVE", commissionBps: 5000, createdAt: new Date(), collaborationEndOverride: inAYear(), displayName: "Teo", userId: "user-inf-1" },
  ];

  const stripeReady = {
    stripeAccountId: "acct_x",
    stripeChargesEnabled: true,
    stripePayoutsEnabled: true,
    stripeDetailsSubmitted: true,
    stripeConnectStatus: "enabled",
  };

  t.vendor = [
    { id: "vendor-a", userId: "user-vendor-a", referralCode: null, referralCommissionBps: 0, displayName: "Atelier A", isActive: true, email: "a@t.ro", user: { email: "a@t.ro" }, ...stripeReady },
    { id: "vendor-b", userId: "user-vendor-b", referralCode: "atelier-b", referralCommissionBps: 0, displayName: "Atelier B", isActive: true, email: "b@t.ro", user: { email: "b@t.ro" }, ...stripeReady },
  ];

  const product = (id, vendorId, priceCents, extra = {}) => ({
    id,
    title: `Produs ${id}`,
    images: [],
    priceCents,
    category: "decor",
    currency: "RON",
    acceptsCustom: false,
    styleTags: [],
    occasionTags: [],
    availability: "READY",
    readyQty: 50,
    isActive: true,
    isHidden: false,
    moderationStatus: "APPROVED",
    serviceId: `svc-${vendorId}`,
    createdAt: new Date(Date.now() - 30 * 86400000),
    service: {
      id: `svc-${vendorId}`,
      title: `Magazin ${vendorId}`,
      vendorId,
      isActive: true,
      estimatedShippingFeeCents: 1500,
      freeShippingThresholdCents: null,
      shippingNotes: null,
      vendor: { billing: null },
    },
    ...extra,
  });

  t.product = [
    product("a1", "vendor-a", 10000),
    product("a2", "vendor-a", 5000),
    product("a3", "vendor-a", 8000),
    product("b1", "vendor-b", 8000),
    product("b2", "vendor-b", 6000),
  ];
  t.user = [
    { id: "user-1", email: "client@t.ro", name: "Client" },
    { id: "user-vendor-a", email: "owner-a@t.ro", name: "Owner A" },
    { id: "user-inf-1", email: "teo@t.ro", name: "Teo" },
  ];

  const collection = (id, slug, extra = {}) => ({
    id,
    vendorId: "vendor-a",
    slug,
    title: `Colecția ${slug}`,
    isActive: true,
    discountPercent: 10,
    startsAt: null,
    endsAt: null,
    allOwnProducts: false,
    legacyCampaignId: null,
    ...extra,
  });

  t.vendorCollection = [
    collection("vcol-toata", "toata-a", { allOwnProducts: true }),
    collection("vcol-sel", "selectie-a", { legacyCampaignId: "camp-sel" }),
    collection("vcol-cross", "cross-a"),
    collection("vcol-future", "viitoare-a", { allOwnProducts: true, startsAt: tomorrow() }),
    collection("vcol-expired", "expirata-a", { allOwnProducts: true, endsAt: yesterday() }),
    collection("vcol-legacy", "toamna-a", { allOwnProducts: true, discountPercent: 15, legacyCampaignId: "camp-legacy" }),
  ];
  t.vendorCollectionItem = [
    { collectionId: "vcol-sel", productId: "a1", position: 0 },
    { collectionId: "vcol-cross", productId: "b1", position: 0 },
  ];

  const campaign = (id, vendorId, slug, discountPercent) => ({
    id, vendorId, slug, isActive: true, scope: "ALL_PRODUCTS", discountPercent,
    platformFundingBps: 0, vendorFundingBps: 10000, fundingSource: "VENDOR",
    startsAt: null, endsAt: null, vendor: { isActive: true }, products: [],
  });
  t.vendorCampaign = [campaign("camp-legacy", "vendor-a", "toamna-a", 15), campaign("camp-b", "vendor-b", "toamna-b", 20)];

  t.vendorSubscription = ["vendor-a", "vendor-b"].map((vendorId) => ({
    id: `sub-${vendorId}`,
    vendorId,
    status: "active",
    startAt: new Date(),
    endAt: inAYear(),
    trialEndsAt: null,
    plan: { code: "pro", name: "Pro", commissionBps: 1500 },
  }));
}

const ADDRESS = {
  firstName: "Ana",
  lastName: "Pop",
  phone: "0722000000",
  email: "ana@t.ro",
  county: "Cluj",
  city: "Cluj-Napoca",
  postalCode: "400000",
  street: "Str. Test 1",
};

const SELECTIONS = { "svc-vendor-a": { method: "COURIER" }, "svc-vendor-b": { method: "COURIER" } };

const vcol = (...slugs) => slugs.map((slug, i) => ({ slug, at: Date.now() - i * 1000 }));
const ref = (code, at = Date.now()) => [{ code, at }];

function body({ paymentMethod, vendorCollectionSlugs, campaignSlugs, referralCodes }) {
  return {
    address: ADDRESS,
    customerType: "PF",
    paymentMethod,
    selections: SELECTIONS,
    consents: { terms: true, returns: true },
    ...(vendorCollectionSlugs ? { vendorCollectionSlugs } : {}),
    ...(campaignSlugs ? { campaignSlugs } : {}),
    ...(referralCodes ? { referralCodes } : {}),
  };
}

async function placeGuest({ items, paymentMethod = "COD", ...rest }) {
  const res = await fetch(`${baseUrl}/api/checkout/guest/place`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items, ...body({ paymentMethod, ...rest }) }),
  });
  return { status: res.status, body: await res.json() };
}

const items = (...ids) => ids.map((productId) => ({ productId, qty: 1 }));
const shipments = () => (db.__tables.shipment || []).filter((s) => s.direction !== "RETURN");
const byVendor = (vendorId) => shipments().find((s) => s.vendorId === vendorId);
const itemsOf = (s) => (db.__tables.shipmentItem || []).filter((i) => i.shipmentId === s.id);
const item = (s, productId) => itemsOf(s).find((i) => i.productId === productId);
const snap = (s) => Object.fromEntries(itemsOf(s).map((i) => [i.productId, i.vendorCollectionSlugSnapshot ?? null]));
const prices = (s) => Object.fromEntries(itemsOf(s).map((i) => [i.productId, Number(i.price)]));
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
const saleOf = (s) => (db.__tables.vendorEarningEntry || []).filter((e) => e.shipmentId === s.id && e.type === "SALE");
const referralOf = (s) => (db.__tables.vendorReferralEarningEntry || []).filter((e) => e.shipmentId === s.id && e.type === "SALE");
const influencerOf = (s) => (db.__tables.influencerEarningEntry || []).filter((e) => e.shipmentId === s.id && e.type === "SALE");

async function deliverAndBook(times = 2) {
  const vendorOrders = await import("./vendorOrdersRoutes.js");
  for (const s of shipments()) {
    s.status = "DELIVERED";
    for (let i = 0; i < times; i++) {
      await vendorOrders.ensureSaleLedgerEntry({ vendorId: s.vendorId, shipmentId: s.id });
      await vendorOrders.ensureInfluencerSaleLedgerEntry({ shipmentId: s.id });
      await vendorOrders.ensureVendorReferralSaleLedgerEntry({ shipmentId: s.id });
    }
  }
}

async function bookCardPayment(orderId) {
  const { computeOrderSplits, allocateStripeFee, computeVendorPayouts } = await import("../payments/marketplaceCalc.js");
  const card = await import("../services/cardSaleLedger.js");
  const vendorOrders = await import("./vendorOrdersRoutes.js");

  const splits = await computeOrderSplits(orderId);
  const payouts = computeVendorPayouts({ vendors: allocateStripeFee({ vendors: splits.vendors, feeNet: 0 }) });

  for (const payout of payouts) {
    const allocation = await card.planCardSaleEntries({
      db, orderId, vendorId: payout.vendorId, payout, computeEarning: vendorOrders.computeVendorEarningForShipment,
    });
    await card.upsertCardSaleEntries({
      db, orderId, vendorId: payout.vendorId, allocation, transferId: `tr_${payout.vendorId}`, currency: "RON",
      buildMeta: (row) => card.buildCardSaleEntryMeta({ payout, row, orderId, paymentIntentId: "pi_1", chargeId: "ch_1", feeTotal: 0 }),
    });
  }
  return splits;
}

async function refundShipment(s) {
  const vendorOrders = await import("./vendorOrdersRoutes.js");
  s.status = "RETURNED";
  for (let i = 0; i < 2; i++) {
    await vendorOrders.ensureRefundLedgerEntry({ vendorId: s.vendorId, shipmentId: s.id });
    await vendorOrders.ensureInfluencerRefundLedgerEntry({ shipmentId: s.id });
    await vendorOrders.ensureVendorReferralRefundLedgerEntry({ shipmentId: s.id });
  }
}

const refunds = (table) => (db.__tables[table] || []).filter((e) => e.type === "REFUND");

beforeEach(seed);

/* =========================================================
   1. allOwnProducts
========================================================= */

test("allOwnProducts: produs existent + produs publicat ULTERIOR -> ambele membre: reducere 10% (vendor), own-sale 5%", async () => {
  // produs nou, publicat după crearea colecției - fără VendorCollectionItem
  db.__tables.product.push({ ...db.__tables.product.find((p) => p.id === "a3"), id: "a4-nou", title: "Produs nou", priceCents: 4000, createdAt: new Date() });

  const res = await placeGuest({ items: items("a1", "a4-nou"), vendorCollectionSlugs: vcol("toata-a") });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const s = byVendor("vendor-a");
  assert.equal(s.vendorReferralCommissionOverrideBps, 500);
  assert.equal(s.referrerVendorReferralCodeSnapshot, "COLLECTION:toata-a");
  assert.deepEqual(snap(s), { a1: "toata-a", "a4-nou": "toata-a" });
  assert.deepEqual(prices(s), { a1: 90, "a4-nou": 36 });

  await deliverAndBook();
  assert.ok(near(saleOf(s)[0].commissionNet, 90 * 0.05 + 36 * 0.05), `${saleOf(s)[0].commissionNet}`);
});

/* =========================================================
   2. SELECTED_PRODUCTS migrat
========================================================= */

test("SELECTED_PRODUCTS (migrat): doar a1 selectat -> reducere + 5%; a2 preț întreg, plan 15%", async () => {
  await placeGuest({ items: items("a1", "a2"), vendorCollectionSlugs: vcol("selectie-a") });
  const s = byVendor("vendor-a");

  assert.deepEqual(snap(s), { a1: "selectie-a", a2: null });
  assert.deepEqual(prices(s), { a1: 90, a2: 50 });

  await deliverAndBook();
  assert.ok(near(saleOf(s)[0].commissionNet, 90 * 0.05 + 50 * 0.15));
});

/* =========================================================
   3. cross-vendor
========================================================= */

test("cross-vendor: b1 în colecția lui A -> referral către A DA, reducerea colecției NU; b2 normal", async () => {
  await placeGuest({ items: items("b1", "b2"), vendorCollectionSlugs: vcol("cross-a") });
  const s = byVendor("vendor-b");

  assert.equal(s.referrerVendorId, "vendor-a");
  assert.equal(s.vendorReferralCommissionOverrideBps ?? null, null, "B nu primește 5%");
  assert.deepEqual(prices(s), { b1: 80, b2: 60 }, "ownerul nu finanțează reducerea altui seller");
  assert.deepEqual(snap(s), { b1: "cross-a", b2: null });

  await deliverAndBook();
  assert.ok(near(saleOf(s)[0].commissionNet, 21));
  assert.ok(near(referralOf(s)[0].earningNet, 80 * 0.15 * 0.2));
});

/* =========================================================
   4. discountPercent: vendor-funded, Artfest = 0
========================================================= */

test("discountPercent: reducerea e integral a vendorului (platform 0), doar pe produse proprii", async () => {
  await placeGuest({ items: items("a1", "a3"), vendorCollectionSlugs: vcol("toata-a") });
  const s = byVendor("vendor-a");

  for (const id of ["a1", "a3"]) {
    const it = item(s, id);
    assert.equal(Number(it.platformDiscountPercent), 0, `${id}: Artfest nu finanțează`);
    assert.equal(Number(it.platformDiscountAmount), 0, id);
    assert.equal(Number(it.vendorDiscountPercent), 10, id);
  }
  assert.ok(near(item(s, "a1").vendorDiscountAmount, 10));
  assert.ok(near(item(s, "a3").vendorDiscountAmount, 8));

  await deliverAndBook();
  const sale = saleOf(s)[0];
  assert.ok(near(sale.meta.platformSubsidyAmount, 0), "fără subvenție Artfest");
  assert.ok(near(sale.commissionNet, 90 * 0.05 + 72 * 0.05));
});

/* =========================================================
   5. startsAt / endsAt
========================================================= */

test("interval: viitoare / expirată -> fără reducere și fără own-sale; activă -> da", async () => {
  for (const slug of ["viitoare-a", "expirata-a"]) {
    seed();
    const res = await placeGuest({ items: items("a1"), vendorCollectionSlugs: vcol(slug) });
    assert.equal(res.status, 200, slug);
    const s = byVendor("vendor-a");
    assert.deepEqual(prices(s), { a1: 100 }, slug);
    assert.equal(s.vendorReferralCommissionOverrideBps ?? null, null, slug);
    assert.deepEqual(snap(s), { a1: null }, slug);
  }

  seed();
  await placeGuest({ items: items("a1"), vendorCollectionSlugs: vcol("toata-a") });
  assert.deepEqual(prices(byVendor("vendor-a")), { a1: 90 });
});

test("interval: colecție cross-vendor expirată -> fără referral nou", async () => {
  db.__tables.vendorCollection.find((c) => c.slug === "cross-a").endsAt = yesterday();
  await placeGuest({ items: items("b1"), vendorCollectionSlugs: vcol("cross-a") });
  assert.equal(byVendor("vendor-b").referrerVendorId ?? null, null);
});

/* =========================================================
   6. influencer + own-sale (coexistă)
========================================================= */

test("influencer + colecția proprie: own-sale 5% RĂMÂNE, influencerul primește earning-ul lui", async () => {
  await placeGuest({ items: items("a1"), vendorCollectionSlugs: vcol("toata-a"), referralCodes: ref(REF) });
  const s = byVendor("vendor-a");

  assert.equal(s.influencerId, "inf-1");
  assert.equal(s.vendorReferralCommissionOverrideBps, 500, "influencerul nu anulează own-sale");
  assert.deepEqual(snap(s), { a1: "toata-a" });
  assert.deepEqual(prices(s), { a1: 90 });

  await deliverAndBook(3);
  const sale = saleOf(s)[0];
  assert.ok(near(sale.commissionNet, 4.5));
  const inf = influencerOf(s);
  assert.equal(inf.length, 1);
  assert.ok(near(inf[0].earningNet, 4.5 * 0.5), "earning influencer = platformNet × 50% (regula existentă)");
});

/* =========================================================
   7. COD == CARD
========================================================= */

test("COD vs CARD identic: A (toata-a, own) + B (b1 în cross-a, referral)", async () => {
  const scenario = { items: items("a1", "a3", "b1", "b2"), vendorCollectionSlugs: vcol("cross-a", "toata-a") };

  await placeGuest({ ...scenario, paymentMethod: "COD" });
  await deliverAndBook();
  const cod = {
    a: Number(saleOf(byVendor("vendor-a"))[0].commissionNet),
    b: Number(saleOf(byVendor("vendor-b"))[0].commissionNet),
    ref: Number(referralOf(byVendor("vendor-b"))[0].earningNet),
    pricesA: prices(byVendor("vendor-a")),
    pricesB: prices(byVendor("vendor-b")),
  };

  seed();
  const res = await placeGuest({ ...scenario, paymentMethod: "CARD" });
  const splits = await bookCardPayment(res.body.orderId);
  await deliverAndBook();
  const card = {
    a: Number(saleOf(byVendor("vendor-a"))[0].commissionNet),
    b: Number(saleOf(byVendor("vendor-b"))[0].commissionNet),
    ref: Number(referralOf(byVendor("vendor-b"))[0].earningNet),
    pricesA: prices(byVendor("vendor-a")),
    pricesB: prices(byVendor("vendor-b")),
  };

  assert.deepEqual(card, cod);
  assert.deepEqual(cod, { a: 8.1, b: 21, ref: 2.4, pricesA: { a1: 90, a3: 72 }, pricesB: { b1: 80, b2: 60 } });
  assert.ok(near(splits.vendors.find((v) => v.vendorId === "vendor-a").commissionNet, 8.1), "Stripe split = 5% pe a1+a3");
});

/* =========================================================
   8. refund pe valorile originale
========================================================= */

test("refund parțial (B) și apoi total: valorile ORIGINALE reversate, o singură dată", async () => {
  await placeGuest({ items: items("a1", "a3", "b1", "b2"), vendorCollectionSlugs: vcol("cross-a", "toata-a") });
  await deliverAndBook();

  await refundShipment(byVendor("vendor-b"));
  let v = refunds("vendorEarningEntry");
  assert.equal(v.length, 1);
  assert.ok(near(v[0].commissionNet, -21));
  assert.ok(near(refunds("vendorReferralEarningEntry")[0].earningNet, -2.4));

  // între timp colecția e modificată - refund-ul nu se recalculează
  Object.assign(db.__tables.vendorCollection.find((c) => c.slug === "toata-a"), { discountPercent: 30, isActive: false });

  await refundShipment(byVendor("vendor-a"));
  v = refunds("vendorEarningEntry");
  assert.equal(v.length, 2);
  assert.ok(near(v.find((r) => r.meta.refShipmentId === byVendor("vendor-a").id).commissionNet, -8.1));
});

/* =========================================================
   9. compatibilitate campaignSlugs vechi
========================================================= */

test("legacy: campaignSlugs al unei campanii MIGRATE -> colecția (15%, own-sale), fără campaignId nou", async () => {
  const res = await placeGuest({ items: items("a1"), campaignSlugs: ["toamna-a"] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const s = byVendor("vendor-a");

  assert.equal(s.campaignId ?? null, null, "campania migrată nu se mai aplică drept campanie");
  assert.equal(s.campaignCommissionBps ?? null, null);
  assert.equal(s.vendorReferralCommissionOverrideBps, 500);
  assert.deepEqual(snap(s), { a1: "toamna-a" });
  assert.deepEqual(prices(s), { a1: 85 });

  await deliverAndBook();
  assert.ok(near(saleOf(s)[0].commissionNet, 85 * 0.05));
});

/* =========================================================
   10. fără regresii pe VendorCampaign nemigrate
========================================================= */

test("regresie: campanie NEMIGRATĂ (toamna-b) -> exact ca înainte: campaignId, 5% campanie, reducere 20%", async () => {
  await placeGuest({ items: items("b1", "b2"), campaignSlugs: ["toamna-b"] });
  const s = byVendor("vendor-b");

  assert.equal(s.campaignId, "camp-b");
  assert.equal(s.campaignCommissionBps, 500);
  assert.equal(s.vendorReferralCommissionOverrideBps ?? null, null);
  assert.deepEqual(prices(s), { b1: 64, b2: 48 });
  assert.deepEqual(snap(s), { b1: null, b2: null });

  await deliverAndBook();
  assert.ok(near(saleOf(s)[0].commissionNet, (64 + 48) * 0.05));
});

test("regresie: comandă istorică cu campaignId (fără snapshot) -> ledger neschimbat", async () => {
  await placeGuest({ items: items("b1"), campaignSlugs: ["toamna-b"] });
  // campania e migrată DUPĂ comandă -> comanda veche rămâne pe campaignId
  db.__tables.vendorCollection.push({ id: "vcol-b-late", vendorId: "vendor-b", slug: "toamna-b", title: "B", isActive: true, discountPercent: 20, allOwnProducts: true, legacyCampaignId: "camp-b" });

  await deliverAndBook();
  const s = byVendor("vendor-b");
  assert.equal(s.campaignId, "camp-b");
  assert.ok(near(saleOf(s)[0].commissionNet, 64 * 0.05));
});

/* =========================================================
   Roluri: aceeași comandă, ambele axe pe același vendor
========================================================= */

test("roluri: ?ref= cross-vendor clasic (B) pe shipment-ul A + colecția proprie A -> referral pe TOT shipment-ul, 5% doar pe itemii colecției", async () => {
  db.__tables.vendorCollectionItem.push({ collectionId: "vcol-sel", productId: "a1", position: 1 });
  await placeGuest({ items: items("a1", "a2"), vendorCollectionSlugs: vcol("selectie-a"), referralCodes: ref("atelier-b") });
  const s = byVendor("vendor-a");

  assert.equal(s.referrerVendorId, "vendor-b");
  assert.equal(s.referrerVendorReferralCodeSnapshot, "atelier-b");
  assert.equal(s.vendorReferralCommissionOverrideBps, 500);
  assert.deepEqual(snap(s), { a1: "selectie-a", a2: null });

  await deliverAndBook();
  const commission = 90 * 0.05 + 50 * 0.15;
  assert.ok(near(saleOf(s)[0].commissionNet, commission));
  assert.ok(near(referralOf(s)[0].earningNet, commission * 0.2), "referral clasic = tot shipment-ul (neschimbat)");
});
