// src/routes/adminOrdersRoutes.refund.test.js
//
// Teste deterministe pentru POST /api/admin/orders/:id/refund (CARD) -
// FĂRĂ Stripe real, FĂRĂ DB real. Mocăm STRICT "../db.js" (Prisma) și
// "../lib/stripe.js" (Stripe client) cu node:test mock.module, plus
// "../api/auth.js" (doar ca sa treaca middleware-ul ADMIN) - restul
// codului rulat este codul REAL de producție (adminOrdersRoutes.js +
// helper-ele de ledger din vendorOrdersRoutes.js, neatinse).
//
// Rulare: node --experimental-test-module-mocks --test src/routes/adminOrdersRoutes.refund.test.js
//
// De ce mock.module și nu un DB de test real: acest backend nu are
// deocamdată nicio infrastructură de testare (package.json: "test":
// "echo \"No tests\""), nicio bază de date de test provizionată în
// acest mediu. mock.module e nativ Node (fără dependințe noi) și
// permite rularea CODULUI REAL al rutei (nu o reimplementare paralelă
// a logicii, care ar testa altceva decât producția).

process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:5"; // niciodată contactat cu adevărat - vezi mai jos

import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

/* =========================================================
   Fake DB (in-memory) - implementează STRICT formele de query
   folosite de adminOrdersRoutes.js (CAZ CARD) și de
   ensureRefundLedgerEntry / ensureInfluencerRefundLedgerEntry /
   ensureVendorReferralRefundLedgerEntry din vendorOrdersRoutes.js.
========================================================= */

function makeFakeDb() {
  const orders = new Map();
  const shipments = new Map();
  const vendors = new Map();
  const vendorEarningEntries = [];
  const influencerEarningEntries = [];
  const vendorReferralEarningEntries = [];

  let seq = 0;
  const nextId = (prefix) => `${prefix}_${++seq}`;

  function readPath(obj, path) {
    let cur = obj;
    for (const key of path) {
      cur = cur?.[key];
    }
    return cur;
  }

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

  function project(row, select) {
    if (!select) return { ...row };
    const out = {};
    for (const key of Object.keys(select)) {
      if (select[key]) out[key] = row[key];
    }
    return out;
  }

  function makeEarningModel(store) {
    return {
      findMany: async ({ where, select, orderBy, take } = {}) => {
        let rows = store.filter((r) => matchesWhere(r, where));
        if (orderBy?.createdAt === "desc") {
          rows = [...rows].sort((a, b) => b.createdAt - a.createdAt);
        }
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
        const row = { id: nextId("earn"), createdAt: new Date(), ...data };
        store.push(row);
        return { ...row };
      },
      updateMany: async ({ where, data }) => {
        const rows = store.filter((r) => matchesWhere(r, where));
        for (const r of rows) Object.assign(r, data);
        return { count: rows.length };
      },
    };
  }

  const db = {
    __seedOrder(order) {
      orders.set(order.id, order);
    },
    __seedShipment(shipment) {
      shipments.set(shipment.id, shipment);
    },
    __seedVendor(vendor) {
      vendors.set(vendor.id, vendor);
    },
    __seedVendorEarningEntry(entry) {
      vendorEarningEntries.push({ createdAt: new Date(), ...entry });
    },
    __seedInfluencerEarningEntry(entry) {
      influencerEarningEntries.push({ createdAt: new Date(), ...entry });
    },
    __seedVendorReferralEarningEntry(entry) {
      vendorReferralEarningEntries.push({ createdAt: new Date(), ...entry });
    },
    __all: {
      vendorEarningEntries,
      influencerEarningEntries,
      vendorReferralEarningEntries,
      shipments,
      orders,
    },

    order: {
      findUnique: async ({ where: { id } }) => {
        const order = orders.get(id);
        if (!order) return null;
        const shipmentRows = (order.shipmentIds || []).map((sid) => {
          const s = shipments.get(sid);
          return { ...s, vendor: vendors.get(s.vendorId) || null };
        });
        return { ...order, shipments: shipmentRows };
      },
      update: async ({ where: { id }, data }) => {
        const order = orders.get(id);
        Object.assign(order, data);
        return { ...order };
      },
    },

    shipment: {
      findUnique: async ({ where: { id }, select }) => {
        const s = shipments.get(id);
        return s ? project(s, select) : null;
      },
      update: async ({ where: { id }, data }) => {
        const s = shipments.get(id);
        if (!s) throw new Error(`fake shipment ${id} not found`);
        if (db.__failShipmentUpdateFor === id) {
          throw new Error("simulated_db_failure");
        }
        Object.assign(s, data);
        return { ...s };
      },
    },

    vendorEarningEntry: makeEarningModel(vendorEarningEntries),
    influencerEarningEntry: makeEarningModel(influencerEarningEntries),
    vendorReferralEarningEntry: makeEarningModel(vendorReferralEarningEntries),

    $transaction: async (cb) => cb(db),

    __failShipmentUpdateFor: null,
  };

  return db;
}

