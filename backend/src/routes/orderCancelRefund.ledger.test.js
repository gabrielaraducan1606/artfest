// src/routes/orderCancelRefund.ledger.test.js
//
// Ledger la CARD plătit -> cancel/refund ÎNAINTE de livrare, cu forma REALĂ
// a datelor din producție: la plata CARD, webhook-ul Stripe creează un
// VendorEarningEntry SALE per vendor cu stripeTransferId, dar FĂRĂ
// shipmentId (stripeWebhookRoutes.js, meta.kind =
// "online_order_vendor_transfer"). Intrarea SALE legată de shipment
// (ensureSaleLedgerEntry) se creează abia la DELIVERED/IN_TRANSIT.
//
// Testele existente adminOrdersRoutes.refund.test.js seedează intrări cu
// shipmentId + stripeTransferId pe același rând (formă care nu apare în
// producție la o comandă nelivrată) și nu prind lipsa reversării.
//
// Rutele REALE (admin refund + user cancel), serviciul real de refund și
// helper-ele reale de ledger; mock-uri doar pe DB (in-memory), Stripe
// (stateful), auth și trimiterile de email/notificări.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/orderCancelRefund.ledger.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";

import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

/* =========================================================
   Fake DB in-memory (doar formele de query folosite)
========================================================= */

