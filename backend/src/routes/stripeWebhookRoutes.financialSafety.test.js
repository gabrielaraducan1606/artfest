// src/routes/stripeWebhookRoutes.financialSafety.test.js
//
// Siguranță financiară a webhook-ului Stripe (cod REAL de producție, DB + Stripe
// false, în memorie):
//
//  1. PLATĂ CARD DUPĂ ANULAREA COMENZII - o comandă CANCELLED (sau cu o livrare
//     REFUSED/RETURNED) nu poate deveni PAID, nu transferă bani vendorilor, nu
//     creează SALE/comision; plata încasată se rambursează integral Clientului,
//     iar Order/Shipment rămân anulate (single-vendor, multi-vendor, la câteva
//     secunde după anulare, webhook duplicat, cursă între citire și scriere).
//
//  2. WEBHOOK DEDUPE / RETRY - un eveniment Stripe e considerat procesat doar
//     după succes; un eveniment FAILED e reluat la retrimitere; PROCESSING
//     recent -> 409; erorile DB la înregistrare nu mai sunt înghițite ca
//     "duplicat". Primul apel eșuează DUPĂ ce procesarea a început (transfer
//     făcut / ledger nescris / PAID nescris / refund eșuat), iar același event
//     e retrimis: nicio dublare de transfer, SALE sau refund.
//
// Harness-ul (DB + Stripe false) e derivat din
// stripeWebhookRoutes.cardLedger.test.js; extinderile sunt marcate mai jos.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/stripeWebhookRoutes.financialSafety.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5"; // niciodată contactat
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";

import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

/* =========================================================
   DB fals (in-memory) - STRICT formele de query folosite de codul rulat
========================================================= */

function makeFakeDb() {
  const state = {};
  let seq = 0;

  const db = {
    reset() {
      state.orders = new Map();
      state.shipments = new Map();
      state.vendors = new Map();
      state.entries = [];
      state.events = new Set();
      state.planBps = 1200;
      // shipment id-uri pentru care shipment.findUnique aruncă (simulează o
      // eroare tranzitorie în computeVendorEarningForShipment)
      state.failShipmentFindUnique = new Set();
      seq = 0;
    },
    state,
  };

  const readPath = (obj, path) => path.reduce((cur, k) => cur?.[k], obj);

  function matchesWhere(row, where = {}) {
    for (const [key, cond] of Object.entries(where)) {
      if (cond && typeof cond === "object" && "path" in cond && "equals" in cond) {
        if (readPath(row[key], cond.path) !== cond.equals) return false;
        continue;
      }
      if (cond && typeof cond === "object" && "not" in cond) {
        if (row[key] === cond.not) return false;
        continue;
      }
      if (row[key] !== cond) return false;
    }
    return true;
  }

  const p2002 = () => {
    const e = new Error("Unique constraint failed on shipmentId");
    e.code = "P2002";
    return e;
  };

  const shipmentWithItems = (s) => ({ ...s, items: s.items || [] });

  db.order = {
    findUnique: async ({ where: { id } }) => {
      const order = state.orders.get(id);
      if (!order) return null;
      return {
        ...order,
        shipments: (order.shipmentIds || []).map((sid) => shipmentWithItems(state.shipments.get(sid))),
      };
    },
    update: async ({ where: { id }, data }) => {
      const order = state.orders.get(id);
      Object.assign(order, data);
      return { ...order };
    },
  };

  db.vendor = {
    findMany: async ({ where }) =>
      [...state.vendors.values()].filter((v) => where.id.in.includes(v.id)),
  };

  db.vendorSubscription = {
    findFirst: async () => ({ plan: { code: "basic", name: "Basic", commissionBps: state.planBps } }),
  };

  db.vendorBilling = {
    findUnique: async ({ where: { vendorId } }) => state.vendors.get(vendorId)?.billing || null,
  };

  db.shipment = {
    findUnique: async ({ where: { id } }) => {
      if (state.failShipmentFindUnique.has(id)) {
        throw new Error("simulated_db_blip");
      }
      const s = state.shipments.get(id);
      if (!s) return null;
      return { ...shipmentWithItems(s), order: { ...state.orders.get(s.orderId) } };
    },
    findMany: async ({ where }) =>
      [...state.shipments.values()]
        .filter(
          (s) =>
            s.orderId === where.orderId &&
            s.vendorId === where.vendorId &&
            (s.direction ?? "OUTBOUND") === where.direction
        )
        .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
        .map((s) => ({ id: s.id, price: s.price })),
    update: async ({ where: { id }, data }) => {
      const s = state.shipments.get(id);
      Object.assign(s, data);
      return { ...s };
    },
  };

  db.vendorEarningEntry = {
    findUnique: async ({ where }) =>
      state.entries.find((e) => e.shipmentId && e.shipmentId === where.shipmentId) || null,
    findFirst: async ({ where }) => state.entries.find((e) => matchesWhere(e, where)) || null,
    findMany: async ({ where }) => state.entries.filter((e) => matchesWhere(e, where)),
    create: async ({ data }) => {
      if (data.shipmentId && state.entries.some((e) => e.shipmentId === data.shipmentId)) {
        throw p2002();
      }
      const row = { id: `earn_${++seq}`, payoutId: null, createdAt: new Date(), ...data };
      state.entries.push(row);
      return { ...row };
    },
    update: async ({ where: { id }, data }) => {
      const row = state.entries.find((e) => e.id === id);
      Object.assign(row, data);
      return { ...row };
    },
    upsert: async ({ where, update, create }) => {
      const existing = state.entries.find((e) => e.shipmentId === where.shipmentId);
      if (existing) {
        Object.assign(existing, update);
        return { ...existing };
      }
      return db.vendorEarningEntry.create({ data: create });
    },
  };

  const emptyModel = {
    findUnique: async () => null,
    findFirst: async () => null,
    findMany: async () => [],
  };
  db.influencerEarningEntry = emptyModel;
  db.vendorReferralEarningEntry = emptyModel;

  db.stripeEvent = {
    create: async ({ data }) => {
      if (state.events.has(data.eventId)) throw p2002();
      state.events.add(data.eventId);
      return data;
    },
    updateMany: async () => ({ count: 1 }),
  };

  db.$transaction = async (cb) => cb(db);

  db.reset();
  return db;
}

