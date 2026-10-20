// src/routes/checkoutRecovery.e2e.test.js
//
// Recuperarea checkout-ului (audit conversii 2026-10-14), end-to-end pe
// rutele REALE POST /api/checkout/place și /api/checkout/guest/place:
//   - eșecul inițierii plății CARD după crearea comenzii întoarce orderId
//     (+ guestAccessToken pentru guest), ca frontend-ul să ducă clientul
//     la pagina comenzii, unde poate relua plata („Achită acum”);
//   - vendor fără Stripe activ + CARD -> 400 ÎNAINTE de crearea comenzii,
//     coșul rămâne intact (clientul poate trece pe ramburs);
//   - telefonul introdus cu +40 / 0040 este salvat în format național,
//     nu trunchiat greșit ("4071234567").
// FĂRĂ DB real, FĂRĂ Stripe real (orchestratorul e mocat).
// Harness identic cu campaignCheckout.e2e.test.js.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/checkoutRecovery.e2e.test.js


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
        if (paymentShouldFail) throw new Error("stripe_unreachable");
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
const yesterday = () => new Date(Date.now() - 86400000);
const tomorrow = () => new Date(Date.now() + 86400000);

function campaign(id, vendorId, slug, extra = {}) {
  return {
    id,
    vendorId,
    slug,
    isActive: true,
    scope: "ALL_PRODUCTS",
    discountPercent: 10,
    platformFundingBps: 0,
    vendorFundingBps: 10000,
    fundingSource: "VENDOR",
    commissionBps: 500,
    attributionWindowHours: 168,
    startsAt: null,
    endsAt: null,
    vendor: { isActive: true },
    products: [],
    ...extra,
  };
}

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
    { id: "vendor-a", userId: "user-vendor-a", referralCode: "atelier-a", referralCommissionBps: 0, displayName: "Atelier A", isActive: true, email: "a@t.ro", user: { email: "a@t.ro" }, ...stripeReady },
    { id: "vendor-b", referralCode: "atelier-b", referralCommissionBps: 0, displayName: "Atelier B", isActive: true, email: "b@t.ro", user: { email: "b@t.ro" }, ...stripeReady },
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
    campaign("camp-a", "vendor-a", "toamna-a"),
    campaign("camp-a-sel", "vendor-a", "doar-p-a1", { scope: "SELECTED_PRODUCTS", products: [{ productId: "p-a1" }] }),
    campaign("camp-b", "vendor-b", "toamna-b"),
    campaign("camp-off", "vendor-a", "inactiva-a", { isActive: false }),
    campaign("camp-exp", "vendor-a", "expirata-a", { endsAt: yesterday() }),
    campaign("camp-future", "vendor-a", "viitoare-a", { startsAt: tomorrow() }),
    campaign("camp-vendor-off", "vendor-a", "vendor-oprit-a", { vendor: { isActive: false } }),
  ];
  t.vendorCampaignProduct = [{ campaignId: "camp-a-sel", productId: "p-a1" }];
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