/* =========================================================
   Fake Stripe - STATEFUL (persistă amount_refunded /
   amount_reversed între apeluri, exact ca API-ul real Stripe),
   ca să putem simula corect un retry după un eșec parțial.
========================================================= */

function makeFakeStripe({ chargeAmount, transferAmounts }) {
  const chargeState = { id: "ch_test", amount: chargeAmount, amount_refunded: 0 };

  const transferState = new Map(
    Object.entries(transferAmounts).map(([id, amount]) => [
      id,
      { id, amount, amount_reversed: 0 },
    ])
  );

  const refundCreateCalls = [];
  const reversalCreateCalls = [];

  const stripe = {
    transfers: {
      retrieve: async (id) => ({ ...transferState.get(id) }),
      createReversal: async (id, opts) => {
        reversalCreateCalls.push({ id, opts });
        const t = transferState.get(id);
        t.amount_reversed += opts.amount;
        return { id: `trr_${reversalCreateCalls.length}`, amount: opts.amount };
      },
    },
    charges: {
      retrieve: async () => ({ ...chargeState }),
    },
    refunds: {
      create: async (opts) => {
        refundCreateCalls.push(opts);
        chargeState.amount_refunded += opts.amount;
        return { id: `re_${refundCreateCalls.length}` };
      },
    },
    __calls: { refundCreateCalls, reversalCreateCalls },
    __state: { chargeState, transferState },
  };

  return stripe;
}

/* =========================================================
   Bootstrap: mock module-urile ÎNAINTE de a importa router-ul
   real, apoi montăm router-ul pe un Express real (http real, pe
   port efemer local - fără nimic extern).
========================================================= */

let fakeDb;
let fakeStripe;
let server;
let baseUrl;

async function freshApp() {
  const moduleMockDb = mock.module("../db.js", {
    namedExports: { prisma: fakeDb },
  });

  const moduleMockStripe = mock.module("../lib/stripe.js", {
    namedExports: { stripe: fakeStripe },
  });

  const moduleMockAuth = mock.module("../api/auth.js", {
    namedExports: {
      authRequired: (req, _res, next) => {
        req.user = { sub: "admin-test", email: "admin@test.local" };
        next();
      },
      requireRole: () => (_req, _res, next) => next(),
    },
  });

  // Import dinamic, DUPĂ înregistrarea mock-urilor, cu query string
  // unic ca să forțăm un modul nou (nu cel cache-uit dintr-un test
  // anterior, care ar păstra vechile mock-uri legate).
  const mod = await import(`./adminOrdersRoutes.js?t=${Date.now()}-${Math.random()}`);

  return { router: mod.default, restore: () => {
    moduleMockDb.restore();
    moduleMockStripe.restore();
    moduleMockAuth.restore();
  } };
}

async function startServer(router) {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", router);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopServer() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
}

