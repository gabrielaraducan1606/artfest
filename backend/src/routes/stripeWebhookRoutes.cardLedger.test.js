// src/routes/stripeWebhookRoutes.cardLedger.test.js
//
// Teste de integrare (cod REAL de producție, DB + Stripe false, în memorie)
// pentru ledger-ul CARD: UN SALE per shipment OUTBOUND, fără dublare între
// webhook-ul Stripe (payment_intent.succeeded) și ensureSaleLedgerEntry.
//
// Rulate REAL: stripeWebhookRoutes.js (router + handleOrderPaymentIntentSucceeded),
// marketplaceCalc.js (computeOrderSplits), vendorOrdersRoutes.js
// (computeVendorEarningForShipment / ensureSaleLedgerEntry / helper-ele de
// refund), orderRefundService.js, cardSaleLedger.js.
// Mock-uite STRICT: ../db.js, ../lib/stripe.js, @prisma/client (clientul propriu
// al lui vendorOrdersRoutes.js) -> același DB fals.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/stripeWebhookRoutes.cardLedger.test.js

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
      state.eventRows = new Map();
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

  // StripeEvent cu stări (PROCESSING/COMPLETED/FAILED): webhook-ul acum
  // distinge duplicatul COMPLETED de un eveniment FAILED reluabil
  // (services/stripeEventClaim.js), deci fake-ul trebuie să le rețină.
  db.stripeEvent = {
    create: async ({ data }) => {
      if (state.events.has(data.eventId)) throw p2002();
      state.events.add(data.eventId);
      state.eventRows.set(data.eventId, { ...data, receivedAt: new Date(), processedAt: null, error: null });
      return data;
    },
    findUnique: async ({ where: { eventId } }) => {
      const row = state.eventRows.get(eventId);
      return row ? { ...row } : null;
    },
    updateMany: async ({ where, data }) => {
      const row = state.eventRows.get(where.eventId);
      if (!row) return { count: 0 };
      const ok = Object.entries(where).every(([k, v]) => {
        if (k === "eventId") return true;
        if (v instanceof Date) return row[k] instanceof Date && row[k].getTime() === v.getTime();
        return row[k] === v;
      });
      if (!ok) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
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
   A. CARD, un singur magazin: webhook -> IN_TRANSIT -> DELIVERED
========================================================= */
test("A. CARD un shipment: webhook -> IN_TRANSIT -> DELIVERED = exact UN SALE (cu shipmentId)", async () => {
  seedOrder({ shipments: [{ id: "s1", vendorId: "v1", price: 15, items: [{ price: 20.1 }] }] });

  const res = await postPaymentSucceeded();
  assert.equal(res.status, 200);
  assert.equal(S().orders.get("order-1").status, "PAID");

  assert.equal(saleRows().length, 1);
  assert.equal(saleRows()[0].shipmentId, "s1");
  assert.ok(saleRows()[0].stripeTransferId);

  const before = JSON.stringify(saleRows()[0]);

  // IN_TRANSIT, apoi DELIVERED (același trigger, ensureSaleLedgerEntry)
  await vendorOrders.ensureSaleLedgerEntry({ vendorId: "v1", shipmentId: "s1" });
  await vendorOrders.ensureSaleLedgerEntry({ vendorId: "v1", shipmentId: "s1" });

  assert.equal(saleRows().length, 1, "triggerul de status NU creează al doilea SALE");
  assert.equal(JSON.stringify(saleRows()[0]), before, "rândul webhook rămâne neatins de upsert (update: {})");
  assert.equal(fakeStripe.transferCreates.length, 1);
});

/* =========================================================
   B + C. Două magazine ale aceluiași vendor
========================================================= */
test("B+C. CARD două shipment-uri OUTBOUND, același vendor: 2 SALE, total = computeOrderSplits (2,41), ultimul absoarbe reziduul, UN transfer", async () => {
  seedOrder({ shipments: twoStores() });

  const res = await postPaymentSucceeded();
  assert.equal(res.status, 200);

  const rows = saleRows();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.shipmentId).sort(), ["s1", "s2"]);

  const vendorTotal = await vendorCommissionFromSplits("order-1", "v1");
  assert.equal(vendorTotal, 2.41, "computeOrderSplits per vendor (agregat)");

  // per-shipment COD ar da 1,21 + 1,21 = 2,42 - ledger-ul trebuie să rămână la 2,41
  assert.equal(sumCents(rows, "commissionNet"), cents(vendorTotal));
  assert.deepEqual(
    rows.sort((a, b) => a.shipmentId.localeCompare(b.shipmentId)).map((r) => r.commissionNet),
    [1.21, 1.2]
  );

  // UN singur transfer Stripe, pe suma vendorului; același id pe ambele rânduri
  assert.equal(fakeStripe.transferCreates.length, 1);
  assert.equal(fakeStripe.transferCreates[0].amount, 2010 - 150);
  assert.equal(new Set(rows.map((r) => r.stripeTransferId)).size, 1);

  // triggerul de status rulează după webhook: nimic nou
  await vendorOrders.ensureSaleLedgerEntry({ vendorId: "v1", shipmentId: "s1" });
  await vendorOrders.ensureSaleLedgerEntry({ vendorId: "v1", shipmentId: "s2" });
  assert.equal(saleRows().length, 2);
  assert.equal(sumCents(saleRows(), "commissionNet"), cents(vendorTotal));
});