/* =========================================================
   Stripe fals - idempotent pe idempotencyKey, ca API-ul real
========================================================= */

function makeFakeStripe() {
  const s = {
    reset() {
      s.transfers_ = new Map();
      s.byKey = new Map();
      s.transferCreates = [];
      s.reversalCreates = [];
      s.refundCreates = [];
      s.charge = { id: "ch_1", amount: 0, amount_refunded: 0 };
    },

    webhooks: { constructEvent: (body) => body },

    transfers: {
      create: async (params, opts = {}) => {
        const key = opts.idempotencyKey;
        if (key && s.byKey.has(key)) return { ...s.byKey.get(key) };
        const transfer = { id: `tr_${s.transfers_.size + 1}`, amount: params.amount, amount_reversed: 0, params };
        s.transfers_.set(transfer.id, transfer);
        s.transferCreates.push(params);
        if (key) s.byKey.set(key, transfer);
        return { ...transfer };
      },
      retrieve: async (id) => ({ ...s.transfers_.get(id) }),
      createReversal: async (id, opts) => {
        s.reversalCreates.push({ id, opts });
        s.transfers_.get(id).amount_reversed += opts.amount;
        return { id: `trr_${s.reversalCreates.length}`, amount: opts.amount };
      },
    },

    charges: { retrieve: async () => ({ ...s.charge }) },

    refunds: {
      create: async (opts) => {
        s.refundCreates.push(opts);
        s.charge.amount_refunded += opts.amount;
        return { id: `re_${s.refundCreates.length}` };
      },
    },
  };

  s.reset();
  return s;
}

/* =========================================================
   Bootstrap: mock-uri ÎNAINTE de importul codului real
========================================================= */

const fakeDb = makeFakeDb();
const fakeStripe = makeFakeStripe();

let webhookRouter;
let vendorOrders;
let marketplaceCalc;
let refundService;
let server;
let baseUrl;
const restores = [];

before(async () => {
  restores.push(mock.module("../db.js", { namedExports: { prisma: fakeDb } }));
  restores.push(mock.module("../lib/stripe.js", { namedExports: { stripe: fakeStripe } }));
  restores.push(
    mock.module("@prisma/client", {
      namedExports: {
        PrismaClient: class {
          constructor() {
            return fakeDb;
          }
        },
        Prisma: {},
      },
    })
  );

  webhookRouter = (await import("./stripeWebhookRoutes.js")).default;
  vendorOrders = await import("./vendorOrdersRoutes.js");
  marketplaceCalc = await import("../payments/marketplaceCalc.js");
  refundService = await import("../services/orderRefundService.js");

  const app = express();
  app.use(express.json());
  app.use("/api/stripe/webhook", webhookRouter);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  restores.forEach((r) => r.restore());
});

beforeEach(() => {
  fakeDb.reset();
  fakeStripe.reset();
});

/* =========================================================
   Helpers de seed / apel
========================================================= */

const S = () => fakeDb.state;
const cents = (n) => Math.round(Number(n) * 100);
const sumCents = (rows, field) => rows.reduce((t, r) => t + cents(r[field]), 0);

function seedVendor(id) {
  S().vendors.set(id, {
    id,
    billing: { vatStatus: "non_payer", vatRate: null },
    stripeAccountId: `acct_${id}`,
    stripeChargesEnabled: true,
    stripePayoutsEnabled: true,
    stripeDetailsSubmitted: true,
    stripeConnectStatus: "enabled",
  });
}

/**
 * shipments: [{ id, vendorId, price (transport), items: [{price, qty}], direction?,
 *              vendorReferralCommissionOverrideBps? }]
 */
function seedOrder({ orderId = "order-1", paymentMethod = "CARD", shipments }) {
  let n = 0;

  for (const sh of shipments) {
    if (!S().vendors.has(sh.vendorId)) seedVendor(sh.vendorId);

    S().shipments.set(sh.id, {
      id: sh.id,
      orderId,
      vendorId: sh.vendorId,
      direction: sh.direction || "OUTBOUND",
      status: sh.status || "PENDING",
      price: sh.price ?? 0,
      createdAt: new Date(2026, 8, 21, 8, 0, n++),
      campaignId: null,
      campaignCommissionBps: null,
      vendorReferralCommissionOverrideBps: sh.vendorReferralCommissionOverrideBps ?? null,
      items: (sh.items || []).map((it, i) => ({
        id: `${sh.id}_it${i}`,
        title: "Produs",
        price: it.price,
        qty: it.qty ?? 1,
        platformDiscountAmount: 0,
        vendorDiscountAmount: 0,
      })),
    });
  }

  S().orders.set(orderId, {
    id: orderId,
    orderNumber: "AF-TEST",
    paymentMethod,
    status: "PENDING",
    currency: "RON",
    paidAt: null,
    stripeChargeId: null,
    stripePaymentIntentId: null,
    shipmentIds: shipments.map((s) => s.id),
  });

  return orderId;
}

function orderTotalCents(orderId) {
  const order = S().orders.get(orderId);
  return order.shipmentIds.reduce((total, sid) => {
    const sh = S().shipments.get(sid);
    if (sh.direction === "RETURN") return total + cents(sh.price) + sh.items.reduce((t, i) => t + cents(i.price) * i.qty, 0);
    return total + cents(sh.price) + sh.items.reduce((t, i) => t + cents(i.price) * i.qty, 0);
  }, 0);
}

