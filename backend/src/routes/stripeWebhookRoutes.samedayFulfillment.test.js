// src/routes/stripeWebhookRoutes.samedayFulfillment.test.js
//
// Etapa 1 Sameday prin Artfest (F1): transportul ARTFEST_SAMEDAY e al Artfest - nu intră în
// transferul Stripe al vendorului; taxa Stripe pe acest transport e suportată de Artfest.
// Compatibilitate: fulfillment null = EXACT comportamentul existent. Cod REAL (webhook, ledger,
// refund), DB + Stripe false (același harness ca stripeWebhookRoutes.cardLedger.test.js).
//
// Rulare: node --experimental-test-module-mocks --test src/routes/stripeWebhookRoutes.samedayFulfillment.test.js

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
        .map((s) => ({ id: s.id, price: s.price, fulfillment: s.fulfillment ?? null })),
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
      fulfillment: sh.fulfillment ?? null,
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
/* =========================================================
   ETAPA 1 SAMEDAY - scenarii pe codul REAL (webhook + ledger + refund), DB/Stripe false
========================================================= */
const transferTo = (vendorId) => fakeStripe.transferCreates.filter((t) => t.destination === `acct_${vendorId}`);
const totalTransferred = () => fakeStripe.transferCreates.reduce((t, x) => t + x.amount, 0);
const itemsCents = (id) => S().shipments.get(id).items.reduce((t, i) => t + cents(i.price) * i.qty, 0);

test("S1. null (comandă existentă): transferul include transportul, EXACT ca înainte", async () => {
  seedOrder({ shipments: [{ id: "s1", vendorId: "v1", price: 15, items: [{ price: 20.1 }] }] });
  await postPaymentSucceeded({ feeCents: 150 });
  assert.equal(transferTo("v1")[0].amount, 2010 + 1500 - 150);
  assert.equal(saleRows()[0].meta.shippingNet, 15);
  assert.equal(saleRows()[0].meta.shippingOwner, undefined);
});

test("S2. ARTFEST_SAMEDAY: transportul NU se transferă; Artfest suportă taxa pe transport; invariant în cenți", async () => {
  seedOrder({ shipments: [{ id: "s1", vendorId: "v1", price: 15, fulfillment: "ARTFEST_SAMEDAY", items: [{ price: 20.1 }] }] });
  const total = orderTotalCents("order-1");
  await postPaymentSucceeded({ feeCents: 150 });
  const transfer = transferTo("v1")[0].amount;
  // taxa: vendor 2010/3510*150 = 85,89... -> cenți (cel mai mare rest): vendor 86, Artfest 64
  assert.equal(transfer, 2010 - 86);
  assert.equal(total - 150 - transfer, 1500 - 64, "Artfest reține transportul minus taxa lui");
  const row = saleRows()[0];
  assert.equal(row.meta.shippingNet, 0);
  assert.equal(row.meta.shippingOwner, "ARTFEST");
  assert.equal(row.meta.artfestShippingGross, 15);
  // comisionul neschimbat față de varianta null
  assert.equal(Number(row.commissionNet), cents(await vendorCommissionFromSplits("order-1", "v1")) / 100);
});

test("S3. două magazine ale aceluiași vânzător, unul Sameday și unul curier propriu: UN transfer, 2 SALE, sume exacte", async () => {
  seedOrder({ shipments: [
    { id: "s1", vendorId: "v1", price: 15, fulfillment: "ARTFEST_SAMEDAY", items: [{ price: 30 }] },
    { id: "s2", vendorId: "v1", price: 20, fulfillment: "VENDOR_COURIER", items: [{ price: 45.5 }] },
  ] });
  const total = orderTotalCents("order-1");
  await postPaymentSucceeded({ feeCents: 333 });
  assert.equal(transferTo("v1").length, 1);
  const transfer = transferTo("v1")[0].amount;
  // vendor: 3000 + 4550 + 2000 = 9550 ; Artfest: 1500 ; taxa 333 -> 9550/11050*333 = 287,79 -> 288 ; Artfest 45
  assert.equal(transfer, 9550 - 288);
  assert.equal(total - 333 - transfer, 1500 - 45);
  const rows = saleRows().sort((a, b) => (a.shipmentId < b.shipmentId ? -1 : 1));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].meta.shippingNet, 0);
  assert.equal(rows[0].meta.shippingOwner, "ARTFEST");
  assert.equal(rows[1].meta.shippingNet, 20);
  assert.equal(rows[1].meta.shippingOwner, undefined);
  assert.equal(sumCents(rows.map((r) => r.meta), "stripeFeeAllocated"), 288);
  assert.equal(sumCents(rows.map((r) => r.meta), "gross"), 9550);
});