/* =========================================================
   D. Own-sale: total ledger rămâne cel din computeOrderSplits
========================================================= */
test("D. CARD own-sale: total ledger = computeOrderSplits (nu se aplică override-ul), transferul neschimbat", async () => {
  seedOrder({
    shipments: [
      { id: "s1", vendorId: "v1", items: [{ price: 10.05 }], vendorReferralCommissionOverrideBps: 500 },
      { id: "s2", vendorId: "v1", items: [{ price: 10.05 }] },
    ],
  });

  await postPaymentSucceeded();

  const vendorTotal = await vendorCommissionFromSplits("order-1", "v1");
  assert.equal(vendorTotal, 2.41);
  assert.equal(sumCents(saleRows(), "commissionNet"), cents(vendorTotal));

  const s1 = saleRows().find((r) => r.shipmentId === "s1");
  assert.equal(s1.meta.cardAllocation.shipmentComputedCommissionNet, 0.5, "COD ar fi dat 5% doar pe acest shipment");

  // transferul Stripe = gross - fee, exact ca înainte (nu depinde de comision)
  assert.equal(fakeStripe.transferCreates.length, 1);
  assert.equal(fakeStripe.transferCreates[0].amount, 2010 - 150);
});

/* =========================================================
   E. Webhook retrimis
========================================================= */
test("E. payment_intent.succeeded retrimis (același event id ȘI event id nou pe același PI): zero SALE/transfer în plus", async () => {
  seedOrder({ shipments: twoStores() });

  await postPaymentSucceeded({ eventId: "evt_1" });
  const snapshot = JSON.stringify(saleRows());

  // 1) exact același event (Stripe retry) -> StripeEvent unic
  const dup = await postPaymentSucceeded({ eventId: "evt_1" });
  assert.equal(dup.body.duplicate, true);

  // 2) event NOU pentru același PaymentIntent -> handlerul rulează din nou
  const again = await postPaymentSucceeded({ eventId: "evt_2" });
  assert.equal(again.status, 200);

  assert.equal(saleRows().length, 2);
  assert.equal(fakeStripe.transferCreates.length, 1, "idempotencyKey pe transfer");
  assert.equal(fakeStripe.transfers_.size, 1);

  const after = saleRows().map((r) => ({ id: r.id, shipmentId: r.shipmentId, c: r.commissionNet, t: r.stripeTransferId }));
  const first = JSON.parse(snapshot).map((r) => ({ id: r.id, shipmentId: r.shipmentId, c: r.commissionNet, t: r.stripeTransferId }));
  assert.deepEqual(after, first);
});

/* =========================================================
   F. Trigger înainte de webhook (ensureSaleLedgerEntry creează primul)
========================================================= */
test("F. ensureSaleLedgerEntry ÎNAINTE de webhook: webhook-ul actualizează rândul (nu creează), total = computeOrderSplits", async () => {
  seedOrder({ shipments: twoStores() });

  await vendorOrders.ensureSaleLedgerEntry({ vendorId: "v1", shipmentId: "s1" });
  assert.equal(saleRows().length, 1);
  assert.equal(saleRows()[0].meta.source, "shipment_status_fulfilled");
  assert.equal(saleRows()[0].stripeTransferId, undefined);
  const preId = saleRows()[0].id;

  await postPaymentSucceeded();

  const rows = saleRows();
  assert.equal(rows.length, 2, "s1 actualizat, s2 creat - fără duplicat");
  assert.equal(rows.find((r) => r.shipmentId === "s1").id, preId, "același rând, actualizat");
  assert.ok(rows.every((r) => r.stripeTransferId));
  assert.equal(rows.find((r) => r.shipmentId === "s1").meta.source, "shipment_status_fulfilled");

  const vendorTotal = await vendorCommissionFromSplits("order-1", "v1");
  assert.equal(sumCents(rows, "commissionNet"), cents(vendorTotal));
});

