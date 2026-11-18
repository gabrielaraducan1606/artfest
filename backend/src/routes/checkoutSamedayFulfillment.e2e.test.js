// src/routes/checkoutSamedayFulfillment.e2e.test.js
//
// Etapa 3 - „Sameday prin Artfest” vs „Curierul magazinului” la checkout, end-to-end pe
// rutele REALE /api/checkout/quote, /guest/quote, /place, /guest/place:
//   - preselectarea Sameday (client autentificat + guest), alegerea per magazin;
//   - plasare cu card: Shipment.fulfillment salvat per expediere, prețul Sameday;
//   - ramburs + Sameday -> refuzat ÎNAINTE de comandă; coș cu vânzător fără Stripe;
//   - Sameday indisponibil / tarif schimbat la plasare -> 409, nicio comandă;
//   - corp vechi (fără fulfillment) -> exact comportamentul de până acum.
// FĂRĂ DB real, FĂRĂ Stripe, FĂRĂ Sameday (disponibilitate, catalog, tarif simulate).
// Harness preluat din checkoutRecovery.e2e.test.js.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/checkoutSamedayFulfillment.e2e.test.js

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
let paymentShouldFail = false;
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
  // mailer simulat complet: toate funcțiile send* sunt no-op, iar makeTransport e blocat -
  // niciun email (Resend / SMTP) nu poate pleca din test, indiferent de .env
  const mailerStub = Object.fromEntries(
    Object.entries(actualMailer).map(([name, value]) => [
      name,
      name === "makeTransport"
        ? () => { throw new Error("mailer transport blocat în test"); }
        : typeof value === "function" && name.startsWith("send")
          ? async () => {}
          : value,
    ])
  );
  reg("../lib/mailer.js", {
    namedExports: { ...mailerStub, sendOrderConfirmationEmail: async () => {}, sendVendorNewOrderEmail: async () => {} },
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
        if (paymentShouldFail) throw new Error("stripe_unreachable");
        return { provider: "stripe", redirectUrl: "https://checkout.stripe.test/x" };
      },
    },
  });
  const actualPromo = await import("../services/productPromotionPrice.js");
  reg("../services/productPromotionPrice.js", {
    namedExports: { ...actualPromo, getPromotionPricingForProducts: async () => new Map() },
  });

  // Sameday prin Artfest: disponibilitatea per magazin, catalogul și tariful - simulate
  const actualStoreDelivery = await import("../services/shipping/samedayStoreDelivery.js");
  reg("../services/shipping/samedayStoreDelivery.js", {
    namedExports: { ...actualStoreDelivery, checkoutSamedayAvailability: async ({ groups }) => availabilityFor(groups) },
  });
  const actualCatalog = await import("../services/shipping/deliveryCatalog.js");
  reg("../services/shipping/deliveryCatalog.js", { namedExports: { ...actualCatalog, deliveryCatalog: () => fakeCatalog } });
  const actualPricer = await import("../services/shipping/samedayCheckoutPricer.js");
  reg("../services/shipping/samedayCheckoutPricer.js", { namedExports: { ...actualPricer, getPrimaryShippingPricer: () => fakePricer } });

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
   Sameday simulat
========================================================= */

let samedayStores = new Set(); // magazinele cu opțiunea activă
let samedayPriceCents = 1890;
let samedayFails = false;
let pricerCalls = 0;

const stripeOk = (v) =>
  Boolean(v?.stripeAccountId) && v.stripeChargesEnabled === true && v.stripePayoutsEnabled === true && v.stripeDetailsSubmitted === true && v.stripeConnectStatus === "enabled";

function availabilityFor(groups) {
  if (!samedayStores.size) return { offered: false, cartCardCapable: false, reasons: ["feature_flag_off"], byService: {} };
  const vendorIds = [...new Set(groups.map((g) => String(g.vendorId)))];
  const cartCardCapable = vendorIds.every((id) => stripeOk(db.__tables.vendor.find((v) => v.id === id)));
  const byService = {};
  for (const g of groups) {
    if (!samedayStores.has(String(g.serviceId))) continue;
    byService[String(g.serviceId)] = cartCardCapable
      ? { offered: true, available: true, reason: null, message: null }
      : { offered: true, available: false, reason: "cart_not_card_capable", message: "plata cu cardul indisponibilă" };
  }
  return { offered: true, cartCardCapable, reasons: [], byService };
}