test("S4. mai mulți vânzători (unul Sameday, unul curier propriu) + transport gratuit Sameday", async () => {
  seedOrder({ shipments: [
    { id: "a1", vendorId: "va", price: 0, fulfillment: "ARTFEST_SAMEDAY", items: [{ price: 50 }] },
    { id: "b1", vendorId: "vb", price: 18.5, fulfillment: "VENDOR_COURIER", items: [{ price: 25.25, qty: 2 }] },
  ] });
  const total = orderTotalCents("order-1");
  await postPaymentSucceeded({ feeCents: 211 });
  // fără transport Artfest (gratuit) -> algoritmul existent (vendorii; ultimul absoarbe rotunjirea)
  const ta = transferTo("va")[0].amount;
  const tb = transferTo("vb")[0].amount;
  assert.equal(ta + tb, total - 211, "nimic reținut de Artfest când transportul Sameday e 0");
});

test("S5. idempotență: webhook retrimis (alt event, același PI) -> niciun transfer nou, niciun SALE dublat", async () => {
  seedOrder({ shipments: [{ id: "s1", vendorId: "v1", price: 15, fulfillment: "ARTFEST_SAMEDAY", items: [{ price: 20.1 }] }] });
  await postPaymentSucceeded({ eventId: "evt_1" });
  await postPaymentSucceeded({ eventId: "evt_1" });
  await postPaymentSucceeded({ eventId: "evt_2" });
  assert.equal(fakeStripe.transferCreates.length, 1);
  assert.equal(saleRows().length, 1);
  assert.equal(S().entries.filter((e) => e.type === "SALE" && e.shipmentId === "s1").length, 1);
});

test("S6. refund integral după Sameday: reversare EXACT cât s-a transferat, clientul primește tot, comision reversat", async () => {
  seedOrder({ shipments: [
    { id: "s1", vendorId: "v1", price: 15, fulfillment: "ARTFEST_SAMEDAY", items: [{ price: 30 }] },
    { id: "s2", vendorId: "v1", price: 20, fulfillment: "VENDOR_COURIER", items: [{ price: 45.5 }] },
  ] });
  const total = orderTotalCents("order-1");
  await postPaymentSucceeded({ feeCents: 333 });
  const transferred = totalTransferred();
  const order = await fakeDb.order.findUnique({ where: { id: "order-1" } });
  const result = await refundService.refundCardOrderFully({ order, prisma: fakeDb, stripe: fakeStripe });
  assert.equal(result.status, 200);
  assert.equal(fakeStripe.reversalCreates.reduce((t, r) => t + r.opts.amount, 0), transferred, "reversat exact suma transferată");
  assert.equal(fakeStripe.refundCreates.reduce((t, r) => t + r.amount, 0), total, "clientul rambursat integral (inclusiv transportul Sameday)");
  assert.equal(sumCents(S().entries.filter((e) => e.payoutId == null), "commissionNet"), 0);
  // retry idempotent
  await refundService.refundCardOrderFully({ order: await fakeDb.order.findUnique({ where: { id: "order-1" } }), prisma: fakeDb, stripe: fakeStripe });
  assert.equal(fakeStripe.reversalCreates.length, 1);
  assert.equal(fakeStripe.refundCreates.length, 1);
});