async function postPaymentSucceeded({ eventId = "evt_1", piId = "pi_1", orderId = "order-1", feeCents = 150 } = {}) {
  const total = orderTotalCents(orderId);
  fakeStripe.charge.amount = total;

  const res = await fetch(`${baseUrl}/api/stripe/webhook/`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "sig" },
    body: JSON.stringify({
      id: eventId,
      type: "payment_intent.succeeded",
      livemode: false,
      data: {
        object: {
          id: piId,
          amount: total,
          amount_received: total,
          currency: "ron",
          metadata: { orderId },
          charges: { data: [{ id: "ch_1", balance_transaction: { fee: feeCents } }] },
        },
      },
    }),
  });

  return { status: res.status, body: await res.json() };
}

const saleRows = () => S().entries.filter((e) => e.type === "SALE");
const twoStores = () => [
  { id: "s1", vendorId: "v1", items: [{ price: 10.05 }] },
  { id: "s2", vendorId: "v1", items: [{ price: 10.05 }] },
];

async function vendorCommissionFromSplits(orderId, vendorId) {
  const splits = await marketplaceCalc.computeOrderSplits(orderId);
  return splits.vendors.find((v) => v.vendorId === vendorId).commissionNet;
}


/* =========================================================
   ====== EXTENSII pentru testele de siguranță financiară ======
   (peste harness-ul de mai sus: DB + Stripe false, cod REAL de producție)
========================================================= */

let userRouterServer;
let userBase;

const faults = {};
let transferCalls = 0;
let refundKeys = new Map();

const notUniqueError = (code, message) => {
  const e = new Error(message);
  e.code = code;
  return e;
};

const clone = (value) => structuredClone(value);

before(async () => {
  restores.push(
    mock.module("../api/auth.js", {
      namedExports: {
        authRequired: (req, _res, next) => {
          req.user = { sub: "user-1", email: "t@local" };
          next();
        },
        requireRole: () => (_req, _res, next) => next(),
        enforceTokenVersion: (_req, _res, next) => next(),
      },
    })
  );

  const userRouter = (await import(`./userOrdersRoutes.js?safety=${Date.now()}`)).default;

  /* ---- DB: metodele suplimentare necesare rutelor user + handlerelor de avans ---- */
  const origShipmentFindMany = fakeDb.shipment.findMany;
  fakeDb.shipment.findMany = async (args) => {
    const w = args.where || {};
    if (w.direction !== undefined) return origShipmentFindMany(args); // planCardSaleEntries
    return [...S().shipments.values()]
      .filter((s) => Object.entries(w).every(([k, v]) => s[k] === v))
      .map((s) => ({ id: s.id, status: s.status, stripeDepositSessionId: s.stripeDepositSessionId }));
  };

  fakeDb.shipment.findUnique = async ({ where: { id } }) => {
    const s = S().shipments.get(id);
    if (!s) return null;
    return {
      ...s,
      items: s.items || [],
      order: { ...S().orders.get(s.orderId) },
      vendor: S().vendors.get(s.vendorId) || null,
    };
  };

  fakeDb.shipment.updateMany = async ({ where, data }) => {
    const rows = [...S().shipments.values()].filter((s) =>
      Object.entries(where).every(([k, cond]) => {
        if (cond && typeof cond === "object" && "not" in cond) return s[k] !== cond.not;
        if (cond && typeof cond === "object" && "in" in cond) return cond.in.includes(s[k]);
        return s[k] === cond;
      })
    );
    rows.forEach((r) => Object.assign(r, data));
    return { count: rows.length };
  };

  const origShipmentUpdate = fakeDb.shipment.update;
  fakeDb.shipment.update = async (args) => {
    if (faults.shipmentPaidUpdateOnce && args.data?.depositStatus === "PAID") {
      faults.shipmentPaidUpdateOnce = false;
      throw new Error("db_write_failed");
    }
    return origShipmentUpdate(args);
  };

  fakeDb.order.findFirst = async ({ where }) => {
    const o = S().orders.get(where.id);
    if (!o || (where.userId && o.userId !== where.userId)) return null;
    return {
      ...o,
      shipments: (o.shipmentIds || []).map((sid) => ({ ...S().shipments.get(sid), items: [] })),
      user: { email: null },
    };
  };

  const origOrderFindUnique = fakeDb.order.findUnique;
  fakeDb.order.findUnique = async (args) => origOrderFindUnique(args);

  // update cu `where` extins (Prisma 5+): { id, status: { not } } -> P2025 dacă nu se potrivește
  const origOrderUpdate = fakeDb.order.update;
  fakeDb.order.update = async (args) => {
    const o = S().orders.get(args.where.id);
    if (!o) throw notUniqueError("P2025", "Record to update not found");

    const cond = args.where.status;
    if (cond?.not !== undefined && faults.cancelDuringPaidUpdate && !faults._cancelled) {
      faults._cancelled = true;
      o.status = "CANCELLED"; // anulare concurentă între citire și scriere
    }
    if (cond?.not !== undefined && o.status === cond.not) {
      throw notUniqueError("P2025", "Record to update not found");
    }
    if (typeof cond === "string" && o.status !== cond) {
      throw notUniqueError("P2025", "Record to update not found");
    }

    return origOrderUpdate({ where: { id: args.where.id }, data: args.data });
  };

  fakeDb.order.updateMany = async ({ where, data }) => {
    const o = S().orders.get(where.id);
    if (!o) return { count: 0 };
    Object.assign(o, data);
    return { count: 1 };
  };

  const origCreateEntry = fakeDb.vendorEarningEntry.create;
  fakeDb.vendorEarningEntry.create = async (args) => {
    if (faults.ledgerCreateOnce) {
      faults.ledgerCreateOnce = false;
      throw new Error("db_write_failed");
    }
    return origCreateEntry({ ...args, data: { occurredAt: new Date(), ...args.data } });
  };

  // tranzacție cu rollback (ca Postgres): la eroare, starea revine
  fakeDb.$transaction = async (cb) => {
    const snap = {
      orders: clone([...S().orders]),
      shipments: clone([...S().shipments]),
      entries: clone(S().entries),
    };
    try {
      return await cb(fakeDb);
    } catch (error) {
      S().orders = new Map(snap.orders);
      S().shipments = new Map(snap.shipments);
      S().entries = snap.entries;
      throw error;
    }
  };

  /* ---- Stripe: idempotență la refund, defecte injectate, expirare sesiuni ---- */
  const origTransferCreate = fakeStripe.transfers.create;
  fakeStripe.transfers.create = async (params, opts) => {
    transferCalls += 1;
    if (faults.transferFailOnCall && transferCalls === faults.transferFailOnCall) {
      throw new Error("stripe_transfer_failed");
    }
    return origTransferCreate(params, opts);
  };

  fakeStripe.refunds.create = async (opts, reqOpts = {}) => {
    const key = reqOpts.idempotencyKey;
    if (key && refundKeys.has(key)) return { ...refundKeys.get(key) };
    if (faults.refundFailOnce) {
      faults.refundFailOnce = false;
      throw new Error("stripe_api_timeout");
    }
    const amount = opts.amount ?? (opts.payment_intent ? faults.piAmount ?? 1500 : 0);
    fakeStripe.refundCreates.push({ ...opts, __key: key });
    fakeStripe.charge.amount_refunded += amount;
    const refund = { id: `re_${fakeStripe.refundCreates.length}` };
    if (key) refundKeys.set(key, refund);
    return refund;
  };

  fakeStripe.sessionExpires = [];
  fakeStripe.checkout = {
    sessions: {
      expire: async (id) => {
        fakeStripe.sessionExpires.push(id);
        return { id, status: "expired" };
      },
    },
  };

  const app = express();
  app.use(express.json());
  app.use("/api/user/orders", userRouter);
  userRouterServer = http.createServer(app);
  await new Promise((resolve) => userRouterServer.listen(0, resolve));
  userBase = `http://127.0.0.1:${userRouterServer.address().port}/api/user/orders`;
});

