// src/routes/vendorCollectionCheckout.e2e.test.js
//
// VENDOR COLLECTION request-based, PER ITEM, end-to-end pe rutele REALE:
//   POST /api/checkout/guest/place | /api/checkout/place
//     { vendorCollectionSlugs: [{ slug, at }] }
//   -> services/referralAttribution.js -> resolveVendorCollectionAttributionBySlug
//      (colecție activă, owner activ; NU depinde de Vendor.referralCode)
//   -> membership real VendorCollectionItem + produs public, per shipment
//   -> ShipmentItem.vendorCollectionIdSnapshot / vendorCollectionSlugSnapshot
//      DOAR pe itemii membri, DOAR când colecția câștigă promotorul shipment-ului
//   -> ledger COD (computeVendorEarningForShipment) și CARD (computeOrderSplits +
//      cardSaleLedger, aceiași pași ca webhook-ul) citesc DOAR snapshot-ul
//   -> own-sale 5% doar pe itemii din colecție; referral cross-vendor doar din
//      itemii din colecție; refund = valorile originale.
//
// Fără token (doar testul de tranziție), fără localStorage, fără consent.
// Harness identic cu campaignCheckout.e2e.test.js (+ relații order/shipment).
//
// Rulare: node --experimental-test-module-mocks --test src/routes/vendorCollectionCheckout.e2e.test.js

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
    if (key.includes("_") && row && !(key in row) && cond && typeof cond === "object" && !Array.isArray(cond)) {
      if (!matchesWhere(row, cond)) return false;
      continue;
    }
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
  quoteRequest: {
    product: (row, t) => (t.product || []).find((p) => p.id === row.productId) || null,
    vendor: (row, t) => (t.vendor || []).find((v) => v.id === row.vendorId) || null,
    offers: (row, t) => (t.quoteOffer || []).filter((o) => o.quoteRequestId === row.id),
    user: (row, t) => (t.user || []).find((u) => u.id === row.userId) || null,
  },
  quoteOffer: {
    quoteRequest: (row, t) => (t.quoteRequest || []).find((q) => q.id === row.quoteRequestId) || null,
  },
  cartItem: {
    product: (row, t) => (t.product || []).find((p) => p.id === row.productId) || null,
  },
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
      if (name === "shipment" && Array.isArray(data.items?.create)) {
        currentTables.shipmentItem = currentTables.shipmentItem || [];
        for (const it of data.items.create) currentTables.shipmentItem.push({ id: nextId("shipmentItem"), createdAt: new Date(), shipmentId: row.id, ...it });
      }
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
        req.user = { sub: currentUser.id, id: currentUser.id, role: currentUser.role || "USER" };
        next();
      },
      requireRole: () => (_q, _s, n) => n(),
      enforceTokenVersion: (_q, _s, n) => n(),
    },
  });

  const actualMailer = await import("../lib/mailer.js");
  reg("../lib/mailer.js", {
    namedExports: { ...actualMailer, sendOrderConfirmationEmail: async () => {}, sendVendorNewOrderEmail: async () => {}, sendVendorNewQuoteRequestEmail: async () => {} },
  });
  const actualNotifications = await import("../services/notifications.js");
  reg("../services/notifications.js", {
    namedExports: {
      ...actualNotifications,
      createVendorNotification: async () => {},
      createUserNotification: async () => {},
      notifyVendorOnProductSoldOut: async () => {},
      notifyInfluencerPayoutProfileIncomplete: async () => {},
    },
  });
  const actualOrchestrator = await import("../payments/orchestrator.js");
  reg("../services/marketplaceMessageModeration.js", {
    namedExports: {
      moderateMarketplaceMessage: async ({ senderType } = {}) => ({ allowed: true, reason: null, detections: [], confidence: null, senderType: senderType || null }),
    },
  });
  reg("../payments/orchestrator.js", {
    namedExports: {
      ...actualOrchestrator,
      createPaymentForOrder: async (order) => {
        paymentCalls.push(order.id);
        return { provider: "stripe", redirectUrl: "https://checkout.stripe.test/x" };
      },
    },
  });
  const actualPromo = await import("../services/productPromotionPrice.js");
  reg("../services/productPromotionPrice.js", {
    namedExports: { ...actualPromo, getPromotionPricingForProducts: async () => new Map() },
  });

  const checkoutRouter = (await import("./chekoutRoutes.js")).default;

  const app = express();
  app.use(express.json());
  app.use("/api", checkoutRouter);
  app.use("/api", (await import("./cartRoutes.js")).default);
  app.use("/api/assistant/quotes", (await import("./assistantRoutes/assistant/assistantQuotesRoutes.js")).default);
  app.use("/api/vendor/quotes", (await import("./assistantRoutes/assistant/vendorQuotesRoutes.js")).default);
  app.use("/api/admin", (await import("./adminOrdersRoutes.js")).default);
  app.use("/api/admin", (await import("./adminInvoicesRoutes.js")).default);

  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  restores.forEach((r) => r.restore());
});

/* =========================================================
   Seed
   Plan 15% pentru toți vendorii; referral cross-vendor implicit 20%
   (referralCommissionBps 0 -> DEFAULT_VENDOR_PROMOTER_COMMISSION_BPS).
   Colecția lui A (colectia-a) conține: a1 (A), b1 (B), c1 (C).
   Campania lui A (toamna-a) - SELECTED_PRODUCTS: a2.
   Vendor A NU are referralCode - colecția trebuie să funcționeze fără el.
========================================================= */

const REF = "teo-31b637";
const inAYear = () => new Date(Date.now() + 365 * 86400000);