test("S7. plată eșuată: niciun transfer, niciun SALE, comanda neplătită", async () => {
  seedOrder({ shipments: [{ id: "s1", vendorId: "v1", price: 15, fulfillment: "ARTFEST_SAMEDAY", items: [{ price: 20.1 }] }] });
  const res = await fetch(`${baseUrl}/api/stripe/webhook/`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "sig" },
    body: JSON.stringify({ id: "evt_f", type: "payment_intent.payment_failed", livemode: false, data: { object: { id: "pi_1", metadata: { orderId: "order-1" } } } }),
  });
  assert.ok(res.status < 500);
  assert.equal(fakeStripe.transferCreates.length, 0);
  assert.equal(saleRows().length, 0);
  assert.notEqual(S().orders.get("order-1").status, "PAID");
});

test("S8. reducere pe produs + Sameday: comisionul pe produse neschimbat față de null", async () => {
  const mk = (f) => [{ id: "s1", vendorId: "v1", price: 12, fulfillment: f, items: [{ price: 40 }] }];
  seedOrder({ shipments: mk(null) });
  S().shipments.get("s1").items[0].vendorDiscountAmount = 5;
  const before = await vendorCommissionFromSplits("order-1", "v1");
  fakeDb.reset();
  seedOrder({ shipments: mk("ARTFEST_SAMEDAY") });
  S().shipments.get("s1").items[0].vendorDiscountAmount = 5;
  const after = await vendorCommissionFromSplits("order-1", "v1");
  assert.equal(after, before);
});

test("S9. retur în aceeași comandă (shipment RETURN) + Sameday: SALE doar pe OUTBOUND, transfer fără transportul Sameday", async () => {
  seedOrder({ shipments: [
    { id: "s1", vendorId: "v1", price: 15, fulfillment: "ARTFEST_SAMEDAY", items: [{ price: 30 }] },
    { id: "r1", vendorId: "v1", price: 0, direction: "RETURN", items: [] },
  ] });
  await postPaymentSucceeded({ feeCents: 100 });
  assert.deepEqual(saleRows().map((r) => r.shipmentId), ["s1"]);
  assert.equal(transferTo("v1").length, 1);
  assert.ok(transferTo("v1")[0].amount < 3000);
});

test("S10. rambursare parțială manuală (ex. transportul Sameday din Stripe Dashboard) + rambursare integrală: fără sume duble", async () => {
  seedOrder({ shipments: [
    { id: "s1", vendorId: "v1", price: 15, fulfillment: "ARTFEST_SAMEDAY", items: [{ price: 30 }] },
    { id: "s2", vendorId: "v2", price: 20, fulfillment: "VENDOR_COURIER", items: [{ price: 45.5 }] },
  ] });
  const total = orderTotalCents("order-1");
  await postPaymentSucceeded({ feeCents: 333 });
  const transferred = totalTransferred();
  // în aplicație NU există rambursare parțială pe CARD; simulăm una făcută manual în Stripe (1500 = transportul Sameday)
  fakeStripe.charge.amount_refunded = 1500;
  const order = await fakeDb.order.findUnique({ where: { id: "order-1" } });
  const result = await refundService.refundCardOrderFully({ order, prisma: fakeDb, stripe: fakeStripe });
  assert.equal(result.status, 200);
  assert.equal(fakeStripe.refundCreates.reduce((t, r) => t + r.amount, 0), total - 1500, "se rambursează doar restul");
  assert.equal(fakeStripe.charge.amount_refunded, total, "clientul primește în total exact cât a plătit");
  assert.equal(fakeStripe.reversalCreates.reduce((t, r) => t + r.opts.amount, 0), transferred, "vânzătorilor li se reversează exact cât au primit");
  await refundService.refundCardOrderFully({ order: await fakeDb.order.findUnique({ where: { id: "order-1" } }), prisma: fakeDb, stripe: fakeStripe });
  assert.equal(fakeStripe.refundCreates.length, 1, "fără a doua rambursare");
  assert.equal(fakeStripe.reversalCreates.length, 2, "câte o reversare per transfer, o singură dată");
});