after(async () => {
  if (userRouterServer) await new Promise((resolve) => userRouterServer.close(resolve));
});

beforeEach(() => {
  for (const key of Object.keys(faults)) delete faults[key];
  transferCalls = 0;
  refundKeys = new Map();
  fakeStripe.sessionExpires = [];

  // StripeEvent cu semantica reală (unic, stări, updateMany condiționat)
  const events = new Map();
  S().events = events;

  const matches = (row, where) =>
    Object.entries(where).every(([k, cond]) => {
      const v = row[k];
      if (cond && typeof cond === "object" && !(cond instanceof Date)) {
        if ("not" in cond) return v !== cond.not;
        if ("lt" in cond) return v !== null && v < cond.lt;
      }
      if (cond === null) return v === null || v === undefined;
      if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
      return v === cond;
    });

  fakeDb.stripeEvent = {
    create: async ({ data }) => {
      if (faults.eventCreateDbError) throw new Error("db_connection_lost");
      if (events.has(data.eventId)) {
        throw notUniqueError("P2002", "Unique constraint failed on eventId");
      }
      events.set(data.eventId, {
        ...data,
        receivedAt: new Date(),
        processedAt: null,
        error: null,
      });
      return data;
    },
    findUnique: async ({ where: { eventId } }) => {
      const row = events.get(eventId);
      return row ? { ...row } : null;
    },
    updateMany: async ({ where, data }) => {
      const rows = [...events.values()].filter((r) => matches(r, where));
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    },
  };
});

/* ---------- helpers ---------- */

const total = (orderId = "order-1") => orderTotalCents(orderId);
const eventRow = (id) => S().events.get(id);
const oneStore = () => [{ id: "s1", vendorId: "v1", items: [{ price: 10.05 }] }];
const twoVendors = () => [
  { id: "s1", vendorId: "v1", items: [{ price: 10.05 }] },
  { id: "s3", vendorId: "v2", items: [{ price: 33.33 }] },
];
const multiVendor = () => [
  { id: "s1", vendorId: "v1", items: [{ price: 10.05 }] },
  { id: "s2", vendorId: "v1", items: [{ price: 10.05 }] },
  { id: "s3", vendorId: "v2", items: [{ price: 33.33 }] },
];

function cancelOrderInState(orderId = "order-1") {
  const o = S().orders.get(orderId);
  o.status = "CANCELLED";
  for (const sid of o.shipmentIds) S().shipments.get(sid).status = "REFUSED";
}

async function postEvent(event) {
  const res = await fetch(`${baseUrl}/api/stripe/webhook/`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "sig" },
    body: JSON.stringify(event),
  });
  return { status: res.status, body: await res.json() };
}

async function userCancel(orderId = "order-1") {
  const res = await fetch(`${userBase}/${orderId}/cancel`, { method: "POST" });
  return { status: res.status, body: await res.json() };
}

function assertNothingPaidOrBooked(label) {
  assert.equal(fakeStripe.transferCreates.length, 0, `${label}: niciun transfer către vendor`);
  assert.equal(saleRows().length, 0, `${label}: niciun SALE/comision`);
  assert.equal(S().entries.length, 0, `${label}: nicio intrare de ledger`);
}

/* =========================================================
   1. PLATĂ CARD DUPĂ ANULAREA COMENZII
========================================================= */

