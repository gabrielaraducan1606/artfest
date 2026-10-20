// src/routes/vendorDiscountCodeSelectedProducts.e2e.test.js
//
// Cod de reducere VENDOR „Doar anumite produse” (SELECTED_PRODUCTS),
// end-to-end pe rutele REALE de checkout (guest + user, COD + CARD):
//   POST /api/checkout/guest/place | /api/checkout/place  { discountCode }
//   -> validateDiscountCode (protecția: doar produsele selectate ALE vendorului)
//   -> prețul real (getPromotionPricingForProducts NESIMULAT aici)
//   -> atribuirea per shipment (own-sale pe vendorul codului) și ledger-ul COD / CARD.
//
// Harness copiat din vendorCollectionCheckout.e2e.test.js (Prisma in-memory,
// fără nicio conexiune la DB); singura diferență: prețurile promoționale sunt
// calculate de serviciul real, ca să vedem reducerea efectivă pe fiecare item.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/vendorDiscountCodeSelectedProducts.e2e.test.js


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
   Cod VENDOR SELECTED_PRODUCTS (vendor A): a1 selectat, a2 NU,
   b1 pe listă (rând „mutat” / străin) - protecția îl exclude.
========================================================= */

function seedSelectedCode(extra = {}) {
  db.__tables.discountCode = [{
    id: "dc-sel", code: "CANIA20", ownerType: "VENDOR", vendorId: "vendor-a", influencerId: null, scope: "SELECTED_PRODUCTS", vendorCollectionId: null,
    discountType: "PERCENT", discountPercent: 20, discountAmountCents: null, currency: "RON", minimumOrderCents: null, maxDiscountCents: null,
    fundingSource: "VENDOR", platformFundingBps: 0, vendorFundingBps: 10000, status: "ACTIVE", isActive: true, startsAt: null, endsAt: null,
    usageLimit: null, usageLimitPerUser: null, usedCount: 0, ...extra,
  }];
  db.__tables.discountCodeProduct = ["a1", "b1"].map((productId) => ({ discountCodeId: "dc-sel", productId, createdAt: new Date() }));
}

const lineOf = (productId) => (db.__tables.shipmentItem || []).find((i) => i.productId === productId);
const pick = (i) => i && ({ price: Number(i.price), discountAmount: Number(i.discountAmount || 0), vendorDiscountAmount: Number(i.vendorDiscountAmount || 0), platformDiscountAmount: Number(i.platformDiscountAmount || 0), discountCodeId: i.discountCodeId ?? null });

const redemptions = () => db.__tables.discountCodeRedemption || [];

function expectSelectedOnly() {
  assert.deepEqual(pick(lineOf("a1")), { price: 80, discountAmount: 20, vendorDiscountAmount: 20, platformDiscountAmount: 0, discountCodeId: "dc-sel" }, "a1 selectat: -20%, suportat de vendor");
  assert.equal(pick(lineOf("a2")).discountCodeId, null, "a2 neselectat: fără reducere");
  assert.equal(pick(lineOf("a2")).discountAmount, 0);
  assert.equal(pick(lineOf("b1")).discountCodeId, null, "b1 (alt magazin): fără reducere, deși e pe listă");
  assert.equal(pick(lineOf("b1")).discountAmount, 0);

  const a = byVendor("vendor-a");
  assert.equal(a.vendorReferralCommissionOverrideBps, 500, "own-sale pe vendorul codului");
  assert.ok(a.vendorReferralOwnSaleAttributedAt);
  assert.equal(a.referrerVendorId ?? null, null);

  const b = byVendor("vendor-b");
  assert.equal(b.referrerVendorId ?? null, null, "B nu primește referral de la codul lui A");
  assert.equal(b.vendorReferralCommissionOverrideBps ?? null, null);
}

