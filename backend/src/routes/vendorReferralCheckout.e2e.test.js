// src/routes/vendorReferralCheckout.e2e.test.js
//
// VENDOR REFERRAL request-based, end-to-end pe rutele REALE de checkout:
//   POST /api/checkout/guest/place | /api/checkout/place
//     { referralCodes: [{ code, at }], vendorReferralCode, influencerCollectionReferralCode }
//   -> services/referralAttribution.js (validare server-side, cel mai recent cod valid pe tip)
//   -> resolveShipmentPromoter -> buildShipmentAttributionFields -> Shipment
//   -> ledger (own-sale 5% / referral cross-vendor), o singură dată
//
// FĂRĂ /api/public/vendor-referral/attribution, fără token, fără VendorReferralClick.
// Regulile financiare și prioritățile EXISTENTE sunt verificate, nu schimbate.
// Harness identic cu influencerReferralCheckout.e2e.test.js.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/vendorReferralCheckout.e2e.test.js

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
  const find = (where) => rows.find((r) => matchesWhere(r, where));
  return {
    findMany: async ({ where, take, skip, orderBy } = {}) => {
      let out = rows.filter((r) => matchesWhere(r, where));
      if (orderBy && !Array.isArray(orderBy)) {
        const [[k, dir]] = Object.entries(orderBy);
        if (typeof dir === "string") out = [...out].sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (dir === "desc" ? -1 : 1));
      }
      if (skip) out = out.slice(skip);
      if (take) out = out.slice(0, take);
      return out.map((r) => ({ ...r }));
    },
    findFirst: async ({ where, include } = {}) => {
      const r = find(where);
      return r ? withIncludes(name, { ...r }, include) : null;
    },
    findUnique: async ({ where, include } = {}) => {
      const r = find(where);
      return r ? withIncludes(name, { ...r }, include) : null;
    },
    count: async ({ where } = {}) => rows.filter((r) => matchesWhere(r, where)).length,
    create: async ({ data }) => {
      const row = { id: data.id || nextId(name), createdAt: new Date(), updatedAt: new Date(), ...stripRelations(data) };
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
    aggregate: async () => ({ _sum: {}, _count: { _all: 0 } }),
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
  const actualPromo = await import("../services/productPromotionPrice.js");
  reg("../services/productPromotionPrice.js", {
    namedExports: { ...actualPromo, getPromotionPricingForProducts: async () => new Map() },
  });

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
   Seed
========================================================= */

const REF = "teo-31b637";
const inAYear = () => new Date(Date.now() + 365 * 86400000);

function seed() {
  db = makeDb();
  currentUser = null;
  paymentCalls = [];
  const t = db.__tables;

  const influencer = (id, referralCode, extra = {}) => ({
    id,
    referralCode,
    status: "ACTIVE",
    commissionBps: 5000,
    createdAt: new Date(),
    collaborationEndOverride: inAYear(),
    displayName: id,
    ...extra,
  });

  t.influencerProfile = [
    influencer("inf-1", REF, { userId: "user-inf-1" }),
    influencer("inf-2", "ana-codul"),
    influencer("inf-inactive", "inactiv-cod", { status: "DISABLED" }),
    influencer("inf-expired", "expirat-cod", { collaborationEndOverride: new Date(Date.now() - 86400000), createdAt: new Date(Date.now() - 400 * 86400000) }),
    influencer("inf-zero", "zero-cod", { commissionBps: 0 }),
  ];

  const stripeReady = {
    stripeAccountId: "acct_x",
    stripeChargesEnabled: true,
    stripePayoutsEnabled: true,
    stripeDetailsSubmitted: true,
    stripeConnectStatus: "enabled",
  };

  t.vendor = [
    { id: "vendor-a", userId: "user-vendor-a", referralCode: "atelier-a", referralCommissionBps: 0, displayName: "Atelier A", isActive: true, email: "a@t.ro", user: { email: "a@t.ro" }, ...stripeReady },
    { id: "vendor-b", referralCode: "atelier-b", referralCommissionBps: 0, displayName: "Atelier B", isActive: true, email: "b@t.ro", user: { email: "b@t.ro" }, ...stripeReady },
    { id: "vendor-off", referralCode: "atelier-off", referralCommissionBps: 0, displayName: "Atelier inactiv", isActive: false, email: "c@t.ro", user: { email: "c@t.ro" }, ...stripeReady },
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

  t.product = [product("p-a1", "vendor-a", 10000), product("p-a2", "vendor-a", 5000), product("p-b1", "vendor-b", 8000)];
  t.user = [
    { id: "user-1", email: "client@t.ro", name: "Client" },
    { id: "user-vendor-a", email: "owner-a@t.ro", name: "Owner A" },
    { id: "user-inf-1", email: "teo@t.ro", name: "Teo" },
  ];
  t.vendorCampaign = [
    { id: "camp-b", vendorId: "vendor-b", slug: "toamna-b", isActive: true, scope: "ALL_PRODUCTS", discountPercent: 20, platformFundingBps: 0, vendorFundingBps: 10000, fundingSource: "VENDOR", startsAt: null, endsAt: null, vendor: { isActive: true }, products: [] },
    { id: "camp-a", vendorId: "vendor-a", slug: "toamna-a", isActive: true, scope: "ALL_PRODUCTS", discountPercent: 15, platformFundingBps: 0, vendorFundingBps: 10000, fundingSource: "VENDOR", startsAt: null, endsAt: null, vendor: { isActive: true }, products: [] },
  ];
  t.vendorCollection = [{ id: "vcol-b", vendorId: "vendor-b", slug: "colectia-b", isActive: true }];
  t.vendorCollectionItem = [];
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

function body({ email, paymentMethod, referralCode, token, discountCode, referralCodes, vendorReferralCode, collectionCode, vendorToken, campaignTokens, vendorCollectionToken }) {
  return {
    address: email ? { ...ADDRESS, email } : ADDRESS,
    customerType: "PF",
    paymentMethod,
    selections: SELECTIONS,
    consents: { terms: true, returns: true },
    ...(referralCode !== undefined ? { influencerReferralCode: referralCode } : {}),
    ...(token !== undefined ? { influencerAttribution: token } : {}),
    ...(discountCode ? { discountCode } : {}),
    ...(referralCodes !== undefined ? { referralCodes } : {}),
    ...(vendorReferralCode !== undefined ? { vendorReferralCode } : {}),
    ...(collectionCode !== undefined ? { influencerCollectionReferralCode: collectionCode } : {}),
    ...(vendorToken !== undefined ? { vendorReferralAttribution: vendorToken } : {}),
    ...(campaignTokens ? { campaignAttribution: campaignTokens } : {}),
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

const shipments = () => (db.__tables.shipment || []).filter((s) => s.direction !== "RETURN");

function expectAttributed(s, influencerId = "inf-1", code = REF) {
  assert.equal(s.influencerId, influencerId);
  assert.equal(s.influencerReferralCodeSnapshot, code);
  assert.equal(s.influencerCommissionBpsSnapshot, 5000);
  assert.ok(s.influencerAttributedAt instanceof Date);
}

function expectNotAttributed(s) {
  assert.equal(s.influencerId ?? null, null);
  assert.equal(s.influencerReferralCodeSnapshot ?? null, null);
  assert.equal(s.influencerCommissionBpsSnapshot ?? null, null);
}

beforeEach(seed);

/* =========================================================
   Teste
========================================================= */

const ref = (code, at = Date.now()) => [{ code, at }];
const byVendor = (vendorId) => shipments().filter((s) => s.vendorId === vendorId);
const approx = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-6;

function expectOwnSale(s) {
  assert.equal(s.vendorReferralCommissionOverrideBps, 500, "own-sale 5%");
  assert.ok(s.vendorReferralOwnSaleAttributedAt);
  assert.equal(s.referrerVendorId ?? null, null, "fără referral către același vendor");
  assert.equal(s.influencerId ?? null, null);
}

function expectCrossVendor(s, { from = "vendor-a", code = "atelier-a", bps = 2000 } = {}) {
  assert.equal(s.referrerVendorId, from);
  assert.equal(s.referrerVendorReferralCodeSnapshot, code);
  assert.equal(s.referrerVendorCommissionBpsSnapshot, bps);
  assert.ok(s.referrerVendorAttributedAt);
  assert.equal(s.vendorReferralCommissionOverrideBps ?? null, null, "cross-vendor NU primește 5%");
  assert.equal(s.influencerId ?? null, null);
}

function expectNoVendorReferral(s) {
  assert.equal(s.referrerVendorId ?? null, null);
  assert.equal(s.vendorReferralCommissionOverrideBps ?? null, null);
}

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

function saleFor(vendorId) {
  const s = byVendor(vendorId)[0];
  const rows = (db.__tables.vendorEarningEntry || []).filter((e) => e.shipmentId === s.id);
  assert.equal(rows.length, 1, `un singur SALE pentru ${vendorId}`);
  return rows[0];
}

/* ---------- guest / user, COD / CARD, own-sale / cross-vendor ---------- */

test("guest COD, own-sale (cod vendor A, produs A) -> 5%, fără VendorReferralClick", async () => {
  const res = await placeGuest({ items: [{ productId: "p-a1", qty: 1 }], referralCodes: ref("atelier-a") });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  expectOwnSale(byVendor("vendor-a")[0]);
  assert.equal((db.__tables.vendorReferralClick || []).length, 0);
});

test("guest CARD, cross-vendor (cod A, produs B) -> referral A (2000 bps), B fără 5%", async () => {
  const res = await placeGuest({ items: [{ productId: "p-b1", qty: 1 }], paymentMethod: "CARD", referralCodes: ref("atelier-a") });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(paymentCalls.length, 1);
  expectCrossVendor(byVendor("vendor-b")[0]);
});

test("user COD, own-sale -> 5%", async () => {
  const res = await placeUser({ items: [{ productId: "p-a2", qty: 1 }], paymentMethod: "COD", referralCodes: ref("atelier-a") });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  expectOwnSale(byVendor("vendor-a")[0]);
});

test("user CARD, cross-vendor -> referral A", async () => {
  const res = await placeUser({ items: [{ productId: "p-b1", qty: 1 }], paymentMethod: "CARD", referralCodes: ref("atelier-a") });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(paymentCalls.length, 1);
  expectCrossVendor(byVendor("vendor-b")[0]);
});

test("compatibilitate: doar câmpul simplu vendorReferralCode -> aceeași atribuire", async () => {
  await placeGuest({ items: [{ productId: "p-b1", qty: 1 }], vendorReferralCode: "atelier-a" });
  expectCrossVendor(byVendor("vendor-b")[0]);
});

test("multi-vendor: shipment A own-sale 5%, shipment B cross-vendor - tratate separat", async () => {
  const res = await placeGuest({ items: [{ productId: "p-a1", qty: 1 }, { productId: "p-b1", qty: 1 }], referralCodes: ref("atelier-a") });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  expectOwnSale(byVendor("vendor-a")[0]);
  expectCrossVendor(byVendor("vendor-b")[0]);
});

/* ---------- validare ---------- */

test("vendor inactiv / cod invalid / cod manipulat -> ignorat, comanda trece", async () => {
  for (const code of ["atelier-off", "nu-exista", "ATELIER-A", "atelier-", "atelier-a OR 1=1", "x".repeat(65), " ", 12345]) {
    seed();
    const res = await placeGuest({ items: [{ productId: "p-b1", qty: 1 }], referralCodes: [{ code, at: Date.now() }], vendorReferralCode: code });
    assert.equal(res.status, 200, `${code}: ${JSON.stringify(res.body)}`);
    expectNoVendorReferral(byVendor("vendor-b")[0]);
  }
});

test("procentul setat de admin intră în snapshot (regulă neschimbată)", async () => {
  db.__tables.vendor.find((v) => v.id === "vendor-a").referralCommissionBps = 1000;
  await placeGuest({ items: [{ productId: "p-b1", qty: 1 }], referralCodes: ref("atelier-a") });
  expectCrossVendor(byVendor("vendor-b")[0], { bps: 1000 });
});

/* ---------- priorități (identice cu tokenurile vechi) ---------- */

test("influencer + vendor valide simultan (vendor mai recent) -> influencerul câștigă (tie-break existent)", async () => {
  const now = Date.now();
  await placeGuest({
    items: [{ productId: "p-a1", qty: 1 }, { productId: "p-b1", qty: 1 }],
    referralCodes: [{ code: "atelier-a", at: now }, { code: REF, at: now - 1000 }],
  });
  for (const s of shipments()) {
    assert.equal(s.influencerId, "inf-1");
    expectNoVendorReferral(s);
  }
});

test("link vendor, apoi colecție de influencer fără ?ref= -> influencerul colecției câștigă (ca înainte)", async () => {
  await placeGuest({ items: [{ productId: "p-b1", qty: 1 }], referralCodes: ref("atelier-a"), collectionCode: REF });
  const s = byVendor("vendor-b")[0];
  assert.equal(s.influencerId, "inf-1");
  expectNoVendorReferral(s);
});

test("cod de reducere al influencerului bate vendor referral (prioritate neschimbată)", async () => {
  db.__tables.discountCode = [
    {
      id: "dc-ana", code: "ANA10", ownerType: "INFLUENCER", influencerId: "inf-2", vendorId: null, scope: "ALL_PRODUCTS",
      discountType: "PERCENT", discountPercent: 10, discountAmountCents: null, currency: "RON", minimumOrderCents: null,
      maxDiscountCents: null, fundingSource: "PLATFORM", platformFundingBps: 10000, vendorFundingBps: 0, status: "ACTIVE",
      isActive: true, startsAt: null, endsAt: null, usageLimit: null, usageLimitPerUser: null, usedCount: 0,
    },
  ];
  const res = await placeGuest({ items: [{ productId: "p-b1", qty: 1 }], referralCodes: ref("atelier-a"), discountCode: "ANA10" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const s = byVendor("vendor-b")[0];
  assert.equal(s.influencerId, "inf-2");
  expectNoVendorReferral(s);
});

test("campanie vendor B + referral cross-vendor A -> coexistă (campania pe B, referral A)", async () => {
  const { signCampaignAttributionToken } = await import("../services/campaignAttributionToken.js");
  const campaignTokens = { "vendor-b": signCampaignAttributionToken({ campaignId: "camp-b", vendorId: "vendor-b", slug: "toamna-b", attributionWindowHours: 168 }) };

  await placeGuest({ items: [{ productId: "p-b1", qty: 1 }], referralCodes: ref("atelier-a"), campaignTokens });
  const s = byVendor("vendor-b")[0];
  assert.equal(s.campaignId, "camp-b");
  assert.equal(s.campaignCommissionBps, 500);
  expectCrossVendor(s);
});

test("own-sale + campania proprie -> campaignId pe shipment, dar comisionul rămâne own-sale 5% pe tot shipment-ul", async () => {
  const { signCampaignAttributionToken } = await import("../services/campaignAttributionToken.js");
  const campaignTokens = { "vendor-a": signCampaignAttributionToken({ campaignId: "camp-a", vendorId: "vendor-a", slug: "toamna-a", attributionWindowHours: 168 }) };

  await placeGuest({ items: [{ productId: "p-a1", qty: 1 }, { productId: "p-a2", qty: 1 }], referralCodes: ref("atelier-a"), campaignTokens });
  const s = byVendor("vendor-a")[0];
  assert.equal(s.campaignId, "camp-a");
  expectOwnSale(s);

  await deliverAndBook();
  assert.ok(approx(saleFor("vendor-a").commissionNet, 150 * 0.05), "own-sale 5% are prioritate față de campanie");
});

test("colecție vendor vs referral: câștigă cel mai recent (regula existentă „global last click wins”)", async () => {
  const { signVendorCollectionAttributionToken } = await import("../services/vendorCollectionAttributionToken.js");
  const vendorCollectionToken = signVendorCollectionAttributionToken({ collectionId: "vcol-b", ownerVendorId: "vendor-b" });

  // regula (a): colecția atribuie doar produse membre -> p-a1 e în colecția lui B
  db.__tables.vendorCollectionItem.push({ collectionId: "vcol-b", productId: "p-a1" });

  // referral capturat ÎNAINTE de vizita colecției -> colecția (B) câștigă -> referral B pe shipment A
  await placeGuest({ items: [{ productId: "p-a1", qty: 1 }], referralCodes: ref("atelier-a", Date.now() - 60_000), vendorCollectionToken });
  expectCrossVendor(byVendor("vendor-a")[0], { from: "vendor-b", code: "COLLECTION:colectia-b" });

  // referral capturat DUPĂ vizita colecției -> ?ref= (A) câștigă -> own-sale pe A
  seed();
  db.__tables.vendorCollectionItem.push({ collectionId: "vcol-b", productId: "p-a1" });
  const token2 = signVendorCollectionAttributionToken({ collectionId: "vcol-b", ownerVendorId: "vendor-b" });
  await new Promise((r) => setTimeout(r, 1100));
  await placeGuest({ items: [{ productId: "p-a1", qty: 1 }], referralCodes: ref("atelier-a", Date.now()), vendorCollectionToken: token2 });
  expectOwnSale(byVendor("vendor-a")[0]);
});

/* ---------- tranziție ---------- */

test("tranziție: tokenul vechi de vendor e acceptat doar dacă nu vine niciun cod valid", async () => {
  const { signVendorReferralAttributionToken } = await import("../services/vendorAttributionToken.js");
  const legacy = signVendorReferralAttributionToken({ vendorId: "vendor-b", referralCode: "atelier-b" });

  await placeGuest({ items: [{ productId: "p-a1", qty: 1 }], vendorToken: legacy });
  expectCrossVendor(byVendor("vendor-a")[0], { from: "vendor-b", code: "atelier-b" });

  seed();
  await placeGuest({ items: [{ productId: "p-a1", qty: 1 }], referralCodes: ref("atelier-a"), vendorToken: legacy });
  expectOwnSale(byVendor("vendor-a")[0]);
});

/* ---------- earning ---------- */

test("earning: own-sale 5% fără VendorReferralEarningEntry; cross-vendor = plan 15% + referral A o singură dată", async () => {
  await placeGuest({ items: [{ productId: "p-a1", qty: 1 }, { productId: "p-b1", qty: 1 }], referralCodes: ref("atelier-a") });
  await deliverAndBook(3);

  const saleA = saleFor("vendor-a");
  const saleB = saleFor("vendor-b");
  assert.ok(approx(Number(saleA.commissionNet) / Number(saleA.itemsNet), 0.05), "own-sale 5%");
  assert.ok(approx(Number(saleB.commissionNet) / Number(saleB.itemsNet), 0.15), "cross-vendor: comisionul planului");

  const referral = db.__tables.vendorReferralEarningEntry || [];
  assert.equal(referral.length, 1, "o singură intrare de referral");
  assert.equal(referral[0].shipmentId, byVendor("vendor-b")[0].id);
  assert.ok(approx(referral[0].earningNet, (Number(saleB.commissionNet) * 2000) / 10000));
});

/* ---------- self-referral ---------- */

test("self-referral: vendorul A logat cumpără de la B prin propriul cod -> fără referral / earning către sine", async () => {
  const res = await placeUser({ userId: "user-vendor-a", items: [{ productId: "p-b1", qty: 1 }], referralCodes: ref("atelier-a") });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  expectNoVendorReferral(byVendor("vendor-b")[0]);

  await deliverAndBook();
  assert.equal((db.__tables.vendorReferralEarningEntry || []).length, 0);
});

test("self-referral: guest cu emailul CONTULUI vendorului A -> fără referral către sine", async () => {
  for (const email of ["owner-a@t.ro", "OWNER-A@t.ro"]) {
    seed();
    const res = await placeGuest({ email, items: [{ productId: "p-b1", qty: 1 }], referralCodes: ref("atelier-a") });
    assert.equal(res.status, 200, `${email}: ${JSON.stringify(res.body)}`);
    expectNoVendorReferral(byVendor("vendor-b")[0]);
  }
});

test("guest cu emailul PUBLIC / de contact al vendorului A (nu emailul contului) -> referral permis", async () => {
  // Vendor.email (a@t.ro) e emailul public al magazinului, nu al contului (owner-a@t.ro)
  const res = await placeGuest({ email: "a@t.ro", items: [{ productId: "p-b1", qty: 1 }], referralCodes: ref("atelier-a") });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  expectCrossVendor(byVendor("vendor-b")[0]);

  await deliverAndBook();
  assert.equal((db.__tables.vendorReferralEarningEntry || []).length, 1, "earning-ul lui A se creează");
});

test("cazul real: emailul public al lui A = emailul CONTULUI lui B -> comanda la B păstrează referral-ul către A", async () => {
  // B are cont propriu; A și-a pus ca email public exact emailul contului lui B
  db.__tables.user.push({ id: "user-vendor-b", email: "owner-b@t.ro", name: "Owner B" });
  db.__tables.vendor.find((v) => v.id === "vendor-b").userId = "user-vendor-b";
  db.__tables.vendor.find((v) => v.id === "vendor-a").email = "owner-b@t.ro";

  const res = await placeGuest({ email: "owner-b@t.ro", items: [{ productId: "p-b1", qty: 1 }], referralCodes: ref("atelier-a") });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  expectCrossVendor(byVendor("vendor-b")[0]);
});

test("self-referral: own-sale pe propriile produse rămâne conform regulii existente (5%), fără earning de referral", async () => {
  await placeUser({ userId: "user-vendor-a", items: [{ productId: "p-a1", qty: 1 }], referralCodes: ref("atelier-a") });
  expectOwnSale(byVendor("vendor-a")[0]);

  await deliverAndBook();
  assert.equal((db.__tables.vendorReferralEarningEntry || []).length, 0);
});

test("self-referral: codul propriu exclus -> trece la următorul promotor valid (prioritățile rămân)", async () => {
  // vendorul A (logat) are în navigare și un link de influencer -> influencerul rămâne atribuit
  await placeUser({ userId: "user-vendor-a", items: [{ productId: "p-b1", qty: 1 }], referralCodes: [{ code: "atelier-a", at: Date.now() }, { code: REF, at: Date.now() - 1000 }] });
  const s = byVendor("vendor-b")[0];
  assert.equal(s.influencerId, "inf-1");
  expectNoVendorReferral(s);
});

test("cumpărător normal (logat și guest) rămâne atribuit corect vendorului A", async () => {
  await placeUser({ userId: "user-1", items: [{ productId: "p-b1", qty: 1 }], referralCodes: ref("atelier-a") });
  expectCrossVendor(byVendor("vendor-b")[0]);

  seed();
  await placeGuest({ email: "client-nou@t.ro", items: [{ productId: "p-b1", qty: 1 }], referralCodes: ref("atelier-a") });
  expectCrossVendor(byVendor("vendor-b")[0]);
});