test("L1 single-vendor: plată pe comandă ANULATĂ -> refund integral, fără transfer/SALE, statusuri anulate", async () => {
  seedOrder({ shipments: oneStore() });
  cancelOrderInState();

  const r = await postPaymentSucceeded({ eventId: "l1" });

  assert.equal(r.status, 200);
  assertNothingPaidOrBooked("L1");
  const order = S().orders.get("order-1");
  assert.equal(order.status, "CANCELLED");
  assert.equal(order.paidAt, null);
  assert.equal(S().shipments.get("s1").status, "REFUSED");
  assert.equal(fakeStripe.refundCreates.length, 1, "un singur refund");
  assert.equal(fakeStripe.charge.amount_refunded, total(), "integral");
  assert.equal(fakeStripe.refundCreates[0].metadata.kind, "order_payment_blocked_order");
  assert.match(order.adminNotes, /rambursată automat/);
  assert.equal(eventRow("l1").processedAt instanceof Date, true, "eveniment COMPLETED");
});

test("L2 multi-vendor (v1: 2 shipment-uri, v2: 1): plată pe comandă ANULATĂ -> refund integral, niciun vendor plătit", async () => {
  seedOrder({ shipments: multiVendor() });
  cancelOrderInState();

  await postPaymentSucceeded({ eventId: "l2" });

  assertNothingPaidOrBooked("L2");
  assert.equal(fakeStripe.charge.amount_refunded, total());
  for (const sid of ["s1", "s2", "s3"]) assert.equal(S().shipments.get(sid).status, "REFUSED", sid);
  assert.equal(S().orders.get("order-1").status, "CANCELLED");
});

test("L3 plata la câteva secunde după anularea de către client (rută reală): refund, comanda rămâne CANCELLED; sesiunea Stripe a comenzii e expirată", async () => {
  seedOrder({ shipments: oneStore() });
  S().orders.get("order-1").userId = "user-1";
  S().orders.get("order-1").stripeCheckoutSessionId = "cs_order_1";

  const cancel = await userCancel();
  assert.equal(cancel.status, 200);
  assert.equal(S().orders.get("order-1").status, "CANCELLED");
  assert.deepEqual(fakeStripe.sessionExpires, ["cs_order_1"], "sesiunea de plată a comenzii e expirată la anulare");

  await postPaymentSucceeded({ eventId: "l3" });

  assertNothingPaidOrBooked("L3");
  assert.equal(S().orders.get("order-1").status, "CANCELLED");
  assert.equal(S().shipments.get("s1").status, "REFUSED");
  assert.equal(fakeStripe.charge.amount_refunded, total());
});

test("L4 webhook duplicat (același event id și event id nou pe același PaymentIntent): un singur refund, zero transfer/SALE", async () => {
  seedOrder({ shipments: multiVendor() });
  cancelOrderInState();

  await postPaymentSucceeded({ eventId: "l4a", piId: "pi_l4" });
  const same = await postPaymentSucceeded({ eventId: "l4a", piId: "pi_l4" });
  await postPaymentSucceeded({ eventId: "l4b", piId: "pi_l4" });

  assert.equal(same.body.duplicate, true);
  assert.equal(fakeStripe.refundCreates.length, 1);
  assert.equal(fakeStripe.charge.amount_refunded, total());
  assertNothingPaidOrBooked("L4");
});

test("L5 anulare parțială (vendor v1 a anulat livrarea, comanda încă PENDING): plata integrală e rambursată, nimeni nu e plătit, comanda NU devine PAID", async () => {
  seedOrder({ shipments: twoVendors() });
  S().shipments.get("s1").status = "REFUSED"; // doar livrarea v1

  await postPaymentSucceeded({ eventId: "l5" });

  assertNothingPaidOrBooked("L5");
  assert.equal(fakeStripe.charge.amount_refunded, total());
  assert.equal(S().orders.get("order-1").status, "PENDING", "comanda nu devine PAID");
  assert.equal(S().shipments.get("s3").status, "PENDING", "livrarea activă rămâne neatinsă");
});

test("L6 cursă: comanda e anulată ÎNTRE citire și marcarea PAID -> update condiționat refuză, plata e rambursată, comanda rămâne CANCELLED", async () => {
  seedOrder({ shipments: oneStore() });
  faults.cancelDuringPaidUpdate = true;

  const r = await postPaymentSucceeded({ eventId: "l6" });

  assert.equal(r.status, 200);
  assert.equal(S().orders.get("order-1").status, "CANCELLED");
  assertNothingPaidOrBooked("L6");
  assert.equal(fakeStripe.charge.amount_refunded, total());
});

test("L7 charge deja rambursat integral (anulare client / apel anterior, cheie de idempotență expirată): niciun refund nou", async () => {
  seedOrder({ shipments: oneStore() });
  cancelOrderInState();
  fakeStripe.charge.amount = total();
  fakeStripe.charge.amount_refunded = total();

  await postPaymentSucceeded({ eventId: "l7" });

  assert.equal(fakeStripe.refundCreates.length, 0);
  assertNothingPaidOrBooked("L7");
});

test("L8 CONTROL: comandă activă -> PAID + transfer per vendor + SALE per shipment, fără refund", async () => {
  seedOrder({ shipments: multiVendor() });

  await postPaymentSucceeded({ eventId: "l8" });

  assert.equal(S().orders.get("order-1").status, "PAID");
  assert.equal(fakeStripe.transferCreates.length, 2);
  assert.equal(saleRows().length, 3);
  assert.equal(fakeStripe.refundCreates.length, 0);
});