/* =========================================================
   H. RETURN nu creează niciodată SALE
========================================================= */
test("H. shipment RETURN pe aceeași comandă/vendor: zero SALE pentru el", async () => {
  seedOrder({
    shipments: [
      { id: "s1", vendorId: "v1", items: [{ price: 20.1 }] },
      { id: "r1", vendorId: "v1", direction: "RETURN", price: 0, items: [] },
    ],
  });

  await postPaymentSucceeded();

  assert.deepEqual(saleRows().map((r) => r.shipmentId), ["s1"]);
  assert.ok(!S().entries.some((e) => e.shipmentId === "r1"));
  assert.equal(fakeStripe.transferCreates.length, 1);
});

/* =========================================================
   Multi-vendor: un transfer per vendor, fără contaminare
========================================================= */
test("multi-vendor: v1 (2 magazine) + v2 (1): 3 SALE, 2 transferuri (unul per vendor), totaluri per vendor exacte", async () => {
  seedOrder({
    shipments: [
      { id: "s1", vendorId: "v1", items: [{ price: 10.05 }] },
      { id: "s2", vendorId: "v1", items: [{ price: 10.05 }] },
      { id: "s3", vendorId: "v2", items: [{ price: 33.33 }] },
    ],
  });

  await postPaymentSucceeded();

  assert.equal(saleRows().length, 3);
  assert.equal(fakeStripe.transferCreates.length, 2);

  for (const vendorId of ["v1", "v2"]) {
    const rows = saleRows().filter((r) => r.vendorId === vendorId);
    const total = await vendorCommissionFromSplits("order-1", vendorId);
    assert.equal(sumCents(rows, "commissionNet"), cents(total), `total ${vendorId}`);
    assert.equal(new Set(rows.map((r) => r.stripeTransferId)).size, 1, `un transfer ${vendorId}`);
  }
});

/* =========================================================
   I. Refund CARD cu mai multe shipment-uri
========================================================= */
test("I. refund CARD cu 2 shipment-uri ale aceluiași vendor: transfer reversat o dată, ambele SALE reversate, nimic activ la facturare", async () => {
  seedOrder({ shipments: twoStores() });
  await postPaymentSucceeded();

  const order = await fakeDb.order.findUnique({ where: { id: "order-1" } });
  // webhook-ul a setat stripeChargeId pe comandă
  assert.equal(order.stripeChargeId, "ch_1");

  const vendorTotal = await vendorCommissionFromSplits("order-1", "v1");
  const beforeOpen = sumCents(
    S().entries.filter((e) => e.payoutId == null),
    "commissionNet"
  );
  assert.equal(beforeOpen, cents(vendorTotal));

  const result = await refundService.refundCardOrderFully({ order, prisma: fakeDb, stripe: fakeStripe });
  assert.equal(result.status, 200);
  assert.equal(result.body.dbReversalNeedsAttention, false);

  // transferul (unul) reversat o singură dată
  assert.equal(fakeStripe.reversalCreates.length, 1);
  assert.equal(result.body.reversals.length, 1);
  assert.equal(fakeStripe.refundCreates.length, 1);

  const refunds = S().entries.filter((e) => e.type === "REFUND");
  assert.equal(refunds.length, 2);
  assert.deepEqual(refunds.map((r) => r.meta.refShipmentId).sort(), ["s1", "s2"]);

  // suma reversată = exact suma pusă în ledger
  assert.equal(sumCents(refunds, "commissionNet"), -sumCents(saleRows(), "commissionNet"));
  assert.equal(sumCents(refunds, "itemsNet"), -sumCents(saleRows(), "itemsNet"));
  assert.equal(sumCents(refunds, "vendorNet"), -sumCents(saleRows(), "vendorNet"));

  // ce ar fi facturat lunar (payoutId null, SALE+REFUND): comision net 0
  assert.equal(sumCents(S().entries.filter((e) => e.payoutId == null), "commissionNet"), 0);

  // retry: idempotent (niciun REFUND nou, niciun Stripe nou)
  const retry = await refundService.refundCardOrderFully({ order: await fakeDb.order.findUnique({ where: { id: "order-1" } }), prisma: fakeDb, stripe: fakeStripe });
  assert.equal(retry.status, 200);
  assert.equal(S().entries.filter((e) => e.type === "REFUND").length, 2);
  assert.equal(fakeStripe.reversalCreates.length, 1);
  assert.equal(fakeStripe.refundCreates.length, 1);
});

/* =========================================================
   J. COD neschimbat
========================================================= */
test("J. COD: ensureSaleLedgerEntry se comportă exact ca înainte (un SALE per shipment, calcul per shipment, fără Stripe)", async () => {
  seedOrder({ orderId: "order-cod", paymentMethod: "COD", shipments: [{ id: "c1", vendorId: "v1", items: [{ price: 10.05 }] }] });

  await vendorOrders.ensureSaleLedgerEntry({ vendorId: "v1", shipmentId: "c1" });
  await vendorOrders.ensureSaleLedgerEntry({ vendorId: "v1", shipmentId: "c1" });

  assert.equal(saleRows().length, 1);
  const row = saleRows()[0];
  assert.equal(row.shipmentId, "c1");
  assert.equal(row.meta.source, "shipment_status_fulfilled");
  assert.equal(row.commissionNet, 1.21); // 10,05 * 12% rotunjit per shipment (logica COD)
  assert.equal(row.stripeTransferId, undefined);
  assert.equal(fakeStripe.transferCreates.length, 0);
});