const offline = async () => {
  throw new Error("nomenclator offline");
};
const fakeCatalog = {
  getServices: async () => ({ courierAvailable: true, services: { HOME: { id: 7 }, LOCKER: { id: 15 }, PUDO: { id: 16 } } }),
  counties: offline,
  findCounty: offline,
  cities: offline,
  findCity: offline,
  findOoh: async () => null,
  findOohFresh: async () => ({ loc: null, source: "live" }),
};
async function fakePricer() {
  pricerCalls += 1;
  if (samedayFails) throw new Error("timeout");
  return { amountCents: samedayPriceCents, carrierCostCents: samedayPriceCents, source: "SAMEDAY" };
}

/* =========================================================
   Seed
========================================================= */

const STRIPE_READY = { stripeAccountId: "acct_x", stripeChargesEnabled: true, stripePayoutsEnabled: true, stripeDetailsSubmitted: true, stripeConnectStatus: "enabled" };
const inAYear = () => new Date(Date.now() + 365 * 86400000);

function seed() {
  db = makeDb();
  currentUser = null;
  paymentCalls = [];
  paymentShouldFail = false;
  samedayStores = new Set(["svc-vendor-a"]);
  samedayPriceCents = 1890;
  samedayFails = false;
  pricerCalls = 0;
  const t = db.__tables;
  t.vendor = [
    { id: "vendor-a", displayName: "Atelier A", isActive: true, email: "a@t.ro", user: { email: "a@t.ro" }, ...STRIPE_READY },
    { id: "vendor-b", displayName: "Atelier B", isActive: true, email: "b@t.ro", user: { email: "b@t.ro" }, ...STRIPE_READY },
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
  t.product = [product("p-a1", "vendor-a", 10000), product("p-b1", "vendor-b", 8000)];
  t.user = [{ id: "user-1", email: "client@t.ro", name: "Client" }];
  t.vendorCampaign = [];
  t.vendorCollection = [];
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

beforeEach(() => seed());

const ADDRESS = { firstName: "Ana", lastName: "Pop", phone: "0722000000", email: "ana@t.ro", county: "Cluj", city: "Cluj-Napoca", postalCode: "400000", street: "Str. Test 1" };
const ITEMS = [
  { productId: "p-a1", qty: 1 },
  { productId: "p-b1", qty: 1 },
];
const SAMEDAY_A = { "svc-vendor-a": { fulfillment: "ARTFEST_SAMEDAY", method: "HOME", expectedShippingCents: 1890 }, "svc-vendor-b": { fulfillment: "VENDOR_COURIER", expectedShippingCents: 1500 } };

const orders = () => db.__tables.order || [];
const shipments = () => (db.__tables.shipment || []).filter((s) => s.direction !== "RETURN");
const shipmentOf = (vendorId) => shipments().find((s) => s.vendorId === vendorId);

async function post(path, payload) {
  const res = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  return { status: res.status, body: await res.json() };
}
function fillUserCart(items = ITEMS, userId = "user-1") {
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
}
const placeBody = ({ paymentMethod, selections }) => ({ address: ADDRESS, customerType: "PF", paymentMethod, selections, consents: { terms: true, returns: true } });
async function placeUser({ paymentMethod = "CARD", selections = SAMEDAY_A, items = ITEMS } = {}) {
  fillUserCart(items);
  return post("/api/checkout/place", placeBody({ paymentMethod, selections }));
}
const placeGuest = ({ paymentMethod = "CARD", selections = SAMEDAY_A, items = ITEMS } = {}) => post("/api/checkout/guest/place", { items, ...placeBody({ paymentMethod, selections }) });

/* =========================================================
   Quote
========================================================= */

for (const [who, run] of [
  ["autentificat", () => (fillUserCart(), post("/api/checkout/quote", { address: ADDRESS, selections: {} }))],
  ["guest", () => post("/api/checkout/guest/quote", { address: ADDRESS, selections: {}, items: ITEMS })],
]) {
  test(`quote (${who}): Sameday preselectat doar la magazinul cu opțiunea activă; ambele prețuri; fără date interne`, async () => {
    const res = await run();
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const a = res.body.shipments.find((s) => s.serviceId === "svc-vendor-a");
    const b = res.body.shipments.find((s) => s.serviceId === "svc-vendor-b");
    assert.equal(a.selectedFulfillment, "ARTFEST_SAMEDAY");
    assert.equal(a.preselected, true);
    assert.equal(a.price, 18.9);
    assert.equal(a.fulfillmentOptions.VENDOR_COURIER.price, 15);
    assert.equal(b.selectedFulfillment, "VENDOR_COURIER");
    assert.equal(b.fulfillmentOptions.ARTFEST_SAMEDAY, undefined);
    assert.equal(res.body.requiresCard, true);
    assert.equal(res.body.totalShipping, 33.9);
    assert.ok(res.body.shipments.every((s) => !("delivery" in s)), "snapshot-ul intern nu ajunge la client");
  });
}

test("quote: alegerea manuală a curierului magazinului rămâne după recalculare", async () => {
  fillUserCart();
  const res = await post("/api/checkout/quote", { address: ADDRESS, selections: { "svc-vendor-a": { fulfillment: "VENDOR_COURIER" } } });
  const a = res.body.shipments.find((s) => s.serviceId === "svc-vendor-a");
  assert.equal(a.selectedFulfillment, "VENDOR_COURIER");
  assert.equal(a.price, 15);
  assert.equal(res.body.requiresCard, false);
});

test("quote: Sameday oprit -> răspuns fără opțiunea Sameday, prețurile magazinelor ca înainte", async () => {
  samedayStores = new Set();
  const res = await post("/api/checkout/guest/quote", { address: ADDRESS, selections: {}, items: ITEMS });
  assert.equal(res.status, 200);
  assert.ok(res.body.shipments.every((s) => s.price === 15 && !s.fulfillmentOptions.ARTFEST_SAMEDAY && s.fulfillment === null));
  assert.equal(pricerCalls, 0);
});

/* =========================================================
   Plasare
========================================================= */

test("plasare CARD (autentificat): Shipment.fulfillment per magazin, transport Sameday 18,90 + curier 15, plata inițiată", async () => {
  const res = await placeUser();
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(paymentCalls.length, 1);
  assert.equal(shipmentOf("vendor-a").fulfillment, "ARTFEST_SAMEDAY");
  assert.equal(Number(shipmentOf("vendor-a").price), 18.9);
  assert.equal(shipmentOf("vendor-b").fulfillment, "VENDOR_COURIER");
  assert.equal(Number(shipmentOf("vendor-b").price), 15);
  assert.equal(orders()[0].paymentMethod, "CARD");
});

test("plasare CARD (guest): Sameday salvat pe expediere, acces guest păstrat", async () => {
  const res = await placeGuest();
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.guestAccessToken);
  assert.equal(shipmentOf("vendor-a").fulfillment, "ARTFEST_SAMEDAY");
  assert.equal(Number(shipmentOf("vendor-a").price), 18.9);
});

test("ramburs + Sameday prin Artfest -> 400 ÎNAINTE de comandă (autentificat + guest); coșul rămâne", async () => {
  const user = await placeUser({ paymentMethod: "COD" });
  assert.equal(user.status, 400, JSON.stringify(user.body));
  assert.equal(user.body.error, "sameday_requires_card");
  assert.equal(user.body.serviceId, "svc-vendor-a");
  assert.equal(db.__tables.cartItem.length, 2);
  const guest = await placeGuest({ paymentMethod: "COD" });
  assert.equal(guest.body.error, "sameday_requires_card");
  assert.equal(orders().length, 0);
  assert.equal(paymentCalls.length, 0);
});

test("ramburs cu curierul magazinului la toate magazinele -> permis, ca înainte", async () => {
  const res = await placeUser({
    paymentMethod: "COD",
    selections: { "svc-vendor-a": { fulfillment: "VENDOR_COURIER", expectedShippingCents: 1500 }, "svc-vendor-b": { fulfillment: "VENDOR_COURIER", expectedShippingCents: 1500 } },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(orders()[0].paymentMethod, "COD");
  assert.ok(shipments().every((s) => s.fulfillment === "VENDOR_COURIER"));
});

test("Sameday devenit indisponibil între quote și plasare -> 409, nicio comandă, nicio schimbare tăcută", async () => {
  samedayStores = new Set();
  const res = await placeUser();
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.error, "sameday_unavailable");
  assert.equal(res.body.serviceId, "svc-vendor-a");
  assert.equal(orders().length, 0);
});

test("tarif Sameday indisponibil (timeout) la plasare -> 409, fără tariful magazinului în loc", async () => {
  samedayFails = true;
  const res = await placeGuest();
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.error, "sameday_price_unavailable");
  assert.equal(orders().length, 0);
});

test("tarif schimbat între quote și plasare -> 409 cu noul preț; plasarea cu prețul nou reușește", async () => {
  samedayPriceCents = 2190;
  const res = await placeUser();
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.error, "shipping_price_changed");
  assert.equal(res.body.price, 21.9);
  assert.equal(orders().length, 0);
  const again = await placeUser({ selections: { ...SAMEDAY_A, "svc-vendor-a": { ...SAMEDAY_A["svc-vendor-a"], expectedShippingCents: 2190 } } });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(Number(shipmentOf("vendor-a").price), 21.9);
});