test("L9 anulare client concurentă cu plata: comanda a devenit PAID între citire și anulare -> anularea e refuzată (409), livrările rămân neanulate", async () => {
  seedOrder({ shipments: oneStore() });
  S().orders.get("order-1").userId = "user-1";
  const origFindFirst = fakeDb.order.findFirst;
  fakeDb.order.findFirst = async (args) => {
    const snapshot = await origFindFirst(args); // anularea citește comanda ca PENDING
    if (snapshot) S().orders.get("order-1").status = "PAID"; // webhook-ul o marchează PAID imediat după
    return snapshot;
  };

  try {
    const r = await userCancel();
    assert.equal(r.status, 409);
    assert.equal(S().orders.get("order-1").status, "PAID", "plata nu e suprascrisă de CANCELLED");
    assert.equal(S().shipments.get("s1").status, "PENDING", "tranzacția de anulare a fost derulată înapoi");
  } finally {
    fakeDb.order.findFirst = origFindFirst;
  }
});

/* =========================================================
   2. WEBHOOK DEDUPE / RETRY
========================================================= */

test("R1 plata comenzii: transferul vendorului 2 eșuează la prima livrare -> 500/FAILED; același event retrimis -> reluat: câte UN transfer și UN SALE per vendor/shipment", async () => {
  seedOrder({ shipments: twoVendors() });
  faults.transferFailOnCall = 2;

  const first = await postPaymentSucceeded({ eventId: "r1" });

  assert.equal(first.status, 500);
  assert.ok(eventRow("r1").error, "evenimentul e marcat FAILED");
  assert.equal(eventRow("r1").processedAt, null, "NU e considerat procesat");
  assert.equal(fakeStripe.transferCreates.length, 1, "v1 transferat");
  assert.equal(saleRows().length, 1);

  const retry = await postPaymentSucceeded({ eventId: "r1" });

  assert.equal(retry.status, 200);
  assert.notEqual(retry.body.duplicate, true, "retry-ul NU e tratat ca duplicat");
  assert.equal(fakeStripe.transferCreates.length, 2, "fiecare vendor transferat o singură dată");
  assert.equal(saleRows().length, 2);
  assert.equal(new Set(saleRows().map((r) => r.shipmentId)).size, 2);
  assert.equal(S().orders.get("order-1").status, "PAID");
  assert.equal(eventRow("r1").error, null);
  assert.ok(eventRow("r1").processedAt instanceof Date, "COMPLETED");

  const again = await postPaymentSucceeded({ eventId: "r1" });
  assert.equal(again.body.duplicate, true, "după succes, retrimiterea e duplicat real");
  assert.equal(fakeStripe.transferCreates.length, 2);
});

test("R1b retry după expirarea cheii de idempotență Stripe (>24h): vendorul deja plătit NU primește un al doilea transfer (verificare durabilă în ledger)", async () => {
  seedOrder({ shipments: twoVendors() });
  faults.transferFailOnCall = 2;

  await postPaymentSucceeded({ eventId: "r1b" });
  fakeStripe.byKey.clear(); // cheile de idempotență au expirat

  const retry = await postPaymentSucceeded({ eventId: "r1b" });

  assert.equal(retry.status, 200);
  assert.equal(fakeStripe.transferCreates.length, 2, "v1 nu e transferat din nou");
  assert.equal(saleRows().length, 2);
});

test("R2 ledger: scrierea SALE eșuează după transfer -> 500/FAILED; retry -> SALE scris o singură dată, transfer o singură dată", async () => {
  seedOrder({ shipments: multiVendor().filter((s) => s.vendorId === "v1") });
  faults.ledgerCreateOnce = true;

  const first = await postPaymentSucceeded({ eventId: "r2" });
  assert.equal(first.status, 500);
  assert.equal(fakeStripe.transferCreates.length, 1);

  const retry = await postPaymentSucceeded({ eventId: "r2" });
  assert.equal(retry.status, 200);
  assert.equal(fakeStripe.transferCreates.length, 1, "același transfer (idempotență)");
  assert.equal(saleRows().length, 2, "câte un SALE per shipment, fără dubluri");
  assert.equal(new Set(saleRows().map((r) => r.shipmentId)).size, 2);
});

function seedDeposit() {
  seedOrder({ shipments: oneStore() });
  const order = S().orders.get("order-1");
  order.paymentMethod = "COD";
  Object.assign(S().shipments.get("s1"), {
    depositStatus: "PENDING",
    depositRequestedAmount: 15,
    depositPercent: 15,
    depositMeta: {},
  });
}

const depositEvent = (id) => ({
  id,
  type: "payment_intent.succeeded",
  livemode: false,
  data: {
    object: {
      id: "pi_dep_1",
      amount: 1500,
      amount_received: 1500,
      currency: "ron",
      metadata: { kind: "deposit_payment", shipmentId: "s1", vendorId: "v1", orderId: "order-1" },
      charges: { data: [{ id: "ch_dep", balance_transaction: { fee: 50 } }] },
    },
  },
});

test("R3 avans: scrierea PAID eșuează după transfer -> 500/FAILED; retry -> PAID, un singur transfer", async () => {
  seedDeposit();
  faults.shipmentPaidUpdateOnce = true;

  const first = await postEvent(depositEvent("r3"));
  assert.equal(first.status, 500);
  assert.equal(S().shipments.get("s1").depositStatus, "PENDING");
  assert.equal(fakeStripe.transferCreates.length, 1);

  const retry = await postEvent(depositEvent("r3"));
  assert.equal(retry.status, 200);
  assert.equal(S().shipments.get("s1").depositStatus, "PAID");
  assert.equal(fakeStripe.transferCreates.length, 1, "vendorul e plătit o singură dată");
  assert.ok(eventRow("r3").processedAt instanceof Date);
  assert.equal(eventRow("r3").error, null);
});