function seedBasicCardOrder(db, { shipments }) {
  const orderId = "order-1";

  db.__seedOrder({
    id: orderId,
    paymentMethod: "CARD",
    stripeChargeId: "ch_test",
    currency: "RON",
    orderNumber: "AF-1001",
    adminNotes: "",
    shipmentIds: shipments.map((s) => s.shipmentId),
  });

  for (const s of shipments) {
    db.__seedVendor({ id: s.vendorId, displayName: `Vendor ${s.vendorId}` });

    db.__seedShipment({
      id: s.shipmentId,
      vendorId: s.vendorId,
      status: s.status || "DELIVERED",
      depositStatus: null,
    });

    db.__seedVendorEarningEntry({
      id: `sale-${s.shipmentId}`,
      vendorId: s.vendorId,
      shipmentId: s.shipmentId,
      orderId,
      type: "SALE",
      stripeTransferId: s.transferId,
      currency: "RON",
      itemsNet: s.itemsNet ?? 10000,
      commissionNet: s.commissionNet ?? 1000,
      vendorNet: s.vendorNet ?? 9000,
      meta: { isMixedCommission: false, commissionGroups: null },
    });

    if (s.influencerId) {
      db.__seedInfluencerEarningEntry({
        id: `infl-sale-${s.shipmentId}`,
        influencerId: s.influencerId,
        shipmentId: s.shipmentId,
        orderId,
        type: "SALE",
        commissionBpsSnapshot: 500,
        currency: "RON",
        eligibleItemsNet: s.itemsNet ?? 10000,
        artfestCommissionNet: s.commissionNet ?? 1000,
        earningNet: 50,
        meta: {},
      });
    }

    if (s.referrerVendorId) {
      db.__seedVendorReferralEarningEntry({
        id: `ref-sale-${s.shipmentId}`,
        referrerVendorId: s.referrerVendorId,
        shipmentId: s.shipmentId,
        orderId,
        type: "SALE",
        commissionBpsSnapshot: 500,
        currency: "RON",
        eligibleItemsNet: s.itemsNet ?? 10000,
        artfestCommissionNet: s.commissionNet ?? 1000,
        earningNet: 50,
        meta: {},
      });
    }
  }

  return orderId;
}

before(async () => {});
after(async () => {
  await stopServer();
});