// fără niciun câmp de consimțământ „Atribuire” - doar consimțămintele legale ale comenzii
function body({ paymentMethod, campaignSlugs, campaignTokens, referralCodes, discountCode }) {
  return {
    address: ADDRESS,
    customerType: "PF",
    paymentMethod,
    selections: SELECTIONS,
    consents: { terms: true, returns: true },
    ...(campaignSlugs !== undefined ? { campaignSlugs } : {}),
    ...(campaignTokens ? { campaignAttribution: campaignTokens } : {}),
    ...(referralCodes ? { referralCodes } : {}),
    ...(discountCode ? { discountCode } : {}),
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
const byVendor = (vendorId) => shipments().filter((s) => s.vendorId === vendorId);
const approx = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-6;
const ref = (code, at = Date.now()) => [{ code, at }];

function expectCampaign(s, campaignId, discountPercent = 10) {
  assert.equal(s.campaignId, campaignId);
  assert.equal(s.campaignCommissionBps, 500, "campanie configurată la 5%");
  assert.equal(s.campaignDiscountPercent, discountPercent);
  assert.ok(s.campaignAttributedAt instanceof Date, "campaignAttributedAt setat");
}

function expectNoCampaign(s) {
  assert.equal(s.campaignId ?? null, null);
  assert.equal(s.campaignCommissionBps ?? null, null);
  assert.equal(s.campaignAttributedAt ?? null, null);
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

const commissionRate = (sale) => Number(sale.commissionNet) / Number(sale.itemsNet);

async function legacyToken(campaignId, vendorId, slug) {
  const { signCampaignAttributionToken } = await import("../services/campaignAttributionToken.js");
  return signCampaignAttributionToken({ campaignId, vendorId, slug, attributionWindowHours: 168 });
}


beforeEach(() => {
  seed();
  paymentShouldFail = false;
});

const orders = () => db.__tables.order || [];

async function post(path, payload) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
}

/* =========================================================
   Eșec la inițierea plății CARD (după crearea comenzii)
========================================================= */

test("user CARD: Stripe indisponibil -> 500 payment_init_failed CU orderId (frontend duce clientul la comandă)", async () => {
  paymentShouldFail = true;

  const res = await placeUser({ items: [{ productId: "p-a1", qty: 1 }], paymentMethod: "CARD" });

  assert.equal(res.status, 500, JSON.stringify(res.body));
  assert.equal(res.body.error, "payment_init_failed");
  assert.ok(res.body.orderId, "orderId trebuie întors pentru recuperare");
  assert.equal(paymentCalls.length, 1);

  const order = orders().find((o) => o.id === res.body.orderId);
  assert.ok(order, "comanda există, poate fi plătită ulterior");
  assert.equal(order.paymentMethod, "CARD");
});

test("guest CARD: Stripe indisponibil -> 500 CU orderId + guestAccessToken (acces la pagina publică a comenzii)", async () => {
  paymentShouldFail = true;

  const res = await placeGuest({ items: [{ productId: "p-a1", qty: 1 }], paymentMethod: "CARD" });

  assert.equal(res.status, 500, JSON.stringify(res.body));
  assert.equal(res.body.error, "guest_payment_init_failed");
  assert.ok(res.body.orderId);
  assert.ok(res.body.guestAccessToken, "fără token guest-ul nu își mai poate accesa comanda");
});

test("CARD reușit (user + guest): răspuns cu payment.redirectUrl, neschimbat", async () => {
  const user = await placeUser({ items: [{ productId: "p-a1", qty: 1 }], paymentMethod: "CARD" });
  assert.equal(user.status, 200, JSON.stringify(user.body));
  assert.equal(user.body.payment.redirectUrl, "https://checkout.stripe.test/x");

  const guest = await placeGuest({ items: [{ productId: "p-a2", qty: 1 }], paymentMethod: "CARD" });
  assert.equal(guest.status, 200, JSON.stringify(guest.body));
  assert.equal(guest.body.payment.redirectUrl, "https://checkout.stripe.test/x");
  assert.ok(guest.body.guestAccessToken);
});

test("vendor fără Stripe activ + CARD -> 400 ÎNAINTE de comandă; coșul userului rămâne intact; COD merge", async () => {
  db.__tables.vendor.find((v) => v.id === "vendor-a").stripeConnectStatus = "disabled";

  const card = await placeUser({ items: [{ productId: "p-a1", qty: 1 }], paymentMethod: "CARD" });
  assert.equal(card.status, 400, JSON.stringify(card.body));
  assert.equal(card.body.error, "vendor_stripe_not_active");
  assert.equal(orders().length, 0, "nicio comandă creată");
  assert.equal(paymentCalls.length, 0);
  assert.equal(db.__tables.cartItem.length, 1, "coșul nu a fost golit");

  const cod = await placeUser({ items: [{ productId: "p-a1", qty: 1 }], paymentMethod: "COD" });
  assert.equal(cod.status, 200, JSON.stringify(cod.body));
  assert.equal(orders().length, 1);
});

/* =========================================================
   Telefon românesc +40 / 0040
========================================================= */

for (const [label, phone] of [
  ["+40", "+40 722 000 000"],
  ["0040", "0040722000000"],
  ["40 fără +", "40722000000"],
]) {
  test(`guest COD: telefon ${label} -> salvat ca 0722000000`, async () => {
    const res = await post("/api/checkout/guest/place", {
      items: [{ productId: "p-a1", qty: 1 }],
      address: { ...ADDRESS, phone },
      customerType: "PF",
      paymentMethod: "COD",
      selections: SELECTIONS,
      consents: { terms: true, returns: true },
    });

    assert.equal(res.status, 200, JSON.stringify(res.body));
    const order = orders().find((o) => o.id === res.body.orderId);
    assert.equal(order.shippingAddress.phone, "0722000000");
  });
}

test("user COD: telefon +40 -> salvat ca 0722000000", async () => {
  currentUser = { id: "user-1" };
  db.__tables.cartItem = [
    {
      id: "ci-0",
      userId: "user-1",
      productId: "p-a1",
      qty: 1,
      selectedOptions: {},
      customAnswers: {},
      configurationKey: "default",
      product: db.__tables.product.find((p) => p.id === "p-a1"),
    },
  ];

  const res = await post("/api/checkout/place", {
    address: { ...ADDRESS, phone: "+40722000000" },
    customerType: "PF",
    paymentMethod: "COD",
    selections: SELECTIONS,
  });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const order = orders().find((o) => o.id === res.body.orderId);
  assert.equal(order.shippingAddress.phone, "0722000000");
});

test("telefon invalid (9 cifre) -> 400 phone_invalid, fără comandă", async () => {
  const res = await post("/api/checkout/guest/place", {
    items: [{ productId: "p-a1", qty: 1 }],
    address: { ...ADDRESS, phone: "072200000" },
    customerType: "PF",
    paymentMethod: "COD",
    selections: SELECTIONS,
    consents: { terms: true, returns: true },
  });

  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(res.body.error, "phone_invalid");
  assert.equal(orders().length, 0);
});