test("guest COD: doar produsul selectat al vendorului e redus; neselectatul și produsul altui magazin nu", async () => {
  seedSelectedCode();
  const res = await placeGuest({ items: items("a1", "a2", "b1"), discountCode: "CANIA20" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  expectSelectedOnly();
  assert.deepEqual(redemptions().map((r) => [r.discountCodeId, r.discountAmountCents]), [["dc-sel", 2000]]);
  assert.equal(db.__tables.discountCode[0].usedCount, 1);
});

test("COD (guest) vs CARD (user): aceleași reduceri, aceeași atribuire, același comision", async () => {
  const run = async (place, paymentMethod) => {
    seed();
    seedSelectedCode();
    const res = await place({ items: items("a1", "a2", "b1"), discountCode: "CANIA20", paymentMethod });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    expectSelectedOnly();
    if (paymentMethod === "CARD") {
      assert.equal(paymentCalls.length, 1, "plata cu cardul pornită");
      await cardDeliverAndBook(res.body.orderId);
    } else {
      await deliverAndBook();
    }
    return {
      a1: pick(lineOf("a1")),
      commissionA: Number(saleOf(byVendor("vendor-a"))[0].commissionNet),
      commissionB: Number(saleOf(byVendor("vendor-b"))[0].commissionNet),
      referralEntries: (db.__tables.vendorReferralEarningEntry || []).length,
    };
  };

  const cod = await run(placeGuest, "COD");
  const card = await run(placeUser, "CARD");
  assert.deepEqual(card, cod);
  assert.equal(cod.referralEntries, 0, "fără câștig de referral (own-sale, fără cross-vendor)");
  // regula EXISTENTĂ de own-sale (pe shipment, ca la «Doar produsele mele»): 5% pe (80 + 50); B pe plan 15%
  assert.ok(near(cod.commissionA, 130 * 0.05), `${cod.commissionA}`);
  assert.ok(near(cod.commissionB, 80 * 0.15), `${cod.commissionB}`);
});

test("coș doar cu produsul altui magazin (aflat pe listă) -> cod respins (409, fail-closed), nicio comandă / utilizare", async () => {
  seedSelectedCode();
  const res = await placeGuest({ items: items("b1"), discountCode: "CANIA20" });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "discount_code_no_eligible_products");
  assert.equal(res.body.discountCodeInvalid, true);
  assert.equal(shipments().length, 0);
  assert.equal(redemptions().length, 0);
  assert.equal(db.__tables.discountCode[0].usedCount, 0);
});

test("produs mutat la alt magazin după crearea codului -> nu mai e redus de codul lui A", async () => {
  seedSelectedCode();
  const a1 = db.__tables.product.find((p) => p.id === "a1");
  a1.service = { ...a1.service, id: "svc-vendor-b", vendorId: "vendor-b" };
  a1.serviceId = "svc-vendor-b";

  const res = await placeGuest({ items: items("a1", "b2"), discountCode: "CANIA20" });
  assert.equal(res.status, 409, "a1 e acum al lui B: codul lui A nu se mai aplică nicăieri");
  assert.equal(res.body.error, "discount_code_no_eligible_products");
  assert.equal(shipments().length, 0);
  assert.equal(redemptions().length, 0);

  // același coș, cu a2 (încă al lui A, dar neselectat) -> tot respins
  const again = await placeGuest({ items: items("a1", "a2"), discountCode: "CANIA20" });
  assert.equal(again.status, 409);
});

test("cod inactiv / expirat -> ignorat, fără reducere", async () => {
  seedSelectedCode({ isActive: false, status: "DISABLED" });
  const res = await placeGuest({ items: items("a1"), discountCode: "CANIA20" });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "discount_code_inactive");
  assert.equal(redemptions().length, 0);

  seed();
  seedSelectedCode({ endsAt: new Date(Date.now() - 86400000) });
  const expired = await placeGuest({ items: items("a1"), discountCode: "CANIA20" });
  assert.equal(expired.status, 409);
  assert.equal(expired.body.error, "discount_code_expired");
  assert.equal(redemptions().length, 0);
});

test("limita per client (usageLimitPerUser 1): a doua comandă cu același email e respinsă", async () => {
  seedSelectedCode({ usageLimitPerUser: 1 });
  assert.equal((await placeGuest({ items: items("a1"), discountCode: "CANIA20" })).status, 200);
  assert.equal(redemptions().length, 1);
  const second = await placeGuest({ items: items("a1"), discountCode: "CANIA20" });
  assert.equal(second.status, 409);
  assert.equal(second.body.error, "discount_code_usage_limit_per_user_reached");
  assert.equal(redemptions().length, 1);
});