/* =========================================================
   A. Refund CARD normal (1 vendor)
========================================================= */
test("A. refund CARD normal: Stripe reversal + refund + ledger reversat, shipment DELIVERED -> RETURNED", async () => {
  fakeDb = makeFakeDb();
  fakeStripe = makeFakeStripe({
    chargeAmount: 11000,
    transferAmounts: { "tr_1": 9000 },
  });

  const orderId = seedBasicCardOrder(fakeDb, {
    shipments: [
      { shipmentId: "ship-1", vendorId: "vendor-1", transferId: "tr_1", status: "DELIVERED" },
    ],
  });

  const { router, restore } = await freshApp();
  await startServer(router);

  try {
    const res = await fetch(`${baseUrl}/api/admin/orders/${orderId}/refund`, {
      method: "POST",
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.type, "CARD_FULL_REFUND");
    assert.equal(body.dbReversalNeedsAttention, false);
    assert.equal(body.dbReversals[0].ok, true);
    assert.equal(body.dbReversals[0].status, "RETURNED");

    // Stripe a fost apelat corect o singură dată pe fiecare operație
    assert.equal(fakeStripe.__calls.reversalCreateCalls.length, 1);
    assert.equal(fakeStripe.__calls.refundCreateCalls.length, 1);
    assert.equal(fakeStripe.__calls.refundCreateCalls[0].amount, 11000);

    // Shipment DB actualizat corect
    assert.equal(fakeDb.__all.shipments.get("ship-1").status, "RETURNED");

    // Ledger vendor: intrare REFUND creată, negată corect
    const refundEntry = fakeDb.__all.vendorEarningEntries.find(
      (e) => e.type === "REFUND" && e.meta?.refShipmentId === "ship-1"
    );
    assert.ok(refundEntry, "trebuie să existe o intrare REFUND pentru vendor");
    assert.equal(refundEntry.commissionNet, -1000);
    assert.equal(refundEntry.itemsNet, -10000);
    assert.equal(refundEntry.vendorNet, -9000);

    // Billing: suma SALE + REFUND se neutralizează (exact ce citește
    // vendorCommissionInvoiceService.js)
    const vendorEntries = fakeDb.__all.vendorEarningEntries.filter(
      (e) => e.vendorId === "vendor-1"
    );
    const netCommission = vendorEntries.reduce(
      (sum, e) => sum + Number(e.commissionNet || 0),
      0
    );
    assert.equal(netCommission, 0);
  } finally {
    restore();
    await stopServer();
  }
});

/* =========================================================
   B. Refund CARD cu influencer
========================================================= */
test("B. refund CARD cu influencer atașat: InfluencerEarningEntry REFUND neutralizează SALE", async () => {
  fakeDb = makeFakeDb();
  fakeStripe = makeFakeStripe({
    chargeAmount: 11000,
    transferAmounts: { "tr_1": 9000 },
  });

  const orderId = seedBasicCardOrder(fakeDb, {
    shipments: [
      {
        shipmentId: "ship-1",
        vendorId: "vendor-1",
        transferId: "tr_1",
        status: "DELIVERED",
        influencerId: "influencer-1",
      },
    ],
  });

  const { router, restore } = await freshApp();
  await startServer(router);

  try {
    const res = await fetch(`${baseUrl}/api/admin/orders/${orderId}/refund`, {
      method: "POST",
    });
    const body = await res.json();

    assert.equal(body.dbReversalNeedsAttention, false);

    const netEarning = fakeDb.__all.influencerEarningEntries
      .filter((e) => e.influencerId === "influencer-1")
      .reduce((sum, e) => sum + Number(e.earningNet || 0), 0);

    assert.equal(netEarning, 0);
  } finally {
    restore();
    await stopServer();
  }
});

/* =========================================================
   C. Refund CARD cu vendor referral
========================================================= */
test("C. refund CARD cu vendor referral atașat: VendorReferralEarningEntry REFUND neutralizează SALE", async () => {
  fakeDb = makeFakeDb();
  fakeStripe = makeFakeStripe({
    chargeAmount: 11000,
    transferAmounts: { "tr_1": 9000 },
  });

  const orderId = seedBasicCardOrder(fakeDb, {
    shipments: [
      {
        shipmentId: "ship-1",
        vendorId: "vendor-1",
        transferId: "tr_1",
        status: "DELIVERED",
        referrerVendorId: "vendor-referrer-1",
      },
    ],
  });

  const { router, restore } = await freshApp();
  await startServer(router);

  try {
    const res = await fetch(`${baseUrl}/api/admin/orders/${orderId}/refund`, {
      method: "POST",
    });
    const body = await res.json();

    assert.equal(body.dbReversalNeedsAttention, false);

    const netEarning = fakeDb.__all.vendorReferralEarningEntries
      .filter((e) => e.referrerVendorId === "vendor-referrer-1")
      .reduce((sum, e) => sum + Number(e.earningNet || 0), 0);

    assert.equal(netEarning, 0);
  } finally {
    restore();
    await stopServer();
  }
});

/* =========================================================
   D. Refund CARD cu comision MIXT (isMixedCommission) - reversal
   preia agregatul deja calculat, fără să recalculeze grupurile.
========================================================= */
test("D. refund CARD pe shipment cu comision mixt: reversal negativ pe agregat + păstrează defalcarea originală pentru audit", async () => {
  fakeDb = makeFakeDb();
  fakeStripe = makeFakeStripe({
    chargeAmount: 11000,
    transferAmounts: { "tr_1": 9000 },
  });

  const orderId = "order-mixed";
  fakeDb.__seedOrder({
    id: orderId,
    paymentMethod: "CARD",
    stripeChargeId: "ch_test",
    currency: "RON",
    orderNumber: "AF-2001",
    adminNotes: "",
    shipmentIds: ["ship-mixed"],
  });
  fakeDb.__seedVendor({ id: "vendor-1", displayName: "Vendor 1" });
  fakeDb.__seedShipment({
    id: "ship-mixed",
    vendorId: "vendor-1",
    status: "DELIVERED",
    depositStatus: null,
  });

  const commissionGroups = [
    { commissionBps: 1000, itemsNet: 6000, commissionNet: 600 },
    { commissionBps: 500, itemsNet: 4000, commissionNet: 200 },
  ];

  fakeDb.__seedVendorEarningEntry({
    id: "sale-mixed",
    vendorId: "vendor-1",
    shipmentId: "ship-mixed",
    orderId,
    type: "SALE",
    stripeTransferId: "tr_1",
    currency: "RON",
    itemsNet: 10000,
    commissionNet: 800,
    vendorNet: 9200,
    meta: { isMixedCommission: true, commissionGroups },
  });

  const { router, restore } = await freshApp();
  await startServer(router);

  try {
    const res = await fetch(`${baseUrl}/api/admin/orders/${orderId}/refund`, {
      method: "POST",
    });
    const body = await res.json();

    assert.equal(body.dbReversalNeedsAttention, false);

    const refundEntry = fakeDb.__all.vendorEarningEntries.find(
      (e) => e.type === "REFUND" && e.meta?.refShipmentId === "ship-mixed"
    );

    assert.ok(refundEntry);
    // reversal pe AGREGAT (nu recalculează grupurile)
    assert.equal(refundEntry.commissionNet, -800);
    assert.equal(refundEntry.itemsNet, -10000);
    assert.equal(refundEntry.vendorNet, -9200);
    // defalcarea originală păstrată doar pentru audit/traceability
    assert.equal(refundEntry.meta.reversedIsMixedCommission, true);
    assert.deepEqual(refundEntry.meta.reversedCommissionGroups, commissionGroups);

    const netCommission = fakeDb.__all.vendorEarningEntries
      .filter((e) => e.vendorId === "vendor-1")
      .reduce((sum, e) => sum + Number(e.commissionNet || 0), 0);
    assert.equal(netCommission, 0);
  } finally {
    restore();
    await stopServer();
  }
});

/* =========================================================
   E. Multi-vendor CARD refund - fără contaminare între vendori
========================================================= */
test("E. multi-vendor: reversal per shipment, fără contaminare între vendori", async () => {
  fakeDb = makeFakeDb();
  fakeStripe = makeFakeStripe({
    chargeAmount: 22000,
    transferAmounts: { "tr_1": 9000, "tr_2": 8000 },
  });

  const orderId = seedBasicCardOrder(fakeDb, {
    shipments: [
      { shipmentId: "ship-1", vendorId: "vendor-1", transferId: "tr_1", status: "DELIVERED" },
      { shipmentId: "ship-2", vendorId: "vendor-2", transferId: "tr_2", status: "IN_TRANSIT" },
    ],
  });

  const { router, restore } = await freshApp();
  await startServer(router);

  try {
    const res = await fetch(`${baseUrl}/api/admin/orders/${orderId}/refund`, {
      method: "POST",
    });
    const body = await res.json();

    assert.equal(body.dbReversalNeedsAttention, false);
    assert.equal(fakeStripe.__calls.reversalCreateCalls.length, 2);
    assert.equal(fakeStripe.__calls.refundCreateCalls[0].amount, 22000);

    assert.equal(fakeDb.__all.shipments.get("ship-1").status, "RETURNED");
    // IN_TRANSIT (nu DELIVERED) -> REFUSED, conform regulii actuale
    assert.equal(fakeDb.__all.shipments.get("ship-2").status, "REFUSED");

    const v1Refund = fakeDb.__all.vendorEarningEntries.find(
      (e) => e.vendorId === "vendor-1" && e.type === "REFUND"
    );
    const v2Refund = fakeDb.__all.vendorEarningEntries.find(
      (e) => e.vendorId === "vendor-2" && e.type === "REFUND"
    );

    assert.ok(v1Refund);
    assert.ok(v2Refund);
    assert.equal(v1Refund.meta.refShipmentId, "ship-1");
    assert.equal(v2Refund.meta.refShipmentId, "ship-2");
    // fără contaminare - fiecare refund neagă STRICT propria vânzare
    assert.equal(v1Refund.commissionNet, -1000);
    assert.equal(v2Refund.commissionNet, -1000);
  } finally {
    restore();
    await stopServer();
  }
});

/* =========================================================
   F. Endpoint apelat de 2 ori (succes -> succes) - fără duplicate
========================================================= */
test("F. endpoint apelat de 2 ori consecutiv (fără eșec): fără Stripe dublu, fără ledger dublu", async () => {
  fakeDb = makeFakeDb();
  fakeStripe = makeFakeStripe({
    chargeAmount: 11000,
    transferAmounts: { "tr_1": 9000 },
  });

  const orderId = seedBasicCardOrder(fakeDb, {
    shipments: [
      { shipmentId: "ship-1", vendorId: "vendor-1", transferId: "tr_1", status: "DELIVERED" },
    ],
  });

  const { router, restore } = await freshApp();
  await startServer(router);

  try {
    const res1 = await fetch(`${baseUrl}/api/admin/orders/${orderId}/refund`, {
      method: "POST",
    });
    const body1 = await res1.json();
    assert.equal(body1.dbReversalNeedsAttention, false);

    const res2 = await fetch(`${baseUrl}/api/admin/orders/${orderId}/refund`, {
      method: "POST",
    });
    const body2 = await res2.json();

    // al doilea apel: Stripe deja rambursat integral -> alreadyRefundedByStripe,
    // dar ledger-ul e deja OK, deci nu mai are nevoie de atenție
    assert.equal(body2.alreadyRefundedByStripe, true);
    assert.equal(body2.dbReversalNeedsAttention, false);

    // NU s-a mai creat un al doilea refund/reversal Stripe
    assert.equal(fakeStripe.__calls.refundCreateCalls.length, 1);
    assert.equal(fakeStripe.__calls.reversalCreateCalls.length, 1);

    // NU s-a creat o a doua intrare REFUND în ledger
    const refundEntries = fakeDb.__all.vendorEarningEntries.filter(
      (e) => e.type === "REFUND" && e.meta?.refShipmentId === "ship-1"
    );
    assert.equal(refundEntries.length, 1);
  } finally {
    restore();
    await stopServer();
  }
});

/* =========================================================
   G. Stripe SUCCES + DB FAIL (cazul cel mai important)
========================================================= */
test("G. Stripe refund reușește, DB ledger reversal eșuează: răspuns clar, fără al doilea Stripe refund la acest apel", async () => {
  fakeDb = makeFakeDb();
  fakeStripe = makeFakeStripe({
    chargeAmount: 11000,
    transferAmounts: { "tr_1": 9000 },
  });

  const orderId = seedBasicCardOrder(fakeDb, {
    shipments: [
      { shipmentId: "ship-1", vendorId: "vendor-1", transferId: "tr_1", status: "DELIVERED" },
    ],
  });

  // simulăm eșec DB STRICT pe pasul de update al shipment-ului
  // (primul lucru scris în tranzacție) - Stripe a reușit deja
  fakeDb.__failShipmentUpdateFor = "ship-1";

  const { router, restore } = await freshApp();
  await startServer(router);

  try {
    const res = await fetch(`${baseUrl}/api/admin/orders/${orderId}/refund`, {
      method: "POST",
    });
    const body = await res.json();

    // Stripe a reușit garantat (200, refundId prezent)
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(typeof body.refundId, "string");
    assert.equal(fakeStripe.__calls.refundCreateCalls.length, 1);
    assert.equal(fakeStripe.__calls.reversalCreateCalls.length, 1);

    // dar reversal-ul DB a eșuat - semnalat CLAR în răspuns
    assert.equal(body.dbReversalNeedsAttention, true);
    assert.equal(body.dbReversals[0].ok, false);
    assert.match(body.dbReversals[0].error, /simulated_db_failure/);

    // shipment-ul NU a fost actualizat (update-ul a eșuat înaintea commit-ului)
    assert.equal(fakeDb.__all.shipments.get("ship-1").status, "DELIVERED");

    // NU s-a creat nicio intrare REFUND în ledger (tranzacția a eșuat integral)
    const refundEntries = fakeDb.__all.vendorEarningEntries.filter(
      (e) => e.type === "REFUND"
    );
    assert.equal(refundEntries.length, 0);
  } finally {
    restore();
    await stopServer();
  }
});

/* =========================================================
   H. Retry DUPĂ G - proba determinsită că recovery-ul chiar
   completează reversal-ul DB rămas, fără al doilea refund Stripe.
========================================================= */
test("H. retry după G (DB acum funcțională): retry-ul completează reversal-ul ledger rămas, fără al doilea Stripe refund", async () => {
  fakeDb = makeFakeDb();
  fakeStripe = makeFakeStripe({
    chargeAmount: 11000,
    transferAmounts: { "tr_1": 9000 },
  });

  const orderId = seedBasicCardOrder(fakeDb, {
    shipments: [
      { shipmentId: "ship-1", vendorId: "vendor-1", transferId: "tr_1", status: "DELIVERED" },
    ],
  });

  fakeDb.__failShipmentUpdateFor = "ship-1"; // eșec DB doar la 1° apel

  const { router, restore } = await freshApp();
  await startServer(router);

  try {
    const res1 = await fetch(`${baseUrl}/api/admin/orders/${orderId}/refund`, {
      method: "POST",
    });
    const body1 = await res1.json();
    assert.equal(body1.dbReversalNeedsAttention, true, "precondiție: G a eșuat pe DB");
    assert.equal(fakeDb.__all.shipments.get("ship-1").status, "DELIVERED");

    // "reparăm" DB-ul (situația reală: eroarea tranzitorie a trecut)
    fakeDb.__failShipmentUpdateFor = null;

    // RETRY - același endpoint, aceeași comandă
    const res2 = await fetch(`${baseUrl}/api/admin/orders/${orderId}/refund`, {
      method: "POST",
    });
    const body2 = await res2.json();

    // retry-ul NU mai face un al doilea refund Stripe (alreadyRefundedByStripe),
    // dar CONTINUĂ spre bucla de reversal DB, în loc să se oprească acolo.
    assert.equal(body2.alreadyRefundedByStripe, true);
    assert.equal(body2.dbReversalNeedsAttention, false);
    assert.equal(body2.dbReversals[0].ok, true);
    assert.equal(body2.dbReversals[0].status, "RETURNED");

    const refundEntriesAfterRetry = fakeDb.__all.vendorEarningEntries.filter(
      (e) => e.type === "REFUND" && e.meta?.refShipmentId === "ship-1"
    );
    assert.equal(refundEntriesAfterRetry.length, 1);

    assert.equal(fakeDb.__all.shipments.get("ship-1").status, "RETURNED");

    // fără al doilea refund Stripe la retry
    assert.equal(fakeStripe.__calls.refundCreateCalls.length, 1);
  } finally {
    restore();
    await stopServer();
  }
});

/* =========================================================
   I. Reversal DUBLU pe shipment DEJA RETURNED/REFUSED: nu
   "răstoarnă" statusul și nu re-scrie timestamp-urile.
========================================================= */
test("I. dublu reversal pe același shipment: statusul final (RETURNED) nu e răsturnat în REFUSED", async () => {
  fakeDb = makeFakeDb();
  fakeStripe = makeFakeStripe({
    chargeAmount: 11000,
    transferAmounts: { "tr_1": 9000 },
  });

  const orderId = seedBasicCardOrder(fakeDb, {
    shipments: [
      { shipmentId: "ship-1", vendorId: "vendor-1", transferId: "tr_1", status: "DELIVERED" },
    ],
  });

  const { router, restore } = await freshApp();
  await startServer(router);

  try {
    await fetch(`${baseUrl}/api/admin/orders/${orderId}/refund`, { method: "POST" });
    assert.equal(fakeDb.__all.shipments.get("ship-1").status, "RETURNED");

    const res2 = await fetch(`${baseUrl}/api/admin/orders/${orderId}/refund`, {
      method: "POST",
    });
    const body2 = await res2.json();

    // statusul rămâne RETURNED - NU e re-derivat din starea curentă
    // (care nu mai e DELIVERED) spre REFUSED.
    assert.equal(fakeDb.__all.shipments.get("ship-1").status, "RETURNED");
    assert.equal(body2.dbReversals[0].status, "RETURNED");
  } finally {
    restore();
    await stopServer();
  }
});
