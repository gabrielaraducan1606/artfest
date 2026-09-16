// src/routes/adminOrdersRoutes.depositRefund.test.js
//
// Teste deterministe pentru:
//  - POST /api/admin/orders/:id/refund (CAZ 2 - COD + AVANS STRIPE)
//  - POST /api/admin/orders/:id/cancel (garda noua: avans platit blocheaza anularea)
//
// Aceeasi strategie ca adminOrdersRoutes.refund.test.js: mock.module
// STRICT pe "../db.js" si "../lib/stripe.js" (+ auth), codul rutei
// rulat este codul REAL de productie, neatins de mock.

process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:5";

import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

function round2(v) {
  return Number.parseFloat(Number(v || 0).toFixed(2));
}

function makeFakeDb() {
  const orders = new Map();
  const shipments = new Map();
  const vendors = new Map();
  const products = new Map();

  function readPath(obj, path) {
    let cur = obj;
    for (const key of path) cur = cur?.[key];
    return cur;
  }

  function matchesWhere(row, where = {}) {
    for (const [key, cond] of Object.entries(where)) {
      if (cond && typeof cond === "object" && "path" in cond && "equals" in cond) {
        if (readPath(row[key], cond.path) !== cond.equals) return false;
        continue;
      }
      if (cond && typeof cond === "object" && "in" in cond) {
        if (!cond.in.includes(row[key])) return false;
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
    __seedProduct(product) {
      products.set(product.id, product);
    },
    __all: { orders, shipments, vendors, products },

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
      findFirst: async ({ where: { id } }) => {
        const order = orders.get(id);
        if (!order) return null;
        const shipmentRows = (order.shipmentIds || []).map((sid) => {
          const s = shipments.get(sid);
          return { ...s, items: s.items || [] };
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
        if (!s) return null;
        if (!select) return { ...s };
        const out = {};
        for (const k of Object.keys(select)) out[k] = s[k];
        return out;
      },
      update: async ({ where: { id }, data }) => {
        const s = shipments.get(id);
        if (!s) throw new Error(`fake shipment ${id} not found`);
        Object.assign(s, data);
        return { ...s };
      },
      updateMany: async ({ where, data }) => {
        const rows = [...shipments.values()].filter((r) => matchesWhere(r, where));
        for (const r of rows) Object.assign(r, data);
        return { count: rows.length };
      },
    },

    product: {
      updateMany: async ({ where, data }) => {
        const rows = [...products.values()].filter((r) => matchesWhere(r, where));
        for (const r of rows) {
          if (data.readyQty?.increment != null) {
            r.readyQty = (r.readyQty || 0) + data.readyQty.increment;
          }
          if (data.availability) r.availability = data.availability;
        }
        return { count: rows.length };
      },
    },

    $transaction: async (cb) => cb(db),
  };

  return db;
}

/* =========================================================
   Fake Stripe - avans: transfer + charge separate de CARD-ul
   principal, cu acelasi comportament stateful ca in celalalt
   fisier de test (persista amount_refunded/amount_reversed).
========================================================= */
function makeFakeStripe({ transferAmounts = {}, chargeAmounts = {} }) {
  const transferState = new Map(
    Object.entries(transferAmounts).map(([id, amount]) => [id, { id, amount, amount_reversed: 0 }])
  );
  const chargeState = new Map(
    Object.entries(chargeAmounts).map(([id, amount]) => [id, { id, amount, amount_refunded: 0 }])
  );

  const refundCreateCalls = [];
  const reversalCreateCalls = [];

  return {
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
      retrieve: async (id) => ({ ...chargeState.get(id) }),
    },
    refunds: {
      create: async (opts) => {
        refundCreateCalls.push(opts);
        const c = chargeState.get(opts.charge);
        c.amount_refunded += opts.amount;
        return { id: `re_${refundCreateCalls.length}` };
      },
    },
    __calls: { refundCreateCalls, reversalCreateCalls },
  };
}

let fakeDb;
let fakeStripe;
let server;
let baseUrl;

async function freshApp() {
  const moduleMockDb = mock.module("../db.js", { namedExports: { prisma: fakeDb } });
  const moduleMockStripe = mock.module("../lib/stripe.js", { namedExports: { stripe: fakeStripe } });
  const moduleMockAuth = mock.module("../api/auth.js", {
    namedExports: {
      authRequired: (req, _res, next) => {
        req.user = { sub: "admin-test", email: "admin@test.local" };
        next();
      },
      requireRole: () => (_req, _res, next) => next(),
    },
  });

  const mod = await import(`./adminOrdersRoutes.js?t=${Date.now()}-${Math.random()}`);

  return {
    router: mod.default,
    restore: () => {
      moduleMockDb.restore();
      moduleMockStripe.restore();
      moduleMockAuth.restore();
    },
  };
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

/*
 * Seed: comanda COD, 100 lei total (85 produse + 15 shipping ca sa
 * simplificam), avans 15% din produse = round2(85*0.15) = 12.75...
 * Ca sa obtinem exact testul cerut de audit (order 100, avans 15,
 * remaining 85), folosim direct valorile stocate pe shipment (asa
 * cum le-ar fi scris ruta reala de request-deposit), fara sa
 * recalculam formula aici - testam DOAR reversul ei la refund.
 */
function seedCodDepositShipment(db, { shipmentId, vendorId, orderId, requestedAmount, remainingCodAmount, transferId, chargeId, extra = {} }) {
  db.__seedVendor({ id: vendorId, displayName: `Vendor ${vendorId}` });
  db.__seedShipment({
    id: shipmentId,
    orderId,
    vendorId,
    status: "PENDING",
    depositStatus: "PAID",
    depositPercent: 15,
    depositRequestedAmount: requestedAmount,
    depositPaidAmount: requestedAmount,
    remainingCodAmount,
    stripeDepositChargeId: chargeId,
    depositMeta: { stripeTransferId: transferId, commissionCollected: 0 },
    items: [],
    ...extra,
  });
}

before(async () => {});
after(async () => {
  await stopServer();
});

/* =========================================================
   A/B/C precondition + D. Refund avans: 100 -> avans 15 -> remaining 85
   -> refund -> remaining 100, depositStatus REFUNDED, depositPaidAmount null
========================================================= */
test("D. refund avans COD: remainingCodAmount revine la valoarea fara avans, depositStatus REFUNDED", async () => {
  fakeDb = makeFakeDb();
  fakeStripe = makeFakeStripe({
    transferAmounts: { tr_dep_1: 1200 },
    chargeAmounts: { ch_dep_1: 1500 },
  });

  const orderId = "order-dep-1";
  fakeDb.__seedOrder({
    id: orderId,
    paymentMethod: "COD",
    currency: "RON",
    orderNumber: "AF-DEP-1",
    shipmentIds: ["ship-dep-1"],
  });

  seedCodDepositShipment(fakeDb, {
    shipmentId: "ship-dep-1",
    vendorId: "vendor-1",
    orderId,
    requestedAmount: 15,
    remainingCodAmount: 85,
    transferId: "tr_dep_1",
    chargeId: "ch_dep_1",
  });

  const { router, restore } = await freshApp();
  await startServer(router);

  try {
    const res = await fetch(`${baseUrl}/api/admin/orders/${orderId}/refund`, { method: "POST" });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.type, "COD_DEPOSIT_REFUND");
    assert.equal(body.refunds[0].depositStatus, "REFUNDED");
    assert.equal(body.refunds[0].remainingCodAmount, 100);

    const shipment = fakeDb.__all.shipments.get("ship-dep-1");
    assert.equal(shipment.depositStatus, "REFUNDED");
    assert.equal(shipment.depositPaidAmount, null);
    assert.equal(shipment.remainingCodAmount, 100);

    assert.equal(fakeStripe.__calls.refundCreateCalls.length, 1);
    assert.equal(fakeStripe.__calls.reversalCreateCalls.length, 1);
  } finally {
    restore();
    await stopServer();
  }
});

/* =========================================================
   E. Admin cancel cu avans platit -> blocat, fara reversal DB
========================================================= */
test("E. admin cancel pe comanda COD cu avans PLATIT: blocat 409, fara restore stoc, fara schimbare status shipment", async () => {
  fakeDb = makeFakeDb();
  fakeStripe = makeFakeStripe({});

  const orderId = "order-dep-2";
  fakeDb.__seedOrder({
    id: orderId,
    paymentMethod: "COD",
    currency: "RON",
    orderNumber: "AF-DEP-2",
    shipmentIds: ["ship-dep-2"],
  });

  fakeDb.__seedVendor({ id: "vendor-1", displayName: "Vendor 1" });
  fakeDb.__seedShipment({
    id: "ship-dep-2",
    orderId,
    vendorId: "vendor-1",
    status: "PENDING",
    depositStatus: "PAID",
    depositRequestedAmount: 15,
    remainingCodAmount: 85,
    items: [{ productId: "prod-1", qty: 1 }],
  });

  fakeDb.__seedProduct({ id: "prod-1", availability: "READY", readyQty: 5 });

  const { router, restore } = await freshApp();
  await startServer(router);

  try {
    const res = await fetch(`${baseUrl}/api/admin/orders/${orderId}/cancel`, { method: "POST" });
    const body = await res.json();

    assert.equal(res.status, 409);
    assert.equal(body.error, "deposit_refund_required_before_cancel");
    assert.deepEqual(body.shipmentIds, ["ship-dep-2"]);

    // fara efect secundar: shipment neschimbat, stoc neatins
    const shipment = fakeDb.__all.shipments.get("ship-dep-2");
    assert.equal(shipment.status, "PENDING");
    assert.equal(shipment.depositStatus, "PAID");

    const product = fakeDb.__all.products.get("prod-1");
    assert.equal(product.readyQty, 5);
  } finally {
    restore();
    await stopServer();
  }
});

/* =========================================================
   F. Retry refund avans (dupa D): idempotent, fara al doilea
   Stripe refund/reversal, raspuns de succes (nu eroare ambigua)
========================================================= */
test("F. retry refund avans dupa refund reusit: idempotent, fara Stripe dublu", async () => {
  fakeDb = makeFakeDb();
  fakeStripe = makeFakeStripe({
    transferAmounts: { tr_dep_3: 1200 },
    chargeAmounts: { ch_dep_3: 1500 },
  });

  const orderId = "order-dep-3";
  fakeDb.__seedOrder({
    id: orderId,
    paymentMethod: "COD",
    currency: "RON",
    orderNumber: "AF-DEP-3",
    shipmentIds: ["ship-dep-3"],
  });

  seedCodDepositShipment(fakeDb, {
    shipmentId: "ship-dep-3",
    vendorId: "vendor-1",
    orderId,
    requestedAmount: 15,
    remainingCodAmount: 85,
    transferId: "tr_dep_3",
    chargeId: "ch_dep_3",
  });

  const { router, restore } = await freshApp();
  await startServer(router);

  try {
    const res1 = await fetch(`${baseUrl}/api/admin/orders/${orderId}/refund`, { method: "POST" });
    const body1 = await res1.json();
    assert.equal(body1.refunds[0].depositStatus, "REFUNDED");

    const res2 = await fetch(`${baseUrl}/api/admin/orders/${orderId}/refund`, { method: "POST" });
    const body2 = await res2.json();

    assert.equal(res2.status, 200);
    assert.equal(body2.ok, true);
    assert.equal(body2.refunds[0].alreadyRefunded, true);

    // NU s-a mai apelat Stripe a doua oara
    assert.equal(fakeStripe.__calls.refundCreateCalls.length, 1);
    assert.equal(fakeStripe.__calls.reversalCreateCalls.length, 1);

    // starea DB ramane consistenta (remaining tot 100, nu 115)
    const shipment = fakeDb.__all.shipments.get("ship-dep-3");
    assert.equal(shipment.remainingCodAmount, 100);
  } finally {
    restore();
    await stopServer();
  }
});

/* =========================================================
   G. Multi-vendor: refund avans doar pe shipment-ul cu avans platit,
   celalalt vendor (fara avans) neatins
========================================================= */
test("G. multi-vendor: refund avans afecteaza doar shipment-ul cu depositStatus PAID", async () => {
  fakeDb = makeFakeDb();
  fakeStripe = makeFakeStripe({
    transferAmounts: { tr_dep_4: 1200 },
    chargeAmounts: { ch_dep_4: 1500 },
  });

  const orderId = "order-dep-4";
  fakeDb.__seedOrder({
    id: orderId,
    paymentMethod: "COD",
    currency: "RON",
    orderNumber: "AF-DEP-4",
    shipmentIds: ["ship-dep-4a", "ship-dep-4b"],
  });

  seedCodDepositShipment(fakeDb, {
    shipmentId: "ship-dep-4a",
    vendorId: "vendor-1",
    orderId,
    requestedAmount: 15,
    remainingCodAmount: 85,
    transferId: "tr_dep_4",
    chargeId: "ch_dep_4",
  });

  // al doilea vendor: NU a solicitat avans deloc
  fakeDb.__seedVendor({ id: "vendor-2", displayName: "Vendor 2" });
  fakeDb.__seedShipment({
    id: "ship-dep-4b",
    orderId,
    vendorId: "vendor-2",
    status: "PENDING",
    depositStatus: "NOT_REQUESTED",
    depositRequestedAmount: null,
    remainingCodAmount: null,
    stripeDepositChargeId: null,
    items: [],
  });

  const { router, restore } = await freshApp();
  await startServer(router);

  try {
    const res = await fetch(`${baseUrl}/api/admin/orders/${orderId}/refund`, { method: "POST" });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.refunds.length, 1);
    assert.equal(body.refunds[0].shipmentId, "ship-dep-4a");

    const shipmentB = fakeDb.__all.shipments.get("ship-dep-4b");
    assert.equal(shipmentB.depositStatus, "NOT_REQUESTED");
    assert.equal(shipmentB.remainingCodAmount, null);
  } finally {
    restore();
    await stopServer();
  }
});

/* =========================================================
   H. Secventa completa: refund avans -> apoi cancel reuseste
   normal (orchestrarea "refund intai, apoi cancel" ceruta explicit)
========================================================= */
test("H. dupa refund avans reusit, admin cancel pe aceeasi comanda NU mai e blocat", async () => {
  fakeDb = makeFakeDb();
  fakeStripe = makeFakeStripe({
    transferAmounts: { tr_dep_5: 1200 },
    chargeAmounts: { ch_dep_5: 1500 },
  });

  const orderId = "order-dep-5";
  fakeDb.__seedOrder({
    id: orderId,
    paymentMethod: "COD",
    currency: "RON",
    orderNumber: "AF-DEP-5",
    shipmentIds: ["ship-dep-5"],
  });

  seedCodDepositShipment(fakeDb, {
    shipmentId: "ship-dep-5",
    vendorId: "vendor-1",
    orderId,
    requestedAmount: 15,
    remainingCodAmount: 85,
    transferId: "tr_dep_5",
    chargeId: "ch_dep_5",
    extra: { items: [{ productId: "prod-5", qty: 1 }] },
  });

  fakeDb.__seedProduct({ id: "prod-5", availability: "READY", readyQty: 5 });

  const { router, restore } = await freshApp();
  await startServer(router);

  try {
    // pas 1: cancel blocat cat timp avansul e PAID
    const blocked = await fetch(`${baseUrl}/api/admin/orders/${orderId}/cancel`, { method: "POST" });
    assert.equal(blocked.status, 409);

    // pas 2: refund avans
    const refundRes = await fetch(`${baseUrl}/api/admin/orders/${orderId}/refund`, { method: "POST" });
    const refundBody = await refundRes.json();
    assert.equal(refundBody.refunds[0].depositStatus, "REFUNDED");

    // pas 3: cancel-ul acum trece normal
    const cancelRes = await fetch(`${baseUrl}/api/admin/orders/${orderId}/cancel`, { method: "POST" });
    const cancelBody = await cancelRes.json();

    assert.equal(cancelRes.status, 200);
    assert.equal(cancelBody.ok, true);

    const shipment = fakeDb.__all.shipments.get("ship-dep-5");
    assert.equal(shipment.status, "REFUSED");

    const product = fakeDb.__all.products.get("prod-5");
    assert.equal(product.readyQty, 6);
  } finally {
    restore();
    await stopServer();
  }
});