/* =========================================================
   K. computeVendorEarningForShipment aruncă -> transferul NU e blocat
========================================================= */
test("K. computeVendorEarningForShipment aruncă (pe toate shipment-urile): webhook 200, transferul Stripe are loc, ledger creat, total = computeOrderSplits, fără duplicate", async () => {
  seedOrder({ shipments: twoStores() });
  S().failShipmentFindUnique = new Set(["s1", "s2"]);

  const errorLog = mock.method(console, "error", () => {});

  try {
    const res = await postPaymentSucceeded();

    assert.equal(res.status, 200, "handlerul NU eșuează");
    assert.equal(S().orders.get("order-1").status, "PAID");

    // transferul Stripe a avut loc, exact ca în cazul normal
    assert.equal(fakeStripe.transferCreates.length, 1);
    assert.equal(fakeStripe.transferCreates[0].amount, 2010 - 150);

    // ledger creat: un SALE per shipment OUTBOUND, același transfer
    const rows = saleRows();
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.shipmentId).sort(), ["s1", "s2"]);
    assert.equal(new Set(rows.map((r) => r.stripeTransferId)).size, 1);
    assert.ok(rows.every((r) => r.meta.cardAllocation.earningUnavailable === true));

    // total commissionNet = computeOrderSplits, exact
    const vendorTotal = await vendorCommissionFromSplits("order-1", "v1");
    assert.equal(vendorTotal, 2.41);
    assert.equal(sumCents(rows, "commissionNet"), cents(vendorTotal));

    // vendorNet rămâne semantica COD (itemsNet - commissionNet) și în fallback
    for (const r of rows) {
      assert.equal(cents(r.vendorNet), cents(r.itemsNet) - cents(r.commissionNet));
    }

    // eroarea a fost logată (câte una per shipment), cu context de debugging
    const planLogs = errorLog.mock.calls.filter((c) => String(c.arguments[0]).includes("[cardSaleLedger]"));
    assert.equal(planLogs.length, 2);
    assert.equal(planLogs[0].arguments[1].orderId, "order-1");
    assert.equal(planLogs[0].arguments[1].vendorId, "v1");
    assert.equal(planLogs[0].arguments[1].error, "simulated_db_blip");

    // fără duplicate: retry cu event nou + trigger de status
    S().failShipmentFindUnique = new Set();
    const again = await postPaymentSucceeded({ eventId: "evt_2" });
    assert.equal(again.status, 200);
    await vendorOrders.ensureSaleLedgerEntry({ vendorId: "v1", shipmentId: "s1" });
    await vendorOrders.ensureSaleLedgerEntry({ vendorId: "v1", shipmentId: "s2" });

    assert.equal(saleRows().length, 2);
    assert.equal(fakeStripe.transferCreates.length, 1, "idempotencyKey: tot un singur transfer");
    assert.equal(sumCents(saleRows(), "commissionNet"), cents(vendorTotal));
  } finally {
    errorLog.mock.restore();
  }
});

test("K'. computeVendorEarningForShipment aruncă doar pe UN shipment: transfer + ledger complet, total exact", async () => {
  seedOrder({ shipments: twoStores() });
  S().failShipmentFindUnique = new Set(["s2"]);

  const errorLog = mock.method(console, "error", () => {});

  try {
    const res = await postPaymentSucceeded();
    assert.equal(res.status, 200);
    assert.equal(fakeStripe.transferCreates.length, 1);
    assert.equal(saleRows().length, 2);

    const vendorTotal = await vendorCommissionFromSplits("order-1", "v1");
    assert.equal(sumCents(saleRows(), "commissionNet"), cents(vendorTotal));
  } finally {
    errorLog.mock.restore();
  }
});

test("K''. alte erori NU sunt mascate: vendor fără shipment OUTBOUND (doar RETURN) -> handler 500, NICIUN transfer, niciun SALE", async () => {
  seedOrder({
    shipments: [{ id: "r1", vendorId: "v1", direction: "RETURN", price: 0, items: [{ price: 20.1 }] }],
  });

  const errorLog = mock.method(console, "error", () => {});

  try {
    const res = await postPaymentSucceeded();

    assert.equal(res.status, 500);
    assert.equal(fakeStripe.transferCreates.length, 0);
    assert.equal(S().entries.length, 0);
  } finally {
    errorLog.mock.restore();
  }
});