test("R4 refund de siguranță pentru avans pe comandă anulată: refund-ul Stripe eșuează prima dată -> 500/FAILED; retry -> rambursat o singură dată, REFUNDED", async () => {
  seedDeposit();
  cancelOrderInState();
  faults.refundFailOnce = true;

  const first = await postEvent(depositEvent("r4"));
  assert.equal(first.status, 500);
  assert.equal(S().shipments.get("s1").depositStatus, "PENDING");

  const retry = await postEvent(depositEvent("r4"));
  assert.equal(retry.status, 200);
  assert.equal(S().shipments.get("s1").depositStatus, "REFUNDED");
  assert.equal(fakeStripe.refundCreates.length, 1);
  assert.equal(fakeStripe.transferCreates.length, 0);
  assert.equal(S().orders.get("order-1").status, "CANCELLED");
});

test("R5 refund pentru plata târzie a comenzii: refund-ul eșuează prima dată -> 500; retry -> rambursat o singură dată", async () => {
  seedOrder({ shipments: oneStore() });
  cancelOrderInState();
  faults.refundFailOnce = true;

  const first = await postPaymentSucceeded({ eventId: "r5" });
  assert.equal(first.status, 500);
  assert.equal(fakeStripe.charge.amount_refunded, 0);

  const retry = await postPaymentSucceeded({ eventId: "r5" });
  assert.equal(retry.status, 200);
  assert.equal(fakeStripe.refundCreates.length, 1);
  assert.equal(fakeStripe.charge.amount_refunded, total());
  assertNothingPaidOrBooked("R5");
});

test("R6 eveniment COMPLETED retrimis: duplicat real, handlerul NU rulează din nou", async () => {
  seedOrder({ shipments: oneStore() });

  await postPaymentSucceeded({ eventId: "r6" });
  const transfers = fakeStripe.transferCreates.length;
  const rows = saleRows().length;

  const again = await postPaymentSucceeded({ eventId: "r6" });

  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(fakeStripe.transferCreates.length, transfers);
  assert.equal(saleRows().length, rows);
});

test("R7 PROCESSING recent (alt worker în lucru): 409 (Stripe reîncearcă), nu 200-duplicat și nu procesează în paralel; PROCESSING vechi (stale) -> reluat", async () => {
  seedOrder({ shipments: oneStore() });
  S().events.set("r7", { eventId: "r7", type: "payment_intent.succeeded", receivedAt: new Date(), processedAt: null, error: null });

  const busy = await postPaymentSucceeded({ eventId: "r7" });
  assert.equal(busy.status, 409);
  assert.equal(busy.body.in_progress, true);
  assert.equal(fakeStripe.transferCreates.length, 0);

  S().events.get("r7").receivedAt = new Date(Date.now() - 30 * 60 * 1000);

  const stale = await postPaymentSucceeded({ eventId: "r7" });
  assert.equal(stale.status, 200);
  assert.equal(fakeStripe.transferCreates.length, 1);
  assert.equal(S().orders.get("order-1").status, "PAID");
});

test("R8 eroare DB la înregistrarea evenimentului (nu conflict de unicitate): 500 (Stripe reîncearcă), NU se răspunde ca duplicat și nu se procesează", async () => {
  seedOrder({ shipments: oneStore() });
  faults.eventCreateDbError = true;

  const r = await postPaymentSucceeded({ eventId: "r8" });

  assert.equal(r.status, 500);
  assert.notEqual(r.body.duplicate, true);
  assert.equal(fakeStripe.transferCreates.length, 0);
});

test("R9 două livrări simultane ale aceluiași eveniment FAILED: doar una îl revendică și procesează (compare-and-set)", async () => {
  seedOrder({ shipments: twoVendors() });
  faults.transferFailOnCall = 1;
  await postPaymentSucceeded({ eventId: "r9" }); // eșuează
  assert.ok(eventRow("r9").error);
  transferCalls = 0;

  const [a, b] = await Promise.all([
    postPaymentSucceeded({ eventId: "r9" }),
    postPaymentSucceeded({ eventId: "r9" }),
  ]);

  const statuses = [a.status, b.status].sort();
  assert.ok(statuses.includes(200), `una reușește: ${statuses}`);
  assert.equal(fakeStripe.transferCreates.length, 2, "un transfer per vendor, fără dublare");
  assert.equal(saleRows().length, 2);
  assert.ok(eventRow("r9").processedAt instanceof Date);
});

test("R10 eveniment FAILED istoric (processedAt setat + error, cum scria vechiul cod): retrimiterea îl reia", async () => {
  seedOrder({ shipments: oneStore() });
  S().events.set("r10", {
    eventId: "r10", type: "payment_intent.succeeded",
    receivedAt: new Date(Date.now() - 3600 * 1000), processedAt: new Date(), error: "old failure",
  });

  const r = await postPaymentSucceeded({ eventId: "r10" });

  assert.equal(r.status, 200);
  assert.notEqual(r.body.duplicate, true);
  assert.equal(S().orders.get("order-1").status, "PAID");
  assert.equal(eventRow("r10").error, null);
});

/* =========================================================
   4. ANULARE DE CĂTRE VENDOR + SESIUNE STRIPE DE AVANS (ruta REALĂ
      PATCH /api/vendor/orders/:id/status)
========================================================= */

let vendorServer;
let vendorBase;

before(async () => {
  const shipmentFindFirstOrig = fakeDb.shipment.findFirst;

  // findShipmentByOrderRef: shipment-ul vendorului pentru comanda dată, cu order
  fakeDb.shipment.findFirst = async (args) => {
    if (!args?.where?.vendorId) return shipmentFindFirstOrig?.(args) ?? null;
    const ref = args.where.OR?.[0]?.orderId;
    const s = [...S().shipments.values()].find(
      (x) => x.vendorId === args.where.vendorId && x.orderId === ref
    );
    return s ? { ...s, items: s.items || [], order: { ...S().orders.get(s.orderId) } } : null;
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: "u-vendor", email: "v@x.ro", role: "VENDOR", vendorId: req.headers["x-vendor-id"] };
    next();
  });
  // import direct (modulul e deja în cache, după mock-urile din harness) - nu depinde de ordinea hook-urilor
  const vendorRoutesModule = await import("./vendorOrdersRoutes.js");
  app.use("/api/vendor", vendorRoutesModule.default);

  vendorServer = http.createServer(app);
  await new Promise((resolve) => vendorServer.listen(0, resolve));
  vendorBase = `http://127.0.0.1:${vendorServer.address().port}/api/vendor`;
});