test("preț manipulat de client (transport 0,01) -> 409; serverul nu acceptă prețul trimis", async () => {
  const res = await placeGuest({ selections: { ...SAMEDAY_A, "svc-vendor-a": { fulfillment: "ARTFEST_SAMEDAY", expectedShippingCents: 1 } } });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "shipping_price_changed");
  assert.equal(orders().length, 0);
});

test("coș mixt cu vânzător fără Stripe: Sameday nu se poate alege (quote) și e refuzat la plasare", async () => {
  db.__tables.vendor.find((v) => v.id === "vendor-b").stripeConnectStatus = "pending";
  const q = await post("/api/checkout/guest/quote", { address: ADDRESS, selections: {}, items: ITEMS });
  const a = q.body.shipments.find((s) => s.serviceId === "svc-vendor-a");
  assert.equal(a.selectedFulfillment, "VENDOR_COURIER");
  assert.equal(a.fulfillmentOptions.ARTFEST_SAMEDAY.available, false);
  assert.equal(q.body.requiresCard, false);
  const res = await placeGuest();
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "sameday_unavailable");
  assert.equal(orders().length, 0);
});

test("corp vechi (fără fulfillment, metoda COURIER): exact comportamentul de până acum, Shipment.fulfillment nescris", async () => {
  const legacy = { "svc-vendor-a": { method: "COURIER" }, "svc-vendor-b": { method: "COURIER" } };
  const res = await placeUser({ paymentMethod: "COD", selections: legacy });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  for (const s of shipments()) {
    assert.equal("fulfillment" in s, false, "câmpul nu se scrie");
    assert.equal(Number(s.price), 15);
    assert.equal(s.method, "COURIER");
  }
  assert.equal(pricerCalls, 0, "niciun apel Sameday la plasarea fără Sameday");
});

test("corp vechi cu easybox fără Sameday prin Artfest -> refuzat (easybox doar cu Sameday prin Artfest)", async () => {
  const res = await placeGuest({ paymentMethod: "COD", selections: { "svc-vendor-a": { method: "LOCKER", oohId: 501 }, "svc-vendor-b": { method: "COURIER" } } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "delivery_method_unavailable");
  assert.equal(orders().length, 0);
});