function matchesWhere(row, where = {}) {
  for (const [key, cond] of Object.entries(where)) {
    if (key === "OR") continue;
    if (cond && typeof cond === "object" && "path" in cond && "equals" in cond) {
      let cur = row[key];
      for (const p of cond.path) cur = cur?.[p];
      if (cur !== cond.equals) return false;
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

function project(row, select) {
  if (!select) return { ...row };
  const out = {};
  for (const key of Object.keys(select)) if (select[key]) out[key] = row[key];
  return out;
}

function makeFakeDb() {
  const orders = new Map();
  const shipments = new Map();
  const vendors = new Map();
  const vendorEntries = [];
  const influencerEntries = [];
  const referralEntries = [];
  let seq = 0;

  const earningModel = (store) => ({
    findMany: async ({ where, select, orderBy, take } = {}) => {
      let rows = store.filter((r) => matchesWhere(r, where));
      if (orderBy?.createdAt === "desc") rows = [...rows].sort((a, b) => b.createdAt - a.createdAt);
      if (take) rows = rows.slice(0, take);
      return rows.map((r) => project(r, select));
    },
    findUnique: async ({ where, select }) => {
      const row = store.find((r) => matchesWhere(r, where));
      return row ? project(row, select) : null;
    },
    findFirst: async ({ where, select }) => {
      const row = store.find((r) => matchesWhere(r, where));
      return row ? project(row, select) : null;
    },
    create: async ({ data }) => {
      const row = { id: `earn_${++seq}`, createdAt: new Date(), shipmentId: null, ...data };
      store.push(row);
      return { ...row };
    },
    updateMany: async ({ where, data }) => {
      const rows = store.filter((r) => matchesWhere(r, where));
      for (const r of rows) Object.assign(r, data);
      return { count: rows.length };
    },
  });

  const withShipments = (order, { items = false } = {}) => ({
    ...order,
    shipments: (order.shipmentIds || []).map((sid) => ({
      ...shipments.get(sid),
      ...(items ? { items: [] } : {}),
      vendor: vendors.get(shipments.get(sid).vendorId) || null,
    })),
  });

  const db = {
    __orders: orders,
    __shipments: shipments,
    __vendorEntries: vendorEntries,
    __influencerEntries: influencerEntries,
    __referralEntries: referralEntries,

    order: {
      findFirst: async ({ where }) => {
        const o = orders.get(where.id);
        if (!o || (where.userId && o.userId !== where.userId)) return null;
        return { ...withShipments(o, { items: true }), user: { email: "client@example.com" } };
      },
      findUnique: async ({ where: { id }, select }) => {
        const o = orders.get(id);
        if (!o) return null;
        return select ? project(o, select) : withShipments(o);
      },
      update: async ({ where: { id }, data }) => {
        Object.assign(orders.get(id), data);
        return { ...orders.get(id) };
      },
    },

    shipment: {
      findUnique: async ({ where: { id }, select }) => {
        const s = shipments.get(id);
        return s ? project(s, select) : null;
      },
      findMany: async ({ where, select }) =>
        [...shipments.values()].filter((s) => matchesWhere(s, where)).map((s) => project(s, select)),
      update: async ({ where: { id }, data }) => {
        Object.assign(shipments.get(id), data);
        return { ...shipments.get(id) };
      },
      updateMany: async ({ where, data }) => {
        const rows = [...shipments.values()].filter((s) => matchesWhere(s, where));
        for (const r of rows) Object.assign(r, data);
        return { count: rows.length };
      },
    },

    vendorEarningEntry: earningModel(vendorEntries),
    influencerEarningEntry: earningModel(influencerEntries),
    vendorReferralEarningEntry: earningModel(referralEntries),

    $transaction: async (cb) => cb(db),
  };

  return db;
}

/* =========================================================
   Fake Stripe stateful (aceeași semantică ca în testul admin)
========================================================= */

function makeFakeStripe({ chargeAmount, transferAmounts }) {
  const charge = { id: "ch_1", amount: chargeAmount, amount_refunded: 0 };
  const transfers = new Map(
    Object.entries(transferAmounts).map(([id, amount]) => [id, { id, amount, amount_reversed: 0 }])
  );
  const refunds = [];
  const reversals = [];

  return {
    transfers: {
      retrieve: async (id) => ({ ...transfers.get(id) }),
      createReversal: async (id, opts) => {
        reversals.push({ id, opts });
        transfers.get(id).amount_reversed += opts.amount;
        return { id: `trr_${reversals.length}`, amount: opts.amount };
      },
    },
    charges: { retrieve: async () => ({ ...charge }) },
    refunds: {
      create: async (opts) => {
        refunds.push(opts);
        charge.amount_refunded += opts.amount;
        return { id: `re_${refunds.length}` };
      },
    },
    __calls: { refunds, reversals },
  };
}

/* =========================================================
   Bootstrap
========================================================= */

let fakeDb;
let fakeStripe;
let server;
let baseUrl;
let restoreAll;

const dbProxy = new Proxy({}, { get: (_t, key) => fakeDb[key] });
const stripeProxy = new Proxy({}, { get: (_t, key) => fakeStripe[key] });

before(async () => {
  const mocks = [];
  const reg = (spec, exports) => mocks.push(mock.module(spec, { namedExports: exports }));

  reg("../db.js", { prisma: dbProxy });
  reg("../lib/stripe.js", { stripe: stripeProxy });
  reg("../api/auth.js", {
    authRequired: (req, _res, next) => {
      req.user = { sub: "user-1", email: "test@local" };
      next();
    },
    requireRole: () => (_req, _res, next) => next(),
    enforceTokenVersion: (_req, _res, next) => next(),
  });

  // Modulele care trimit email/notificări: păstrăm exporturile reale
  // (le importă și vendorOrdersRoutes), dar neutralizăm efectele.
  const actualMailer = await import("../lib/mailer.js");
  const actualMessaging = await import("../services/orderMessaging.js");
  const actualOrchestrator = await import("../payments/orchestrator.js");
  const actualStock = await import("../services/stockRestore.js");

  reg("../lib/mailer.js", { ...actualMailer, sendOrderCancelledByUserEmail: async () => {} });
  reg("../services/orderMessaging.js", {
    ...actualMessaging,
    sendOrderCancelledByUserNotifications: async () => {},
  });
  reg("../payments/orchestrator.js", { ...actualOrchestrator });
  reg("../services/stockRestore.js", { ...actualStock, restoreStockFromItems: async () => {} });

  restoreAll = () => mocks.forEach((m) => m.restore());

  const adminRouter = (await import(`./adminOrdersRoutes.js?t=${Date.now()}-a`)).default;
  const userRouter = (await import(`./userOrdersRoutes.js?t=${Date.now()}-u`)).default;

  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter);
  app.use("/api/user/orders", userRouter);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  restoreAll?.();
});

/* =========================================================
   Seed: comandă CARD plătită, nelivrată, cu intrările REALE de la plată
========================================================= */

function seedPaidCardOrder({ vendors = ["vA"], shipmentStatus = "PENDING", orderStatus = "PAID" } = {}) {
  fakeDb = makeFakeDb();

  const perVendor = { itemsNet: 100, commissionNet: 10, vendorNet: 90 };
  const transferAmounts = {};

  fakeDb.__orders.set("o1", {
    id: "o1",
    userId: "user-1",
    orderNumber: "AF-2001",
    paymentMethod: "CARD",
    status: orderStatus,
    paidAt: new Date(),
    currency: "RON",
    stripeChargeId: "ch_1",
    adminNotes: "",
    shipmentIds: vendors.map((v) => `ship-${v}`),
  });

  for (const v of vendors) {
    fakeDb.__shipments.set(`ship-${v}`, {
      id: `ship-${v}`,
      orderId: "o1",
      vendorId: v,
      status: shipmentStatus,
      depositStatus: "NOT_REQUESTED",
      cancelReason: null,
    });

    // Intrarea REALĂ de la plată: fără shipmentId, cu stripeTransferId.
    fakeDb.__vendorEntries.push({
      id: `T-${v}`,
      createdAt: new Date(),
      vendorId: v,
      orderId: "o1",
      shipmentId: null,
      type: "SALE",
      currency: "RON",
      ...perVendor,
      stripeTransferId: `tr_${v}`,
      meta: { kind: "online_order_vendor_transfer" },
    });

    transferAmounts[`tr_${v}`] = 9000;
  }

  fakeStripe = makeFakeStripe({
    chargeAmount: 11000 * vendors.length,
    transferAmounts,
  });
}

const net = (vendorId, field) =>
  fakeDb.__vendorEntries
    .filter((e) => e.vendorId === vendorId)
    .reduce((sum, e) => sum + Number(e[field] || 0), 0);

const refundRows = (vendorId) =>
  fakeDb.__vendorEntries.filter((e) => e.vendorId === vendorId && e.type === "REFUND");

async function adminRefund() {
  const res = await fetch(`${baseUrl}/api/admin/orders/o1/refund`, { method: "POST" });
  return { status: res.status, body: await res.json() };
}

async function userCancel() {
  const res = await fetch(`${baseUrl}/api/user/orders/o1/cancel`, { method: "POST" });
  return { status: res.status, body: await res.json() };
}

/* =========================================================
   Teste
========================================================= */

test("USER cancel CARD plătit, nelivrat: refund Client + REFUND în ledger -> comision/itemsNet/vendorNet net ZERO", async () => {
  seedPaidCardOrder();

  const { status, body } = await userCancel();

  assert.equal(status, 200);
  assert.equal(body.refund.status, "REFUNDED");
  assert.equal(fakeStripe.__calls.refunds.length, 1);
  assert.equal(fakeStripe.__calls.reversals.length, 1);

  assert.equal(refundRows("vA").length, 1, "trebuie să existe exact o intrare REFUND");
  assert.equal(net("vA", "commissionNet"), 0, "comisionul net trebuie să fie zero");
  assert.equal(net("vA", "itemsNet"), 0);
  assert.equal(net("vA", "vendorNet"), 0);
  assert.equal(refundRows("vA")[0].meta.refShipmentId, "ship-vA");
});

test("ADMIN refund pe comandă CARD plătită, nelivrată (ruta admin): ledger net zero + livrarea trece în REFUSED", async () => {
  seedPaidCardOrder();

  const { status, body } = await adminRefund();

  assert.equal(status, 200);
  assert.equal(body.dbReversalNeedsAttention, false);
  assert.equal(net("vA", "commissionNet"), 0);
  assert.equal(net("vA", "vendorNet"), 0);
  assert.equal(fakeDb.__shipments.get("ship-vA").status, "REFUSED");
});

test("IDEMPOTENȚĂ: al doilea refund (admin, după user) nu dublează Stripe și nici REFUND-ul din ledger", async () => {
  seedPaidCardOrder();

  await userCancel();
  const refundsAfterUser = fakeStripe.__calls.refunds.length;
  const reversalsAfterUser = fakeStripe.__calls.reversals.length;

  const again = await adminRefund();
  assert.equal(again.status, 200);
  assert.equal(again.body.alreadyRefundedByStripe, true);

  assert.equal(fakeStripe.__calls.refunds.length, refundsAfterUser, "niciun refund Stripe în plus");
  assert.equal(fakeStripe.__calls.reversals.length, reversalsAfterUser, "niciun transfer reversal în plus");
  assert.equal(refundRows("vA").length, 1, "un singur REFUND în ledger");
  assert.equal(net("vA", "commissionNet"), 0);

  // A doua anulare de user: refuzată, nimic nou.
  const second = await userCancel();
  assert.equal(second.status, 409);
  assert.equal(fakeStripe.__calls.refunds.length, refundsAfterUser);
});

test("IDEMPOTENȚĂ: admin apelat de 2 ori consecutiv -> un singur refund/reversal, un singur REFUND în ledger", async () => {
  seedPaidCardOrder();

  await adminRefund();
  await adminRefund();

  assert.equal(fakeStripe.__calls.refunds.length, 1);
  assert.equal(fakeStripe.__calls.reversals.length, 1);
  assert.equal(refundRows("vA").length, 1);
  assert.equal(net("vA", "commissionNet"), 0);
});

test("MULTI-VENDOR: fiecare vendor își reversează propria intrare, fără contaminare încrucișată", async () => {
  seedPaidCardOrder({ vendors: ["vA", "vB"] });

  const { status, body } = await userCancel();

  assert.equal(status, 200);
  assert.equal(body.refund.status, "REFUNDED");
  assert.equal(fakeStripe.__calls.reversals.length, 2);

  for (const v of ["vA", "vB"]) {
    assert.equal(refundRows(v).length, 1, `REFUND pentru ${v}`);
    assert.equal(refundRows(v)[0].meta.refShipmentId, `ship-${v}`, `${v} referă propria livrare`);
    assert.equal(net(v, "commissionNet"), 0, `comision net zero pentru ${v}`);
    assert.equal(net(v, "vendorNet"), 0);
  }

  // O singură dată refund total client (2 x 110.00 = 220.00)
  assert.equal(fakeStripe.__calls.refunds.length, 1);
  assert.equal(fakeStripe.__calls.refunds[0].amount, 22000);
});

test("MULTI-VENDOR: un vendor cu intrare deja reversată (retry parțial) nu e reversat a doua oară; celălalt se completează", async () => {
  seedPaidCardOrder({ vendors: ["vA", "vB"] });

  // Simulăm un eșec parțial anterior: vA are deja REFUND în ledger.
  fakeDb.__vendorEntries.push({
    id: "R-vA",
    createdAt: new Date(),
    vendorId: "vA",
    orderId: "o1",
    shipmentId: null,
    type: "REFUND",
    currency: "RON",
    itemsNet: -100,
    commissionNet: -10,
    vendorNet: -90,
    meta: { refShipmentId: "ship-vA" },
  });

  await adminRefund();

  assert.equal(refundRows("vA").length, 1, "vA nu primește al doilea REFUND");
  assert.equal(refundRows("vB").length, 1);
  assert.equal(net("vA", "commissionNet"), 0);
  assert.equal(net("vB", "commissionNet"), 0);
});

test("Formă istorică (SALE legat de shipment + stripeTransferId pe același rând) rămâne corectă", async () => {
  seedPaidCardOrder({ shipmentStatus: "DELIVERED" });

  // Reproducem forma seedată de testele admin existente.
  const t = fakeDb.__vendorEntries.find((e) => e.id === "T-vA");
  t.shipmentId = "ship-vA";

  const { status } = await adminRefund();

  assert.equal(status, 200);
  assert.equal(refundRows("vA").length, 1);
  assert.equal(net("vA", "commissionNet"), 0);
  assert.equal(fakeDb.__shipments.get("ship-vA").status, "RETURNED");
});

test("LIVRAT (SALE legat de shipment + SALE de la plată): se reversează SALE-ul shipment-ului (înainte de fix nu se reversa nimic în DB)", async () => {
  seedPaidCardOrder({ shipmentStatus: "DELIVERED" });

  // La livrare, ensureSaleLedgerEntry adaugă SALE-ul legat de shipment.
  fakeDb.__vendorEntries.push({
    id: "S-vA",
    createdAt: new Date(),
    vendorId: "vA",
    orderId: "o1",
    shipmentId: "ship-vA",
    type: "SALE",
    currency: "RON",
    itemsNet: 100,
    commissionNet: 10,
    vendorNet: 90,
    stripeTransferId: null,
    meta: { source: "shipment_status_fulfilled" },
  });

  await adminRefund();

  const refunds = refundRows("vA");
  assert.equal(refunds.length, 1, "exact un REFUND (pentru SALE-ul shipment-ului)");
  assert.equal(refunds[0].commissionNet, -10);
  assert.equal(refunds[0].meta.source, "shipment_status_returned");
  assert.equal(fakeDb.__shipments.get("ship-vA").status, "RETURNED");
});

test("Asociere ambiguă (vendor cu 2 livrări în comandă): NU se ghicește, se raportează dbReversalNeedsAttention, Stripe rămâne corect", async () => {
  seedPaidCardOrder();

  // Al doilea shipment al aceluiași vendor în aceeași comandă.
  fakeDb.__shipments.set("ship-vA-2", {
    id: "ship-vA-2",
    orderId: "o1",
    vendorId: "vA",
    status: "PENDING",
    depositStatus: "NOT_REQUESTED",
    cancelReason: null,
  });
  fakeDb.__orders.get("o1").shipmentIds.push("ship-vA-2");

  const { status, body } = await adminRefund();

  assert.equal(status, 200);
  assert.equal(body.dbReversalNeedsAttention, true);
  assert.ok(
    body.dbReversals.some((r) => r.error === "ambiguous_shipment_for_transfer_entry")
  );
  assert.equal(refundRows("vA").length, 0, "nu creăm un REFUND pe o livrare ghicită");
  assert.equal(fakeStripe.__calls.refunds.length, 1, "clientul e totuși rambursat");
});