function seed() {
  db = makeDb();
  currentUser = null;
  paymentCalls = [];
  const t = db.__tables;

  t.influencerProfile = [
    { id: "inf-1", referralCode: REF, status: "ACTIVE", commissionBps: 5000, createdAt: new Date(), collaborationEndOverride: inAYear(), displayName: "Teo", userId: "user-inf-1" },
    { id: "inf-2", referralCode: "ana-codul", status: "ACTIVE", commissionBps: 5000, createdAt: new Date(), collaborationEndOverride: inAYear(), displayName: "Ana" },
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
    { id: "vendor-c", referralCode: "atelier-c", referralCommissionBps: 0, displayName: "Atelier C", isActive: true, email: "c@t.ro", user: { email: "c@t.ro" }, ...stripeReady },
  ];

  const product = (id, vendorId, priceCents) => ({
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
  });

  t.product = [
    product("a1", "vendor-a", 10000),
    product("a2", "vendor-a", 5000),
    product("a3", "vendor-a", 8000),
    product("b1", "vendor-b", 8000),
    product("b2", "vendor-b", 6000),
    product("c1", "vendor-c", 4000),
  ];
  t.user = [
    { id: "user-1", email: "client@t.ro", name: "Client" },
    { id: "user-vendor-a", email: "owner-a@t.ro", name: "Owner A" },
    { id: "user-vendor-b", email: "owner-b@t.ro", name: "Owner B" },
    { id: "user-inf-1", email: "teo@t.ro", name: "Teo" },
  ];

  t.vendorCollection = [{ id: "vcol-a", vendorId: "vendor-a", slug: "colectia-a", title: "Colecția A", isActive: true }];
  t.vendorCollectionItem = ["a1", "b1", "c1"].map((productId, position) => ({ collectionId: "vcol-a", productId, position }));

  t.vendorCampaign = [
    {
      id: "camp-a", vendorId: "vendor-a", slug: "toamna-a", isActive: true, scope: "SELECTED_PRODUCTS",
      discountPercent: 10, platformFundingBps: 0, vendorFundingBps: 10000, fundingSource: "VENDOR",
      startsAt: null, endsAt: null, vendor: { isActive: true }, products: [{ productId: "a2" }],
    },
  ];
  t.vendorSubscription = ["vendor-a", "vendor-b", "vendor-c"].map((vendorId) => ({
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

const SELECTIONS = {
  "svc-vendor-a": { method: "COURIER" },
  "svc-vendor-b": { method: "COURIER" },
  "svc-vendor-c": { method: "COURIER" },
};

const vcol = (slug = "colectia-a", at = Date.now()) => [{ slug, at }];
const ref = (code, at = Date.now()) => [{ code, at }];

// fără niciun câmp de consimțământ „Atribuire”, fără token
function body({ email, paymentMethod, vendorCollectionSlugs, referralCodes, campaignSlugs, discountCode, vendorCollectionToken }) {
  return {
    address: email ? { ...ADDRESS, email } : ADDRESS,
    customerType: "PF",
    paymentMethod,
    selections: SELECTIONS,
    consents: { terms: true, returns: true },
    ...(vendorCollectionSlugs !== undefined ? { vendorCollectionSlugs } : {}),
    ...(referralCodes ? { referralCodes } : {}),
    ...(campaignSlugs ? { campaignSlugs } : {}),
    ...(discountCode ? { discountCode } : {}),
    ...(vendorCollectionToken ? { vendorCollectionAttribution: vendorCollectionToken } : {}),
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

async function placeUser({ items, paymentMethod = "COD", userId = "user-1", ...rest }) {
  currentUser = { id: userId };
  db.__tables.cartItem = items.map((it, i) => ({
    id: `ci-${i}`,
    userId,
    productId: it.productId,
    qty: it.qty || 1,
    selectedOptions: {},
    customAnswers: {},
    configurationKey: "default",
    product: db.__tables.product.find((p) => p.id === it.productId),
  }));
  const res = await fetch(`${baseUrl}/api/checkout/place`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body({ paymentMethod, ...rest })),
  });
  return { status: res.status, body: await res.json() };
}

const items = (...ids) => ids.map((productId) => ({ productId, qty: 1 }));
const shipments = () => (db.__tables.shipment || []).filter((s) => s.direction !== "RETURN");
const byVendor = (vendorId) => shipments().find((s) => s.vendorId === vendorId);
const itemsOf = (s) => (db.__tables.shipmentItem || []).filter((i) => i.shipmentId === s.id);
const snap = (s) => Object.fromEntries(itemsOf(s).map((i) => [i.productId, i.vendorCollectionIdSnapshot ?? null]));
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
const saleOf = (s) => (db.__tables.vendorEarningEntry || []).filter((e) => e.shipmentId === s.id && e.type === "SALE");
const referralOf = (s) => (db.__tables.vendorReferralEarningEntry || []).filter((e) => e.shipmentId === s.id && e.type === "SALE");

/* ---------- COD: ledger la livrare (trigger-ul real) ---------- */

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

/* ---------- CARD: aceiași pași ca webhook-ul payment_intent.succeeded ---------- */

async function bookCardPayment(orderId) {
  const { computeOrderSplits, allocateStripeFee, computeVendorPayouts } = await import("../payments/marketplaceCalc.js");
  const card = await import("../services/cardSaleLedger.js");
  const vendorOrders = await import("./vendorOrdersRoutes.js");

  const splits = await computeOrderSplits(orderId);
  const payouts = computeVendorPayouts({ vendors: allocateStripeFee({ vendors: splits.vendors, feeNet: 0 }) });

  for (const payout of payouts) {
    const allocation = await card.planCardSaleEntries({
      db,
      orderId,
      vendorId: payout.vendorId,
      payout,
      computeEarning: vendorOrders.computeVendorEarningForShipment,
    });

    await card.upsertCardSaleEntries({
      db,
      orderId,
      vendorId: payout.vendorId,
      allocation,
      transferId: `tr_${payout.vendorId}`,
      currency: "RON",
      buildMeta: (row) =>
        card.buildCardSaleEntryMeta({ payout, row, orderId, paymentIntentId: "pi_1", chargeId: "ch_1", feeTotal: 0 }),
    });
  }

  return splits;
}

async function cardDeliverAndBook(orderId, times = 2) {
  await bookCardPayment(orderId);
  await deliverAndBook(times); // la livrare: SALE există deja (upsert no-op), referral din meta
}

beforeEach(seed);

/* =========================================================
   CASE 1 / CASE 2 / per item
========================================================= */

test("CASE 1 per item: A1 (colecție) + A2 (campanie) + A3 (plan) în același shipment -> 5% / 5% / 15%", async () => {
  const res = await placeGuest({ items: items("a1", "a2", "a3"), vendorCollectionSlugs: vcol(), campaignSlugs: ["toamna-a"] });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const s = byVendor("vendor-a");
  assert.equal(s.vendorReferralCommissionOverrideBps, 500, "own-sale din colecție");
  assert.equal(s.referrerVendorId ?? null, null, "fără referral către sine");
  assert.equal(s.referrerVendorReferralCodeSnapshot, "COLLECTION:colectia-a");
  assert.equal(s.campaignId, "camp-a");
  assert.deepEqual(snap(s), { a1: "vcol-a", a2: null, a3: null }, "snapshot DOAR pe itemul din colecție");
  assert.equal(itemsOf(s).find((i) => i.productId === "a1").vendorCollectionSlugSnapshot, "colectia-a");

  await deliverAndBook();
  const [sale] = saleOf(s);
  // 100×5% + 50×5% + 80×15% = 5 + 2,5 + 12 = 19,50  (NU 230×5% = 11,50)
  assert.ok(near(sale.commissionNet, 19.5), `commissionNet=${sale.commissionNet}`);
  assert.deepEqual(
    sale.meta.commissionGroups.map((g) => [g.label, g.commissionBps, g.itemsAfterDiscount, g.platformNet]),
    [
      ["vendor_collection_own_sale", 500, 100, 5],
      ["campaign", 500, 50, 2.5],
      ["plan", 1500, 80, 12],
    ]
  );
  assert.equal((db.__tables.vendorReferralEarningEntry || []).length, 0, "own-sale fără earning separat");
});

test("CASE 2 per item: B1 (colecția lui A) + B2 (în afara colecției) -> B pe plan 15%, A primește referral DOAR din B1", async () => {
  const res = await placeGuest({ items: items("b1", "b2"), vendorCollectionSlugs: vcol() });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const s = byVendor("vendor-b");
  assert.equal(s.referrerVendorId, "vendor-a");
  assert.equal(s.referrerVendorReferralCodeSnapshot, "COLLECTION:colectia-a");
  assert.equal(s.referrerVendorCommissionBpsSnapshot, 2000);
  assert.equal(s.vendorReferralCommissionOverrideBps ?? null, null, "B NU primește own-sale 5%");
  assert.deepEqual(snap(s), { b1: "vcol-a", b2: null });

  await deliverAndBook(3);
  const [sale] = saleOf(s);
  assert.ok(near(sale.commissionNet, 21), "B: 80×15% + 60×15% = 21 (neschimbat)");

  const refs = referralOf(s);
  assert.equal(refs.length, 1, "un singur VendorReferralEarningEntry pe shipment");
  // baza = comisionul Artfest DOAR pe B1 (80×15% = 12), earning = 12×20% = 2,40 (NU 21×20% = 4,20)
  assert.ok(near(refs[0].artfestCommissionNet, 12));
  assert.ok(near(refs[0].eligibleItemsNet, 80));
  assert.ok(near(refs[0].earningNet, 2.4), `earningNet=${refs[0].earningNet}`);
  assert.equal(refs[0].meta.basis, "vendor_collection_items");
});

test("CASE 3 multi-vendor: A own-sale (a1), B referral (b1, nu b2), C referral (c1) - fiecare shipment separat", async () => {
  await placeGuest({ items: items("a1", "a3", "b1", "b2", "c1"), vendorCollectionSlugs: vcol() });

  const a = byVendor("vendor-a");
  const b = byVendor("vendor-b");
  const c = byVendor("vendor-c");
  assert.equal(a.vendorReferralCommissionOverrideBps, 500);
  assert.equal(b.referrerVendorId, "vendor-a");
  assert.equal(c.referrerVendorId, "vendor-a");
  assert.deepEqual(snap(a), { a1: "vcol-a", a3: null });

  await deliverAndBook();
  assert.ok(near(saleOf(a)[0].commissionNet, 100 * 0.05 + 80 * 0.15), "a1 5% + a3 15%");
  assert.ok(near(referralOf(b)[0].earningNet, 80 * 0.15 * 0.2));
  assert.ok(near(referralOf(c)[0].earningNet, 40 * 0.15 * 0.2));
});

/* =========================================================
   guest / user, COD / CARD
========================================================= */

for (const [who, place] of [["guest", placeGuest], ["user", placeUser]]) {
  for (const paymentMethod of ["COD", "CARD"]) {
    test(`${who} ${paymentMethod}: own-sale a1 + referral b1, snapshot-uri setate`, async () => {
      const res = await place({ items: items("a1", "b1", "b2"), paymentMethod, vendorCollectionSlugs: vcol() });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      if (paymentMethod === "CARD") assert.equal(paymentCalls.length, 1);
      assert.equal(byVendor("vendor-a").vendorReferralCommissionOverrideBps, 500);
      assert.equal(byVendor("vendor-b").referrerVendorId, "vendor-a");
      assert.deepEqual(snap(byVendor("vendor-b")), { b1: "vcol-a", b2: null });
    });
  }
}

test("COD vs CARD identic: comision per shipment, own-sale per item și referral din B1", async () => {
  const scenario = { items: items("a1", "a2", "a3", "b1", "b2"), vendorCollectionSlugs: vcol(), campaignSlugs: ["toamna-a"] };

  await placeGuest({ ...scenario, paymentMethod: "COD" });
  await deliverAndBook();
  const cod = {
    a: Number(saleOf(byVendor("vendor-a"))[0].commissionNet),
    b: Number(saleOf(byVendor("vendor-b"))[0].commissionNet),
    ref: Number(referralOf(byVendor("vendor-b"))[0].earningNet),
  };

  seed();
  const res = await placeGuest({ ...scenario, paymentMethod: "CARD" });
  const splits = await bookCardPayment(res.body.orderId);
  await deliverAndBook();
  const card = {
    a: Number(saleOf(byVendor("vendor-a"))[0].commissionNet),
    b: Number(saleOf(byVendor("vendor-b"))[0].commissionNet),
    ref: Number(referralOf(byVendor("vendor-b"))[0].earningNet),
  };

  assert.deepEqual(card, cod);
  assert.deepEqual(cod, { a: 19.5, b: 21, ref: 2.4 });

  // Stripe split (computeOrderSplits) = aceleași grupuri per item
  const splitA = splits.vendors.find((v) => v.vendorId === "vendor-a");
  assert.ok(near(splitA.commissionNet, 19.5), "CARD own-sale din colecție = 5% pe a1 la plată");
  assert.deepEqual(splitA.commissionGroups.map((g) => g.label), ["vendor_collection_own_sale", "campaign", "plan"]);
  assert.equal(saleOf(byVendor("vendor-a"))[0].stripeTransferId, "tr_vendor-a");
});

/* =========================================================
   Refund total și parțial (reversează valorile ORIGINALE)
========================================================= */

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

test("refund parțial (doar shipment-ul B): referral-ul lui A reversat exact (-2,40); shipment-ul A neatins", async () => {
  await placeGuest({ items: items("a1", "a3", "b1", "b2"), vendorCollectionSlugs: vcol() });
  await deliverAndBook();

  await refundShipment(byVendor("vendor-b"));

  const vRefunds = refunds("vendorEarningEntry");
  assert.equal(vRefunds.length, 1, "doar SALE-ul lui B reversat (idempotent)");
  assert.ok(near(vRefunds[0].commissionNet, -21));

  const rRefunds = refunds("vendorReferralEarningEntry");
  assert.equal(rRefunds.length, 1);
  assert.ok(near(rRefunds[0].earningNet, -2.4), "reversează valoarea ORIGINALĂ (doar B1)");
  assert.ok(near(rRefunds[0].artfestCommissionNet, -12));

  assert.equal(vRefunds.some((r) => r.meta.refShipmentId === byVendor("vendor-a").id), false);
});

test("refund total: ambele shipment-uri reversate cu valorile originale (19,50 per item / 21 / referral 2,40)", async () => {
  await placeGuest({ items: items("a1", "a2", "a3", "b1", "b2"), vendorCollectionSlugs: vcol(), campaignSlugs: ["toamna-a"] });
  await deliverAndBook();

  for (const s of shipments()) await refundShipment(s);

  const byShipment = (id) => refunds("vendorEarningEntry").find((r) => r.meta.refShipmentId === id);
  assert.ok(near(byShipment(byVendor("vendor-a").id).commissionNet, -19.5));
  assert.ok(near(byShipment(byVendor("vendor-b").id).commissionNet, -21));
  assert.deepEqual(byShipment(byVendor("vendor-a").id).meta.reversedCommissionGroups.map((g) => g.label), [
    "vendor_collection_own_sale",
    "campaign",
    "plan",
  ]);
  assert.ok(near(refunds("vendorReferralEarningEntry")[0].earningNet, -2.4));
});

/* =========================================================
   Snapshot: comenzile istorice NU se schimbă
========================================================= */

for (const [name, mutate] of [
  ["produsul scos din colecție", (t) => { t.vendorCollectionItem.splice(0); }],
  ["colecția redenumită", (t) => { t.vendorCollection[0].slug = "alt-nume"; t.vendorCollection[0].title = "Alt nume"; }],
  ["colecția dezactivată", (t) => { t.vendorCollection[0].isActive = false; }],
  ["colecția ștearsă", (t) => { t.vendorCollection.splice(0); t.vendorCollectionItem.splice(0); }],
]) {
  test(`după checkout: ${name} -> ledger-ul (COD și CARD) folosește snapshot-ul, rezultat neschimbat`, async () => {
    const res = await placeGuest({ items: items("a1", "a3", "b1", "b2"), paymentMethod: "CARD", vendorCollectionSlugs: vcol() });
    mutate(db.__tables);

    await cardDeliverAndBook(res.body.orderId);

    assert.ok(near(saleOf(byVendor("vendor-a"))[0].commissionNet, 5 + 12));
    assert.ok(near(referralOf(byVendor("vendor-b"))[0].earningNet, 2.4));
    assert.equal(referralOf(byVendor("vendor-b"))[0].meta.vendorCollectionSlugSnapshot, "colectia-a");
  });
}

test("produs scos din colecție ÎNAINTE de checkout -> acea vânzare nu mai e atribuită colecției", async () => {
  db.__tables.vendorCollectionItem = db.__tables.vendorCollectionItem.filter((i) => i.productId !== "b1");
  await placeGuest({ items: items("a1", "b1"), vendorCollectionSlugs: vcol() });

  const b = byVendor("vendor-b");
  assert.equal(b.referrerVendorId ?? null, null);
  assert.deepEqual(snap(b), { b1: null });
  assert.equal(byVendor("vendor-a").vendorReferralCommissionOverrideBps, 500, "a1 încă în colecție");
});

/* =========================================================
   Validare server-side
========================================================= */

test("owner inactiv / colecție inactivă / produs nepublic -> fără atribuire, comanda trece", async () => {
  const cases = [
    (t) => { t.vendor.find((v) => v.id === "vendor-a").isActive = false; },
    (t) => { t.vendorCollection[0].isActive = false; },
  ];
  for (const mutate of cases) {
    seed();
    mutate(db.__tables);
    const res = await placeGuest({ items: items("b1"), vendorCollectionSlugs: vcol() });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(byVendor("vendor-b").referrerVendorId ?? null, null);
    assert.deepEqual(snap(byVendor("vendor-b")), { b1: null });
  }
});

test("slug invalid / manipulat / tip greșit -> ignorat, comanda trece", async () => {
  const cases = [
    vcol("nu-exista"),
    vcol("COLECTIA-A"),
    vcol("colectia-a OR 1=1"),
    vcol("x".repeat(181)),
    [{ slug: 123 }],
    [{ slug: { $ne: null } }],
    "nu-exista,COLECTIA-A",
    { slug: "colectia-a" },
    [null],
  ];
  for (const vendorCollectionSlugs of cases) {
    seed();
    const res = await placeGuest({ items: items("b1"), vendorCollectionSlugs });
    assert.equal(res.status, 200, `${JSON.stringify(vendorCollectionSlugs)}: ${JSON.stringify(res.body)}`);
    assert.equal(byVendor("vendor-b").referrerVendorId ?? null, null);
  }
});

test("FAZA 2: forma string „a,b” (ca în query-ul GET de pricing) e acceptată, slug-ul tot validat pe server", async () => {
  await placeGuest({ items: items("b1"), vendorCollectionSlugs: "nu-exista,colectia-a" });
  assert.equal(byVendor("vendor-b").referrerVendorId, "vendor-a");
});

/* =========================================================
   Self-referral (BUYER == REFERRER)
========================================================= */

test("self-referral: ownerul A cumpără b1 din propria colecție -> fără referral / earning / snapshot", async () => {
  await placeUser({ userId: "user-vendor-a", items: items("b1"), vendorCollectionSlugs: vcol() });
  const b = byVendor("vendor-b");
  assert.equal(b.referrerVendorId ?? null, null);
  assert.deepEqual(snap(b), { b1: null });

  await deliverAndBook();
  assert.equal((db.__tables.vendorReferralEarningEntry || []).length, 0);
});

test("self-referral: guest cu emailul ownerului A -> fără referral către sine", async () => {
  await placeGuest({ email: "owner-a@t.ro", items: items("b1"), vendorCollectionSlugs: vcol() });
  assert.equal(byVendor("vendor-b").referrerVendorId ?? null, null);
});

test("cazul real (colecție): emailul public al ownerului A = emailul contului lui B -> referral către A din b1 rămâne", async () => {
  db.__tables.vendor.find((v) => v.id === "vendor-a").email = "owner-b@t.ro";
  await placeGuest({ email: "owner-b@t.ro", items: items("b1", "b2"), vendorCollectionSlugs: vcol() });
  const b = byVendor("vendor-b");
  assert.equal(b.referrerVendorId, "vendor-a");
  assert.deepEqual(snap(b), { b1: "vcol-a", b2: null });

  await deliverAndBook();
  assert.ok(near(referralOf(b)[0].earningNet, 2.4));
});

test("guest cu emailul PUBLIC al ownerului A (nu al contului) -> referral din colecție permis", async () => {
  db.__tables.vendor.find((v) => v.id === "vendor-a").email = "contact-a@t.ro";
  await placeGuest({ email: "contact-a@t.ro", items: items("b1"), vendorCollectionSlugs: vcol() });
  assert.equal(byVendor("vendor-b").referrerVendorId, "vendor-a");
});

test("self-referral NU blochează own-sale: ownerul A vinde a1 (seller == referrer) -> 5% pe a1", async () => {
  await placeUser({ userId: "user-vendor-a", items: items("a1", "a3"), vendorCollectionSlugs: vcol() });
  assert.equal(byVendor("vendor-a").vendorReferralCommissionOverrideBps, 500);
  await deliverAndBook();
  assert.ok(near(saleOf(byVendor("vendor-a"))[0].commissionNet, 5 + 12));
});

/* =========================================================
   Priorități (neschimbate)
========================================================= */

test("influencer ?ref= vs colecție -> influencerul câștigă, fără snapshot de colecție", async () => {
  await placeGuest({ items: items("b1"), vendorCollectionSlugs: vcol("colectia-a", Date.now()), referralCodes: ref(REF, Date.now() - 60_000) });
  const b = byVendor("vendor-b");
  assert.equal(b.influencerId, "inf-1");
  assert.equal(b.referrerVendorId ?? null, null);
  assert.deepEqual(snap(b), { b1: null });
});

test("vendor ?ref= explicit vs colecție -> câștigă cel mai recent (last click), per shipment", async () => {
  // ?ref= C mai recent -> referral C clasic pe tot shipment-ul B, fără snapshot
  await placeGuest({ items: items("b1", "b2"), vendorCollectionSlugs: vcol("colectia-a", Date.now() - 60_000), referralCodes: ref("atelier-c", Date.now()) });
  let b = byVendor("vendor-b");
  assert.equal(b.referrerVendorId, "vendor-c");
  assert.equal(b.referrerVendorReferralCodeSnapshot, "atelier-c");
  assert.deepEqual(snap(b), { b1: null, b2: null });
  await deliverAndBook();
  assert.ok(near(referralOf(b)[0].earningNet, 21 * 0.2), "?ref= clasic: tot shipment-ul (regulă neschimbată)");

  // colecția mai recentă -> A, doar b1
  seed();
  await placeGuest({ items: items("b1", "b2"), vendorCollectionSlugs: vcol("colectia-a", Date.now()), referralCodes: ref("atelier-c", Date.now() - 60_000) });
  b = byVendor("vendor-b");
  assert.equal(b.referrerVendorId, "vendor-a");
  assert.deepEqual(snap(b), { b1: "vcol-a", b2: null });
});

test("vendor ?ref= explicit pe un shipment fără produs din colecție -> ?ref= rămâne (colecția nu se aplică)", async () => {
  await placeGuest({ items: items("b2"), vendorCollectionSlugs: vcol("colectia-a", Date.now()), referralCodes: ref("atelier-c", Date.now() - 60_000) });
  assert.equal(byVendor("vendor-b").referrerVendorId, "vendor-c");
});

test("cod de reducere influencer vs colecție -> codul câștigă, fără snapshot de colecție", async () => {
  db.__tables.discountCode = [
    {
      id: "dc-ana", code: "ANA10", ownerType: "INFLUENCER", influencerId: "inf-2", vendorId: null, scope: "ALL_PRODUCTS",
      discountType: "PERCENT", discountPercent: 10, discountAmountCents: null, currency: "RON", minimumOrderCents: null,
      maxDiscountCents: null, fundingSource: "PLATFORM", platformFundingBps: 10000, vendorFundingBps: 0, status: "ACTIVE",
      isActive: true, startsAt: null, endsAt: null, usageLimit: null, usageLimitPerUser: null, usedCount: 0,
    },
  ];
  const res = await placeGuest({ items: items("b1"), vendorCollectionSlugs: vcol(), discountCode: "ANA10" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const b = byVendor("vendor-b");
  assert.equal(b.influencerId, "inf-2");
  assert.equal(b.referrerVendorId ?? null, null);
  assert.deepEqual(snap(b), { b1: null });
});

test("VendorCampaign vs VendorCollection pe același vendor: a1 own-sale, a2 campanie, a3 plan (per item)", async () => {
  // acoperit numeric în CASE 1; aici: campania singură (fără colecție) rămâne neschimbată
  await placeGuest({ items: items("a1", "a2", "a3"), campaignSlugs: ["toamna-a"] });
  const s = byVendor("vendor-a");
  assert.equal(s.vendorReferralCommissionOverrideBps ?? null, null);
  assert.deepEqual(snap(s), { a1: null, a2: null, a3: null });
  await deliverAndBook();
  assert.ok(near(saleOf(s)[0].commissionNet, 100 * 0.15 + 50 * 0.05 + 80 * 0.15));
});

test("own-sale CLASIC (?ref= propriu) + campanie -> neschimbat: 5% pe TOT shipment-ul", async () => {
  db.__tables.vendor.find((v) => v.id === "vendor-a").referralCode = "atelier-a";
  await placeGuest({ items: items("a1", "a2", "a3"), referralCodes: ref("atelier-a"), campaignSlugs: ["toamna-a"] });
  const s = byVendor("vendor-a");
  assert.deepEqual(snap(s), { a1: null, a2: null, a3: null });
  await deliverAndBook();
  assert.ok(near(saleOf(s)[0].commissionNet, 230 * 0.05), "own-sale clasic are prioritate pe tot shipment-ul");
});

/* =========================================================
   Tranziție + idempotență + dashboard
========================================================= */

test("tranziție: tokenul vechi de colecție e acceptat și produce aceleași snapshot-uri per item", async () => {
  const { signVendorCollectionAttributionToken } = await import("../services/vendorCollectionAttributionToken.js");
  const token = signVendorCollectionAttributionToken({ collectionId: "vcol-a", ownerVendorId: "vendor-a" });
  await placeGuest({ items: items("b1", "b2"), vendorCollectionToken: token });
  assert.deepEqual(snap(byVendor("vendor-b")), { b1: "vcol-a", b2: null });
});

test("earning idempotent: 4 rulări ale ledger-ului (COD) + webhook CARD dublat -> câte o singură intrare", async () => {
  const res = await placeGuest({ items: items("a1", "b1", "b2", "c1"), paymentMethod: "CARD", vendorCollectionSlugs: vcol() });
  await bookCardPayment(res.body.orderId);
  await cardDeliverAndBook(res.body.orderId, 4);

  for (const s of shipments()) assert.equal(saleOf(s).length, 1, s.vendorId);
  assert.equal((db.__tables.vendorReferralEarningEntry || []).length, 2, "B și C, câte una");
  assert.equal((db.__tables.influencerEarningEntry || []).length, 0);
});

test("dashboard: estimare referral (PENDING) doar din b1; beneficiu own-sale doar pe a1", async () => {
  await placeGuest({ items: items("a1", "a3", "b1", "b2"), vendorCollectionSlugs: vcol() });
  const earnings = await import("../services/vendorReferralEarnings.js");

  const pending = await earnings.listVendorReferralAttributedOrders({ referrerVendorId: "vendor-a" });
  assert.equal(pending.items.length, 1);
  assert.equal(pending.items[0].earningStatus, "PENDING");
  assert.ok(near(pending.items[0].earningNet, 2.4));
  assert.equal(pending.items[0].attributionSource, "COLLECTION");

  const own = await earnings.listVendorOwnSaleAttributedOrders({ vendorId: "vendor-a" });
  // beneficiu = 15% - 5% pe a1 (100) = 10, NU pe a3
  assert.ok(near(own.items[0].benefitAmount, 10), `benefit=${own.items[0].benefitAmount}`);

  await deliverAndBook();
  const confirmed = await earnings.listVendorReferralAttributedOrders({ referrerVendorId: "vendor-a" });
  assert.equal(confirmed.items[0].earningStatus, "CONFIRMED");
  assert.ok(near(confirmed.items[0].earningNet, 2.4));
  const ownConfirmed = await earnings.listVendorOwnSaleAttributedOrders({ vendorId: "vendor-a" });
  assert.ok(near(ownConfirmed.items[0].benefitAmount, 10));
});

/* =========================================================
   Sumar „Recomandări” (GET /api/vendors/me -> referral.stats) = liste
   (GET /api/vendors/me/referral/orders) = ledger - aceeași bază PER ITEM.
   Aceleași 6 funcții ca vendorRoutes.js, în aceeași ordine.
========================================================= */

async function summaryFor(vendorId) {
  const e = await import("../services/vendorReferralEarnings.js");
  const [refConfirmed, refEstimated, refAttributed, ownConfirmed, ownEstimated, ownAttributed] = await Promise.all([
    e.getVendorReferralConfirmedTotals(vendorId),
    e.getVendorReferralEstimatedEarnings(vendorId),
    e.getVendorReferralAttributedTotals(vendorId),
    e.getVendorOwnSaleConfirmedTotals(vendorId),
    e.getVendorOwnSaleEstimatedBenefit(vendorId),
    e.getVendorOwnSaleAttributedTotals(vendorId),
  ]);
  return { refConfirmed, refEstimated, refAttributed, ownConfirmed, ownEstimated, ownAttributed };
}

async function listsFor(vendorId) {
  const e = await import("../services/vendorReferralEarnings.js");
  const [ref, own] = await Promise.all([
    e.listVendorReferralAttributedOrders({ referrerVendorId: vendorId, take: 50, skip: 0 }),
    e.listVendorOwnSaleAttributedOrders({ vendorId, take: 50, skip: 0 }),
  ]);
  const sum = (rows, key) => Math.round(rows.reduce((t, r) => t + Number(r[key] || 0), 0) * 100) / 100;
  return { ref: ref.items, own: own.items, refEarning: sum(ref.items, "earningNet"), ownBenefit: sum(own.items, "benefitAmount") };
}

test("sumar B1 + B2 PENDING: estimat 2,40 (nu 4,20), vânzări atribuite 80 (nu 140) = lista", async () => {
  await placeGuest({ items: items("b1", "b2"), vendorCollectionSlugs: vcol() });

  const s = await summaryFor("vendor-a");
  const l = await listsFor("vendor-a");

  assert.equal(l.ref[0].earningStatus, "PENDING");
  assert.ok(near(s.refEstimated, 2.4), `estimat=${s.refEstimated}`);
  assert.ok(near(s.refEstimated, l.refEarning), "sumar = listă");
  assert.ok(near(s.refAttributed.salesAmount, 80), `vânzări=${s.refAttributed.salesAmount}`);
  assert.ok(near(l.ref[0].eligibleItemsNet, 80));
  assert.equal(s.refAttributed.ordersCount, 1);
});

test("sumar B1 + B2 CONFIRMED: confirmat 2,40 = lista = ledger; estimat 0", async () => {
  await placeGuest({ items: items("b1", "b2"), vendorCollectionSlugs: vcol() });
  await deliverAndBook();

  const s = await summaryFor("vendor-a");
  const l = await listsFor("vendor-a");

  assert.equal(l.ref[0].earningStatus, "CONFIRMED");
  assert.ok(near(s.refConfirmed.confirmedEarningsAmount, 2.4));
  assert.ok(near(s.refConfirmed.confirmedEarningsAmount, l.refEarning));
  assert.ok(near(s.refConfirmed.salesAmount, 80));
  assert.equal(s.refEstimated, 0);
});

test("sumar B1 + B2 REVERSED: confirmat net 0, fără comenzi confirmate; lista REVERSED cu 0", async () => {
  await placeGuest({ items: items("b1", "b2"), vendorCollectionSlugs: vcol() });
  await deliverAndBook();
  await refundShipment(byVendor("vendor-b"));

  const s = await summaryFor("vendor-a");
  const l = await listsFor("vendor-a");

  assert.equal(l.ref[0].earningStatus, "REVERSED");
  assert.ok(near(l.refEarning, 0));
  assert.ok(near(s.refConfirmed.confirmedEarningsAmount, 0));
  assert.equal(s.refConfirmed.ordersCount, 0);
  assert.equal(s.refEstimated, 0);
});

test("sumar A1 + A2 + A3 PENDING: beneficiu own-sale 10 (doar A1; nu 15 cu A2), vânzări 100 (nu 230) = lista", async () => {
  await placeGuest({ items: items("a1", "a2", "a3"), vendorCollectionSlugs: vcol(), campaignSlugs: ["toamna-a"] });

  const s = await summaryFor("vendor-a");
  const l = await listsFor("vendor-a");
  const row = l.own[0];

  assert.equal(row.earningStatus, "PENDING");
  assert.ok(near(s.ownEstimated, 10), `beneficiu=${s.ownEstimated}`);
  assert.ok(near(s.ownEstimated, l.ownBenefit), "sumar = listă");
  assert.ok(near(s.ownAttributed.salesAmount, 100), `vânzări=${s.ownAttributed.salesAmount}`);
  assert.ok(near(row.eligibleItemsNet, 100), "lista: doar A1");
  assert.ok(near(row.artfestCommissionNet, 5), "lista: comision 5% pe A1");
  assert.equal(s.refEstimated, 0, "own-sale nu e câștig de referral");
});

test("sumar A1 + A2 + A3 CONFIRMED (COD și CARD): beneficiu 10 = lista; REVERSED -> 0", async () => {
  for (const paymentMethod of ["COD", "CARD"]) {
    seed();
    const res = await placeGuest({ items: items("a1", "a2", "a3"), paymentMethod, vendorCollectionSlugs: vcol(), campaignSlugs: ["toamna-a"] });
    if (paymentMethod === "CARD") await bookCardPayment(res.body.orderId);
    await deliverAndBook();

    const s = await summaryFor("vendor-a");
    const l = await listsFor("vendor-a");

    assert.equal(l.own[0].earningStatus, "CONFIRMED", paymentMethod);
    assert.ok(near(s.ownConfirmed.confirmedBenefitAmount, 10), `${paymentMethod}: ${s.ownConfirmed.confirmedBenefitAmount}`);
    assert.ok(near(s.ownConfirmed.confirmedBenefitAmount, l.ownBenefit), paymentMethod);
    assert.ok(near(s.ownConfirmed.salesAmount, 100), paymentMethod);
    assert.ok(near(l.own[0].eligibleItemsNet, 100), paymentMethod);
    assert.equal(s.ownEstimated, 0, paymentMethod);

    await refundShipment(byVendor("vendor-a"));
    const r = await summaryFor("vendor-a");
    const rl = await listsFor("vendor-a");
    assert.equal(rl.own[0].earningStatus, "REVERSED", paymentMethod);
    assert.ok(near(r.ownConfirmed.confirmedBenefitAmount, 0), paymentMethod);
    assert.ok(near(rl.ownBenefit, 0), paymentMethod);
  }
});

test("sumar multi-vendor: A own-sale (a1) + B (b1, nu b2) + C (c1) -> sumar = liste", async () => {
  await placeGuest({ items: items("a1", "a3", "b1", "b2", "c1"), vendorCollectionSlugs: vcol() });

  let s = await summaryFor("vendor-a");
  let l = await listsFor("vendor-a");
  assert.ok(near(s.refEstimated, 80 * 0.15 * 0.2 + 40 * 0.15 * 0.2), `estimat=${s.refEstimated}`);
  assert.ok(near(s.refEstimated, l.refEarning));
  assert.ok(near(s.refAttributed.salesAmount, 80 + 40));
  assert.ok(near(s.ownEstimated, 10));
  assert.ok(near(s.ownEstimated, l.ownBenefit));
  assert.ok(near(s.ownAttributed.salesAmount, 100));

  await deliverAndBook();
  s = await summaryFor("vendor-a");
  l = await listsFor("vendor-a");
  assert.ok(near(s.refConfirmed.confirmedEarningsAmount, 3.6));
  assert.ok(near(s.refConfirmed.confirmedEarningsAmount, l.refEarning));
  assert.ok(near(s.ownConfirmed.confirmedBenefitAmount, 10));
  assert.equal(s.refConfirmed.ordersCount, 1);

  // vendorii B și C nu au nimic atribuit în „Recomandări”
  for (const v of ["vendor-b", "vendor-c"]) {
    const sv = await summaryFor(v);
    assert.equal(sv.refAttributed.ordersCount + sv.ownAttributed.ordersCount, 0, v);
  }
});

test("sumar referral CLASIC (?ref=) neschimbat: tot shipment-ul (21 × 20% = 4,20)", async () => {
  await placeGuest({ items: items("b1", "b2"), referralCodes: ref("atelier-c") });
  const s = await summaryFor("vendor-c");
  const l = await listsFor("vendor-c");
  assert.ok(near(s.refEstimated, 4.2));
  assert.ok(near(s.refEstimated, l.refEarning));
  assert.ok(near(s.refAttributed.salesAmount, 140));
});

/* =========================================================
   REGRESII PERMANENTE (mutate din auditurile de atribuire):
   cod de reducere de colecție, OPTIONS, QUOTE_ONLY, gărzi QUOTE_ONLY,
   admin Order Details (grupuri, refund net) și facturare (vendors-due).
   Același seed: a1 100 (colecție), a2 50 (campanie), a3 80, b1 80 (colecție),
   b2 60; plan 15%, referral 20%, influencer 50%. Produse noi la nevoie:
   bopt (B, OPTIONS, 100), qa (A, QUOTE_ONLY), qb (B, QUOTE_ONLY) - în colecție.
========================================================= */

const CLIENT = { id: "user-1", role: "USER" };
const VENDOR_A_USER = { id: "user-vendor-a", role: "VENDOR" };
const VENDOR_B_USER = { id: "user-vendor-b", role: "VENDOR" };
const ADMIN_USER = { id: "user-admin", role: "ADMIN" };
const r2 = (n) => Math.round(Number(n) * 100) / 100;

async function call(method, path, body, user = null, headers = {}) {
  currentUser = user;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  currentUser = null;
  return { status: res.status, body: json };
}

function addModeProducts() {
  const t = db.__tables;
  const base = t.product.find((p) => p.id === "b1");
  const make = (id, vendorId, orderMode, priceCents = 10000) => ({
    ...base,
    id,
    title: `Produs ${id}`,
    priceCents,
    orderMode,
    acceptsCustom: orderMode !== "DIRECT",
    quoteSchema: [],
    serviceId: `svc-${vendorId}`,
    service: {
      ...base.service,
      id: `svc-${vendorId}`,
      vendorId,
      vendor: { billing: null, id: vendorId, displayName: vendorId, isActive: true },
      profile: { displayName: `Magazin ${vendorId}` },
    },
  });
  t.product.push(make("bopt", "vendor-b", "OPTIONS"), make("qa", "vendor-a", "QUOTE_ONLY", 0), make("qb", "vendor-b", "QUOTE_ONLY", 0));
  t.vendorCollectionItem.push(...["bopt", "qa", "qb"].map((productId, i) => ({ collectionId: "vcol-a", productId, position: 10 + i })));
  t.user.push({ id: "user-admin", email: "admin@t.ro", name: "Admin", role: "ADMIN" });
}

async function quoteOrder({ productId, vendorUser, offer, paymentMethod = "COD", fields = { vendorCollectionSlugs: vcol() } }) {
  const created = await call("POST", "/api/assistant/quotes", { productId, quantity: 1, requestData: {}, quoteSchemaAnswers: {}, ...fields }, CLIENT);
  assert.ok(created.status < 300, `quote: ${created.status} ${JSON.stringify(created.body)}`);
  const quote = db.__tables.quoteRequest.at(-1);
  const offered = await call("POST", `/api/vendor/quotes/${quote.id}/offers`, { shippingTotal: 0, ...offer }, vendorUser);
  assert.ok(offered.status < 300, `offer: ${offered.status} ${JSON.stringify(offered.body)}`);
  const offerId = db.__tables.quoteOffer.at(-1).id;
  const accepted = await call("POST", `/api/assistant/quotes/${quote.id}/offers/${offerId}/accept`, { shippingAddress: { ...ADDRESS, name: "Ana Pop", recipientName: "Ana Pop" }, customerType: "PF", paymentMethod }, CLIENT);
  assert.ok(accepted.status < 300, `accept: ${accepted.status} ${JSON.stringify(accepted.body)}`);
  return quote.orderId || accepted.body?.orderId;
}

async function returnShipment(s) {
  const vo = await import("./vendorOrdersRoutes.js");
  s.status = "RETURNED";
  for (let i = 0; i < 3; i++) {
    await vo.ensureRefundLedgerEntry({ vendorId: s.vendorId, shipmentId: s.id });
    await vo.ensureInfluencerRefundLedgerEntry({ shipmentId: s.id });
    await vo.ensureVendorReferralRefundLedgerEntry({ shipmentId: s.id });
  }
}

const itemSnaps = (s) => Object.fromEntries(itemsOf(s).map((i) => [i.productId, i.vendorCollectionSlugSnapshot ?? null]));

/* ---------- cod de reducere VENDOR_COLLECTION: membership per item ---------- */

test("REG cod de colecție (own): a1 în colecție + a3 în afară -> 5% doar pe a1 (17, nu 9)", async () => {
  db.__tables.discountCode = [{
    id: "dc-cola", code: "COLA10", ownerType: "VENDOR", vendorId: "vendor-a", influencerId: null, scope: "VENDOR_COLLECTION", vendorCollectionId: "vcol-a",
    discountType: "PERCENT", discountPercent: 10, discountAmountCents: null, currency: "RON", minimumOrderCents: null, maxDiscountCents: null,
    fundingSource: "VENDOR", platformFundingBps: 0, vendorFundingBps: 10000, status: "ACTIVE", isActive: true, startsAt: null, endsAt: null,
    usageLimit: null, usageLimitPerUser: null, usedCount: 0,
  }];
  const res = await placeGuest({ items: items("a1", "a3"), discountCode: "COLA10" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const a = byVendor("vendor-a");
  assert.deepEqual(itemSnaps(a), { a1: "colectia-a", a3: null });
  await deliverAndBook();
  assert.ok(near(saleOf(a)[0].commissionNet, 100 * 0.05 + 80 * 0.15), `${saleOf(a)[0].commissionNet}`);
});

test("REG cod de colecție (cross): b1 în colecție + b2 în afară -> referral A doar din b1 (2,40, nu 4,20)", async () => {
  db.__tables.discountCode = [{
    id: "dc-cola", code: "COLA10", ownerType: "VENDOR", vendorId: "vendor-a", influencerId: null, scope: "VENDOR_COLLECTION", vendorCollectionId: "vcol-a",
    discountType: "PERCENT", discountPercent: 10, discountAmountCents: null, currency: "RON", minimumOrderCents: null, maxDiscountCents: null,
    fundingSource: "VENDOR", platformFundingBps: 0, vendorFundingBps: 10000, status: "ACTIVE", isActive: true, startsAt: null, endsAt: null,
    usageLimit: null, usageLimitPerUser: null, usedCount: 0,
  }];
  const res = await placeGuest({ items: items("b1", "b2"), discountCode: "COLA10" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const b = byVendor("vendor-b");
  assert.equal(b.referrerVendorId, "vendor-a");
  assert.deepEqual(itemSnaps(b), { b1: "colectia-a", b2: null });
  await deliverAndBook();
  assert.ok(near(saleOf(b)[0].commissionNet, 21));
  assert.ok(near(referralOf(b)[0].earningNet, 2.4), `${referralOf(b)[0].earningNet}`);
});

/* ---------- OPTIONS din colecție ---------- */

test("REG OPTIONS cross-vendor din colecție: variantă + personalizare, qty 2, guest COD = user CARD (prin /api/cart/add)", async () => {
  const LINE = { productId: "bopt", qty: 2, selectedOptions: { culoare: "rosu" }, customAnswers: { nume: "Ana" }, repeatedGroupAnswers: { invitati: [{ nume: "X" }] }, configurationKey: "cfg-ana" };
  const finance = () => {
    const s = byVendor("vendor-b");
    const it = itemsOf(s)[0];
    return { productId: it.productId, qty: it.qty, options: it.selectedOptions, custom: it.customAnswers, snap: it.vendorCollectionSlugSnapshot, referrer: s.referrerVendorId, commission: r2(saleOf(s)[0].commissionNet), referral: r2(referralOf(s)[0].earningNet) };
  };

  addModeProducts();
  const guest = await call("POST", "/api/checkout/guest/place", { items: [LINE], ...body({ paymentMethod: "COD", vendorCollectionSlugs: vcol() }) });
  assert.equal(guest.status, 200, JSON.stringify(guest.body));
  await deliverAndBook();
  const cod = finance();

  seed();
  addModeProducts();
  const added = await call("POST", "/api/cart/add", LINE, CLIENT);
  assert.ok(added.status < 300, JSON.stringify(added.body));
  const user = await call("POST", "/api/checkout/place", body({ paymentMethod: "CARD", vendorCollectionSlugs: vcol() }), CLIENT);
  assert.equal(user.status, 200, JSON.stringify(user.body));
  const splits = await bookCardPayment(user.body.orderId);
  await deliverAndBook();
  const card = finance();

  assert.deepEqual(cod, { productId: "bopt", qty: 2, options: LINE.selectedOptions, custom: LINE.customAnswers, snap: "colectia-a", referrer: "vendor-a", commission: 30, referral: 6 });
  assert.deepEqual(card, cod);
  assert.ok(near(splits.vendors.find((v) => v.vendorId === "vendor-b").commissionNet, 30), "Stripe = COD");
});

/* ---------- QUOTE_ONLY din colecție (acceptare ofertă) ---------- */

test("REG QUOTE_ONLY own-sale + linie a2 în afară -> snapshot doar pe qa, 5% + 15% = 20", async () => {
  addModeProducts();
  await quoteOrder({ productId: "qa", vendorUser: VENDOR_A_USER, offer: { items: [{ productId: "qa", quantity: 1, unitPrice: 100 }, { productId: "a2", quantity: 1, unitPrice: 100 }] } });
  const a = byVendor("vendor-a");
  assert.deepEqual(itemSnaps(a), { qa: "colectia-a", a2: null });
  await deliverAndBook();
  assert.ok(near(saleOf(a)[0].commissionNet, 20), `${saleOf(a)[0].commissionNet}`);
});

test("REG QUOTE_ONLY cross-vendor + linie b2, CARD -> referral doar din qb (3), Stripe = ledger, refund o singură dată", async () => {
  addModeProducts();
  const orderId = await quoteOrder({ productId: "qb", vendorUser: VENDOR_B_USER, paymentMethod: "CARD", offer: { items: [{ productId: "qb", quantity: 1, unitPrice: 100 }, { productId: "b2", quantity: 1, unitPrice: 100 }] } });
  const splits = await bookCardPayment(orderId);
  await deliverAndBook();
  const b = byVendor("vendor-b");
  assert.deepEqual(itemSnaps(b), { qb: "colectia-a", b2: null });
  assert.ok(near(saleOf(b)[0].commissionNet, 30));
  assert.ok(near(splits.vendors.find((v) => v.vendorId === "vendor-b").commissionNet, 30));
  assert.ok(near(referralOf(b)[0].earningNet, 3));

  await returnShipment(b);
  const refunds = (table) => (db.__tables[table] || []).filter((e) => e.type === "REFUND").map((e) => r2(e.commissionNet ?? e.earningNet));
  assert.deepEqual(refunds("vendorEarningEntry"), [-30]);
  assert.deepEqual(refunds("vendorReferralEarningEntry"), [-3]);
});

test("REG QUOTE_ONLY prin ?ref= clasic (fără colecție) -> neschimbat: referral pe tot shipment-ul, fără snapshot", async () => {
  addModeProducts();
  await quoteOrder({ productId: "qb", vendorUser: VENDOR_B_USER, fields: { referralCodes: ref("atelier-c") }, offer: { items: [{ productId: "qb", quantity: 1, unitPrice: 100 }, { productId: "b2", quantity: 1, unitPrice: 100 }] } });
  const b = byVendor("vendor-b");
  assert.equal(b.referrerVendorId, "vendor-c");
  assert.deepEqual(itemSnaps(b), { qb: null, b2: null });
  await deliverAndBook();
  assert.ok(near(referralOf(b)[0].earningNet, 6));
});

/* ---------- gărzi QUOTE_ONLY în checkout (plasare + preview) ---------- */

test("REG QUOTE_ONLY nu se comandă direct: guest place / summary -> 400 cu mesaj, fără comandă", async () => {
  addModeProducts();
  const place = await call("POST", "/api/checkout/guest/place", { items: [{ productId: "a1", qty: 1 }, { productId: "qb", qty: 1 }], ...body({ paymentMethod: "COD" }) });
  const summary = await call("POST", "/api/checkout/guest/summary", { items: [{ productId: "qb", qty: 1 }] });
  for (const r of [place, summary]) {
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal(r.body.error, "quote_only_product");
    assert.equal(r.body.message, "Acest produs se comandă prin cerere de ofertă.");
    assert.equal(r.body.productId, "qb");
  }
  assert.equal((db.__tables.order || []).length, 0);
});

test("REG QUOTE_ONLY: produs devenit QUOTE_ONLY într-un coș vechi de user -> summary + place 400, fără comandă", async () => {
  const added = await call("POST", "/api/cart/add", { productId: "b2", qty: 1 }, CLIENT);
  assert.ok(added.status < 300, JSON.stringify(added.body));
  db.__tables.product.find((p) => p.id === "b2").orderMode = "QUOTE_ONLY";
  const summary = await call("GET", "/api/checkout/summary", null, CLIENT);
  const place = await call("POST", "/api/checkout/place", body({ paymentMethod: "COD" }), CLIENT);
  assert.equal(summary.status, 400);
  assert.equal(summary.body.error, "quote_only_product");
  assert.equal(place.status, 400);
  assert.equal(place.body.error, "quote_only_product");
  assert.equal((db.__tables.order || []).length, 0);
});

/* ---------- admin Order Details + facturare ---------- */

async function adminOrder(orderId) {
  const r = await call("GET", `/api/admin/orders/${orderId}`, null, ADMIN_USER);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}

test("REG admin: shipment mixt A (colecție + campanie + plan) -> grupuri reale, 19,5; vendors-due = ledger", async () => {
  addModeProducts();
  const res = await placeGuest({ items: items("a1", "a2", "a3"), vendorCollectionSlugs: vcol(), campaignSlugs: ["toamna-a"] });
  await deliverAndBook();
  const order = await adminOrder(res.body.orderId);
  const vf = order.shipments[0].vendorFinancials;
  assert.equal(vf.isMixedCommission, true);
  assert.deepEqual(vf.commissionGroups.filter((g) => g.itemCount).map((g) => [g.label, g.commissionBps]), [["vendor_collection_own_sale", 500], ["campaign", 500], ["plan", 1500]]);
  assert.ok(near(vf.commissionNet, 19.5));

  // facturare: aceleași valori din ledger (vendor.earningEntries e relație în DB-ul real)
  for (const v of db.__tables.vendor) {
    v.billing = { sellerType: "company", vatStatus: "non_payer" };
    v.invoices = [];
    v.createdAt = new Date();
    v.earningEntries = (db.__tables.vendorEarningEntry || []).filter((e) => e.vendorId === v.id && e.payoutId == null);
  }
  const jwt = (await import("jsonwebtoken")).default;
  const due = await call("GET", "/api/admin/billing/vendors-due", null, ADMIN_USER, { authorization: `Bearer ${jwt.sign({ sub: "user-admin" }, process.env.JWT_SECRET)}` });
  assert.equal(due.status, 200, JSON.stringify(due.body));
  const a = due.body.items.find((i) => i.vendorId === "vendor-a");
  assert.deepEqual({ commission: r2(a.commissionNet), vendorNet: r2(a.vendorNet), entries: a.entryCount }, { commission: 19.5, vendorNet: 210.5, entries: 1 });
});

test("REG admin: refund -> earning referral / influencer afișat NET 0, REVERSED, net Artfest 0 (nu negativ)", async () => {
  const referral = await placeGuest({ items: items("b1", "b2"), vendorCollectionSlugs: vcol() });
  await deliverAndBook();
  const before = (await adminOrder(referral.body.orderId)).shipments[0].vendorReferralCommission;
  assert.deepEqual({ amount: r2(before.amount), status: before.status }, { amount: 2.4, status: "CONFIRMED" });
  await returnShipment(byVendor("vendor-b"));
  const afterOrder = await adminOrder(referral.body.orderId);
  const after = afterOrder.shipments[0].vendorReferralCommission;
  assert.deepEqual({ amount: r2(after.amount), sale: r2(after.saleAmount), refund: r2(after.refundAmount), isReversed: after.isReversed, status: after.status }, { amount: 0, sale: 2.4, refund: -2.4, isReversed: true, status: "REVERSED" });
  assert.equal(r2(afterOrder.shipments[0].vendorFinancials.netArtfestAfterAttribution), 0);

  seed();
  const influencer = await placeGuest({ items: items("b1"), referralCodes: ref(REF) });
  await deliverAndBook();
  await returnShipment(byVendor("vendor-b"));
  const inf = (await adminOrder(influencer.body.orderId)).shipments[0].influencerCommission;
  assert.deepEqual({ amount: r2(inf.amount), sale: r2(inf.saleAmount), status: inf.status }, { amount: 0, sale: 6, status: "REVERSED" });
});

test("REG admin: itemii OPTIONS / QUOTE_ONLY au orderMode, configurare și snapshot de colecție", async () => {
  addModeProducts();
  const res = await call("POST", "/api/checkout/guest/place", {
    items: [{ productId: "bopt", qty: 1, selectedOptions: { culoare: "rosu" }, customAnswers: { nume: "Ana" }, configurationKey: "cfg" }, { productId: "b2", qty: 1 }],
    ...body({ paymentMethod: "COD", vendorCollectionSlugs: vcol() }),
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const order = await adminOrder(res.body.orderId);
  const view = Object.fromEntries(order.shipments[0].items.map((i) => [i.productId, [i.orderMode, i.vendorCollectionSlugSnapshot ?? null, i.selectedOptions?.culoare ?? null]]));
  // b2 din seed nu are orderMode setat -> null; nici snapshot (în afara colecției)
  assert.deepEqual(view, { bopt: ["OPTIONS", "colectia-a", "rosu"], b2: [null, null, null] });

  const orderId = await quoteOrder({ productId: "qb", vendorUser: VENDOR_B_USER, offer: { quantity: 1, unitPrice: 100 } });
  const quoteItems = (await adminOrder(orderId)).shipments[0].items;
  assert.deepEqual(quoteItems.map((i) => [i.productId, i.orderMode, i.vendorCollectionSlugSnapshot]), [["qb", "QUOTE_ONLY", "colectia-a"]]);
});

/* ---------- influencer pe OPTIONS / QUOTE_ONLY ---------- */

test("REG influencer: OPTIONS (variantă + personalizare) prin colecția influencerului (cref) -> atribuit, earning o dată", async () => {
  addModeProducts();
  const res = await call("POST", "/api/checkout/guest/place", {
    items: [{ productId: "bopt", qty: 2, selectedOptions: { culoare: "rosu" }, customAnswers: { nume: "Ana" }, configurationKey: "cfg" }],
    ...body({ paymentMethod: "COD" }),
    influencerCollectionReferralCode: REF,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  await deliverAndBook(3);
  const b = byVendor("vendor-b");
  assert.equal(b.influencerId, "inf-1");
  const earnings = (db.__tables.influencerEarningEntry || []).filter((e) => e.shipmentId === b.id);
  assert.equal(earnings.length, 1);
  assert.ok(near(earnings[0].earningNet, 15), `${earnings[0].earningNet}`); // 200 x 15% x 50%
});

test("REG influencer: QUOTE_ONLY cerut prin ?ref= influencer -> snapshot pe cerere, Shipment.influencerId la acceptare, earning o dată", async () => {
  addModeProducts();
  await quoteOrder({ productId: "qb", vendorUser: VENDOR_B_USER, fields: { referralCodes: ref(REF), influencerReferralCode: REF }, offer: { quantity: 1, unitPrice: 100 } });
  const quote = db.__tables.quoteRequest.at(-1);
  assert.equal(quote.requestData.attributionSnapshot.influencer.influencerId, "inf-1");
  await deliverAndBook(3);
  const b = byVendor("vendor-b");
  assert.equal(b.influencerId, "inf-1");
  assert.equal(b.influencerCommissionBpsSnapshot, 5000);
  const earnings = (db.__tables.influencerEarningEntry || []).filter((e) => e.shipmentId === b.id);
  assert.equal(earnings.length, 1);
  assert.ok(near(earnings[0].earningNet, 7.5));
});
