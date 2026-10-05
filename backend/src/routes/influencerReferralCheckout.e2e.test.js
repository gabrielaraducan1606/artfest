// src/routes/influencerReferralCheckout.e2e.test.js
//
// Atribuire influencer REQUEST-BASED, end-to-end pe rutele REALE de checkout:
//   POST /api/checkout/guest/place | /api/checkout/place  { influencerReferralCode }
//   -> resolveCheckoutInfluencerAttribution (validare server-side a codului)
//   -> resolveShipmentPromoter -> buildShipmentAttributionFields -> Shipment
//   -> dashboard (listInfluencerAttributedOrders)
//   -> earning (ensureSaleLedgerEntry + ensureInfluencerSaleLedgerEntry, o singură dată)
//
// FĂRĂ /api/public/influencer/attribution, fără token, fără InfluencerClick.
// Mock-uri DOAR la graniță: DB (in-memory generic), prețuri promoționale (fără
// promoții), plata CARD (orchestrator), email, notificări, auth.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/influencerReferralCheckout.e2e.test.js

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
    { id: "vendor-a", userId: "user-vendor-a", displayName: "Atelier A", isActive: true, email: "a@t.ro", user: { email: "a@t.ro" }, ...stripeReady },
    { id: "vendor-b", displayName: "Atelier B", isActive: true, email: "b@t.ro", user: { email: "b@t.ro" }, ...stripeReady },
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

function body({ email, paymentMethod, referralCode, token, discountCode }) {
  return {
    address: email ? { ...ADDRESS, email } : ADDRESS,
    customerType: "PF",
    paymentMethod,
    selections: SELECTIONS,
    consents: { terms: true, returns: true },
    ...(referralCode !== undefined ? { influencerReferralCode: referralCode } : {}),
    ...(token !== undefined ? { influencerAttribution: token } : {}),
    ...(discountCode ? { discountCode } : {}),
  };
}

async function placeGuest({ items, paymentMethod = "COD", referralCode, token, discountCode, email }) {
  const res = await fetch(`${baseUrl}/api/checkout/guest/place`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items, ...body({ email, paymentMethod, referralCode, token, discountCode }) }),
  });
  return { status: res.status, body: await res.json() };
}