after(async () => {
  if (vendorServer) await new Promise((resolve) => vendorServer.close(resolve));
});

function seedCodWithTwoPendingDeposits() {
  seedOrder({ orderId: "order-1", paymentMethod: "COD", shipments: twoVendors() });
  S().orders.get("order-1").userId = "user-1";

  for (const [sid, session] of [["s1", "cs_s1"], ["s3", "cs_s3"]]) {
    Object.assign(S().shipments.get(sid), {
      depositStatus: "PENDING",
      depositRequestedAmount: 15,
      depositPercent: 15,
      stripeDepositSessionId: session,
      depositMeta: {},
    });
  }
}

async function vendorCancel(vendorId) {
  const res = await fetch(`${vendorBase}/orders/order-1/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-vendor-id": vendorId },
    body: JSON.stringify({ status: "cancelled", cancelReason: "stock_issue" }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

test("V1 vendor anulează livrarea lui (multi-vendor): avansul PENDING al ACELEI livrări expiră în DB și sesiunea Stripe e expirată; celălalt vendor rămâne neatins și plătibil", async () => {
  seedCodWithTwoPendingDeposits();

  await vendorCancel("v1");

  assert.equal(S().shipments.get("s1").status, "REFUSED", "livrarea vendorului a fost anulată");
  assert.equal(S().shipments.get("s1").depositStatus, "EXPIRED");
  assert.equal(S().shipments.get("s1").depositPaymentError, "shipment_cancelled");
  assert.deepEqual(fakeStripe.sessionExpires, ["cs_s1"], "doar sesiunea livrării anulate");

  assert.equal(S().shipments.get("s3").status, "PENDING");
  assert.equal(S().shipments.get("s3").depositStatus, "PENDING", "avansul celuilalt vendor rămâne activ");
  assert.equal(S().orders.get("order-1").status, "PENDING", "comanda rămâne activă (mai are o livrare)");
});

test("V2 vendor anulează unica livrare: comanda devine CANCELLED, avansul expiră, sesiunea Stripe e expirată", async () => {
  seedOrder({ orderId: "order-1", paymentMethod: "COD", shipments: oneStore() });
  Object.assign(S().shipments.get("s1"), {
    depositStatus: "PENDING", depositRequestedAmount: 15, depositPercent: 15,
    stripeDepositSessionId: "cs_s1", depositMeta: {},
  });

  await vendorCancel("v1");

  assert.equal(S().orders.get("order-1").status, "CANCELLED");
  assert.equal(S().shipments.get("s1").depositStatus, "EXPIRED");
  assert.deepEqual(fakeStripe.sessionExpires, ["cs_s1"]);
});

test("V3 expirarea sesiunii Stripe eșuează (deja finalizată): anularea vendorului reușește oricum, iar plata târzie a avansului e rambursată de webhook", async () => {
  seedCodWithTwoPendingDeposits();
  fakeStripe.checkout.sessions.expire = async () => {
    throw new Error("session already completed");
  };

  await vendorCancel("v1");
  assert.equal(S().shipments.get("s1").status, "REFUSED");
  assert.equal(S().shipments.get("s1").depositStatus, "EXPIRED");

  const late = await postEvent({
    id: "evt_v3",
    type: "payment_intent.succeeded",
    livemode: false,
    data: {
      object: {
        id: "pi_dep_1", amount: 1500, amount_received: 1500, currency: "ron",
        metadata: { kind: "deposit_payment", shipmentId: "s1", vendorId: "v1", orderId: "order-1" },
        charges: { data: [{ id: "ch_dep", balance_transaction: { fee: 50 } }] },
      },
    },
  });

  assert.equal(late.status, 200);
  assert.equal(fakeStripe.refundCreates.length, 1, "plata târzie e rambursată");
  assert.equal(fakeStripe.transferCreates.length, 0, "vendorul nu primește transfer");
  assert.equal(S().shipments.get("s1").depositStatus, "REFUNDED");
  assert.equal(S().shipments.get("s1").status, "REFUSED", "livrarea rămâne anulată");
});

/* =========================================================
   Legacy: reluarea unui eveniment (id nou) pe un PaymentIntent procesat de
   codul VECHI nu mai dublează SALE-ul și nu mai transferă a doua oară.
========================================================= */
test("L10 LEGACY procesat de codul vechi (SALE fără shipmentId) + eveniment reluat cu id nou: niciun SALE nou, niciun transfer nou", async () => {
  seedOrder({ shipments: oneStore() });
  const o = S().orders.get("order-1");
  Object.assign(o, { status: "PAID", paidAt: new Date(), stripeChargeId: "ch_1" });
  S().entries.push({
    id: "legacy_v1", payoutId: null, createdAt: new Date(), occurredAt: new Date(),
    vendorId: "v1", orderId: "order-1", shipmentId: null, type: "SALE", currency: "RON",
    itemsNet: 10.05, commissionNet: 1.21, vendorNet: 8.84, stripeTransferId: "tr_old",
    meta: { kind: "online_order_vendor_transfer", paymentIntentId: "pi_legacy" },
  });

  const r = await postPaymentSucceeded({ eventId: "l10_replay", piId: "pi_legacy" });

  assert.equal(r.status, 200);
  assert.equal(saleRows().length, 1, "rămâne singurul SALE (cel legacy)");
  assert.equal(fakeStripe.transferCreates.length, 0, "niciun transfer nou");
  assert.equal(S().orders.get("order-1").status, "PAID");
});