async function placeUser({ items, paymentMethod = "COD", referralCode, token, userId = "user-1" }) {
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
    body: JSON.stringify(body({ paymentMethod, referralCode, token })),
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

test("1/2/9/11. guest COD cu influencerReferralCode (link direct sau colecție) -> Shipment atribuit, fără InfluencerClick", async () => {
  const res = await placeGuest({ items: [{ productId: "p-a1", qty: 1 }], referralCode: REF });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  expectAttributed(shipments()[0]);
  assert.equal((db.__tables.influencerClick || []).length, 0, "nicio înregistrare de click necesară");
});

test("12. guest CARD -> atribuit + plata inițiată", async () => {
  const res = await placeGuest({ items: [{ productId: "p-a1", qty: 1 }], paymentMethod: "CARD", referralCode: REF });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(paymentCalls.length, 1);
  expectAttributed(shipments()[0]);
});

test("10/11. user logat COD -> atribuit", async () => {
  const res = await placeUser({ items: [{ productId: "p-a1", qty: 1 }], paymentMethod: "COD", referralCode: REF });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(db.__tables.order.at(-1).userId, "user-1");
  expectAttributed(shipments()[0]);
});

test("10/12. user logat CARD -> atribuit + plata inițiată", async () => {
  const res = await placeUser({ items: [{ productId: "p-b1", qty: 1 }], paymentMethod: "CARD", referralCode: REF });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(paymentCalls.length, 1);
  expectAttributed(shipments()[0]);
});

test("13. multi-vendor (guest și user) -> influencerul pe fiecare shipment", async () => {
  const guest = await placeGuest({ items: [{ productId: "p-a1", qty: 1 }, { productId: "p-b1", qty: 1 }], referralCode: REF });
  assert.equal(guest.status, 200, JSON.stringify(guest.body));

  const user = await placeUser({ items: [{ productId: "p-a2", qty: 1 }, { productId: "p-b1", qty: 1 }], referralCode: REF });
  assert.equal(user.status, 200, JSON.stringify(user.body));

  assert.equal(shipments().length, 4);
  for (const s of shipments()) expectAttributed(s);
});

test("14. cod de reducere al altui influencer își păstrează prioritatea față de referral", async () => {
  db.__tables.discountCode = [
    {
      id: "dc-ana",
      code: "ANA10",
      ownerType: "INFLUENCER",
      influencerId: "inf-2",
      vendorId: null,
      scope: "ALL_PRODUCTS",
      discountType: "PERCENT",
      discountPercent: 10,
      discountAmountCents: null,
      currency: "RON",
      minimumOrderCents: null,
      maxDiscountCents: null,
      fundingSource: "PLATFORM",
      platformFundingBps: 10000,
      vendorFundingBps: 0,
      status: "ACTIVE",
      isActive: true,
      startsAt: null,
      endsAt: null,
      usageLimit: null,
      usageLimitPerUser: null,
      usedCount: 0,
    },
  ];

  const res = await placeGuest({ items: [{ productId: "p-a1", qty: 1 }], referralCode: REF, discountCode: "ANA10" });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  expectAttributed(shipments()[0], "inf-2", "ana-codul");
});

test("15. referral invalid / inactiv / colaborare expirată / comision 0 -> ignorat (comanda trece, neatribuită)", async () => {
  for (const referralCode of ["nu-exista", "inactiv-cod", "expirat-cod", "zero-cod"]) {
    seed();
    const res = await placeGuest({ items: [{ productId: "p-a1", qty: 1 }], referralCode });
    assert.equal(res.status, 200, `${referralCode}: ${JSON.stringify(res.body)}`);
    expectNotAttributed(shipments()[0]);
  }
});

test("16. referralCode modificat manual -> backend-ul acceptă DOAR coduri reale și valide", async () => {
  // variante manipulate ale unui cod real
  for (const referralCode of ["TEO-31B637", "teo-31b63", "teo-31b637 OR 1=1", "x".repeat(65), "", "   ", 12345]) {
    seed();
    const res = await placeGuest({ items: [{ productId: "p-a1", qty: 1 }], referralCode });
    assert.equal(res.status, 200, `${referralCode}: ${JSON.stringify(res.body)}`);
    expectNotAttributed(shipments()[0]);
  }

  // un cod real al altui influencer activ e un cod valid -> atribuit acelui influencer (last-click)
  seed();
  await placeGuest({ items: [{ productId: "p-a1", qty: 1 }], referralCode: "ana-codul" });
  expectAttributed(shipments()[0], "inf-2", "ana-codul");
});

test("17. fără referral și fără token -> neatribuit (nicio sursă persistentă implicită)", async () => {
  const res = await placeGuest({ items: [{ productId: "p-a1", qty: 1 }] });
  assert.equal(res.status, 200);
  expectNotAttributed(shipments()[0]);
});

test("tranziție: tokenul vechi e încă acceptat; codul nou are prioritate față de token", async () => {
  const { signInfluencerAttributionToken } = await import("../services/influencerAttributionToken.js");
  const legacy = signInfluencerAttributionToken({ influencerId: "inf-2", referralCode: "ana-codul" });

  await placeGuest({ items: [{ productId: "p-a1", qty: 1 }], token: legacy });
  expectAttributed(shipments()[0], "inf-2", "ana-codul");

  seed();
  await placeGuest({ items: [{ productId: "p-a1", qty: 1 }], referralCode: REF, token: legacy });
  expectAttributed(shipments()[0], "inf-1", REF);

  // cod invalid + token valid -> tokenul (tranziție)
  seed();
  await placeGuest({ items: [{ productId: "p-a1", qty: 1 }], referralCode: "nu-exista", token: legacy });
  expectAttributed(shipments()[0], "inf-2", "ana-codul");
});

test("dashboard: comanda cu Shipment.influencerId apare în Comenzi atribuite", async () => {
  await placeGuest({ items: [{ productId: "p-a1", qty: 1 }], referralCode: REF });
  await placeGuest({ items: [{ productId: "p-a2", qty: 1 }] });

  for (const s of db.__tables.shipment) s.order = db.__tables.order.find((o) => o.id === s.orderId);

  const { listInfluencerAttributedOrders } = await import("../services/influencerEarnings.js");
  const result = await listInfluencerAttributedOrders({ influencerId: "inf-1" });
  const rows = Array.isArray(result) ? result : result?.items || [];

  assert.equal(rows.length, 1);
  const attributed = shipments().find((s) => s.influencerId === "inf-1");
  assert.equal(rows[0].shipmentId, attributed.id);
});

test("19/20. earning: după DELIVERED, InfluencerEarningEntry o singură dată, formula existentă", async () => {
  await placeGuest({ items: [{ productId: "p-a1", qty: 1 }], referralCode: REF });

  const s = shipments()[0];
  s.status = "DELIVERED";
  const vendorOrders = await import("./vendorOrdersRoutes.js");

  for (let i = 0; i < 3; i++) {
    await vendorOrders.ensureSaleLedgerEntry({ vendorId: s.vendorId, shipmentId: s.id });
    await vendorOrders.ensureInfluencerSaleLedgerEntry({ shipmentId: s.id });
  }

  const vendorEntries = (db.__tables.vendorEarningEntry || []).filter((e) => e.shipmentId === s.id);
  const infEntries = (db.__tables.influencerEarningEntry || []).filter((e) => e.shipmentId === s.id);

  assert.equal(vendorEntries.length, 1);
  assert.equal(infEntries.length, 1, "nicio dublare");
  assert.ok(Number(vendorEntries[0].commissionNet) > 0);
  assert.equal(Number(infEntries[0].earningNet), (Number(vendorEntries[0].commissionNet) * 5000) / 10000);
});

/* ---------- self-referral ---------- */

test("self-referral: influencerul logat cumpără prin propriul cod -> neatribuit, fără earning", async () => {
  const res = await placeUser({ userId: "user-inf-1", items: [{ productId: "p-a1", qty: 1 }], referralCode: REF });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  expectNotAttributed(shipments()[0]);

  const s = shipments()[0];
  s.status = "DELIVERED";
  const vendorOrders = await import("./vendorOrdersRoutes.js");
  await vendorOrders.ensureSaleLedgerEntry({ vendorId: s.vendorId, shipmentId: s.id });
  await vendorOrders.ensureInfluencerSaleLedgerEntry({ shipmentId: s.id });
  assert.equal((db.__tables.influencerEarningEntry || []).length, 0);
});

test("self-referral: guest cu emailul contului influencerului -> neatribuit", async () => {
  for (const email of ["teo@t.ro", "TEO@T.RO"]) {
    seed();
    const res = await placeGuest({ email, items: [{ productId: "p-a1", qty: 1 }], referralCode: REF });
    assert.equal(res.status, 200, `${email}: ${JSON.stringify(res.body)}`);
    expectNotAttributed(shipments()[0]);
  }
});

test("self-referral: codul de reducere propriu al influencerului nu îi aduce câștig", async () => {
  db.__tables.discountCode = [
    {
      id: "dc-teo", code: "TEO10", ownerType: "INFLUENCER", influencerId: "inf-1", vendorId: null, scope: "ALL_PRODUCTS",
      discountType: "PERCENT", discountPercent: 10, discountAmountCents: null, currency: "RON", minimumOrderCents: null,
      maxDiscountCents: null, fundingSource: "PLATFORM", platformFundingBps: 10000, vendorFundingBps: 0, status: "ACTIVE",
      isActive: true, startsAt: null, endsAt: null, usageLimit: null, usageLimitPerUser: null, usedCount: 0,
    },
  ];
  const res = await placeGuest({ email: "teo@t.ro", items: [{ productId: "p-a1", qty: 1 }], discountCode: "TEO10" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  expectNotAttributed(shipments()[0]);
});

test("cumpărător normal (logat și guest) rămâne atribuit corect influencerului", async () => {
  await placeUser({ userId: "user-1", items: [{ productId: "p-a1", qty: 1 }], referralCode: REF });
  expectAttributed(shipments()[0]);

  seed();
  await placeGuest({ email: "client-nou@t.ro", items: [{ productId: "p-a1", qty: 1 }], referralCode: REF });
  expectAttributed(shipments()[0]);
});
