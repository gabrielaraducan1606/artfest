// src/routes/userOrdersRoutes.cancelRefund.test.js
//
// Teste deterministe pentru POST /api/user/orders/:id/cancel - refund
// automat când Clientul anulează o comandă CARD deja plătită (audit
// legal: banii rămâneau încasați). FĂRĂ Stripe real, FĂRĂ DB real.
//
// Mocăm STRICT: "../db.js", "../api/auth.js", "../payments/orchestrator.js",
// notificările/emailul de anulare, restaurarea de stoc și serviciul de
// refund (logica lui financiară e acoperită separat de
// adminOrdersRoutes.refund.test.js - aceeași implementare). Restul e
// codul REAL al rutei userOrdersRoutes.js (cancelOwnOrder).
//
// Rulare: node --experimental-test-module-mocks --test src/routes/userOrdersRoutes.cancelRefund.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";

import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

let server;
let baseUrl;
let orders;
let refundCalls;
let refundBehavior;
let transactionRan;

function makeFakeDb() {
  const clone = (o) => JSON.parse(JSON.stringify(o));

  return {
    order: {
      findFirst: async ({ where }) => {
        const o = orders.get(where.id);
        return o && o.userId === where.userId ? clone(o) : null;
      },
      findUnique: async ({ where }) => {
        const o = orders.get(where.id);
        return o ? clone(o) : null;
      },
      update: async ({ where, data }) => {
        const o = orders.get(where.id);
        Object.assign(o, data);
        return clone(o);
      },
    },
    // anularea expiră avansurile COD PENDING (depositInvalidation): aici nu există
    shipment: { findMany: async () => [] },

    $transaction: async (fn) => {
      transactionRan = true;

      const tx = {
        shipment: {
          updateMany: async ({ where }) => {
            const o = orders.get(where.orderId);
            let count = 0;
            for (const s of o.shipments) {
              if (s.status === where.status) {
                s.status = "REFUSED";
                count += 1;
              }
            }
            return { count };
          },
        },
        order: {
          update: async ({ where, data }) => {
            Object.assign(orders.get(where.id), data);
          },
        },
      };

      return fn(tx);
    },
  };
}

let restoreAll = null;

before(async () => {
  orders = new Map();

  const mocks = [
    mock.module("../db.js", { namedExports: { prisma: makeFakeDb() } }),
    mock.module("../api/auth.js", {
      namedExports: {
        authRequired: (req, _res, next) => {
          req.user = { sub: "user-1" };
          next();
        },
      },
    }),
    mock.module("../payments/orchestrator.js", {
      namedExports: {
        createPaymentForOrder: async () => ({}),
        createDepositPaymentForShipment: async () => ({}),
      },
    }),
    mock.module("../services/orderMessaging.js", {
      namedExports: {
        sendOrderCancelledByUserNotifications: async () => {},
      },
    }),
    mock.module("../lib/mailer.js", {
      namedExports: {
        sendOrderCancelledByUserEmail: async () => {},
      },
    }),
    mock.module("../services/stockRestore.js", {
      namedExports: {
        restoreStockFromItems: async () => {},
      },
    }),
    mock.module("../lib/stripe.js", {
      namedExports: {
        stripe: { checkout: { sessions: { expire: async () => ({}) } } },
      },
    }),
    mock.module("../services/orderRefundService.js", {
      namedExports: {
        refundCardOrderFully: async (args) => {
          refundCalls.push(args);
          if (refundBehavior.mode === "throw") {
            throw new Error("stripe_down");
          }
          return refundBehavior.result;
        },
      },
    }),
  ];

  restoreAll = () => mocks.forEach((m) => m.restore());

  const mod = await import(
    `./userOrdersRoutes.js?t=${Date.now()}-${Math.random()}`
  );

  const app = express();
  app.use(express.json());
  app.use("/api/user/orders", mod.default);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (restoreAll) restoreAll();
});

beforeEach(() => {
  orders.clear();
  refundCalls = [];
  transactionRan = false;
  refundBehavior = {
    mode: "ok",
    result: { status: 200, body: { ok: true } },
  };
});

function seedOrder(overrides = {}, shipmentOverrides = {}) {
  orders.set("order-1", {
    id: "order-1",
    orderNumber: "AF-1001",
    userId: "user-1",
    paymentMethod: "CARD",
    status: "PAID",
    paidAt: "2026-09-01T10:00:00.000Z",
    stripeChargeId: "ch_1",
    adminNotes: "",
    user: { email: "client@example.com" },
    shipments: [
      {
        id: "ship-1",
        vendorId: "vendor-1",
        status: "PENDING",
        depositStatus: "NOT_REQUESTED",
        items: [],
        ...shipmentOverrides,
      },
    ],
    ...overrides,
  });
}

async function cancel() {
  const res = await fetch(`${baseUrl}/api/user/orders/order-1/cancel`, {
    method: "POST",
  });
  return { status: res.status, body: await res.json() };
}

test("CARD plătit: anulare -> refund automat (chei dedicate) + comandă CANCELLED", async () => {
  seedOrder();

  const { status, body } = await cancel();

  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.refund.status, "REFUNDED");
  assert.match(body.message, /rambursată/);

  assert.equal(refundCalls.length, 1);
  assert.equal(refundCalls[0].metaKind, "user_cancel_refund");
  assert.equal(refundCalls[0].keyPrefix, "user-cancel-refund");
  assert.equal(refundCalls[0].actor, "client:user-1");

  assert.equal(orders.get("order-1").status, "CANCELLED");
});

test("CARD plătit: refund oprit (409) -> comanda rămâne anulată, refund PENDING + urmă în adminNotes", async () => {
  seedOrder();
  refundBehavior.result = {
    status: 409,
    body: { error: "vendor_transfers_missing" },
  };

  const { status, body } = await cancel();

  assert.equal(status, 200);
  assert.equal(body.refund.status, "PENDING");
  assert.match(body.message, /manual/);
  assert.equal(orders.get("order-1").status, "CANCELLED");
  assert.match(
    orders.get("order-1").adminNotes,
    /refund automat OPRIT \(vendor_transfers_missing\)/
  );
});

test("CARD plătit: eroare Stripe -> comanda rămâne anulată, refund PENDING + urmă în adminNotes", async () => {
  seedOrder();
  refundBehavior.mode = "throw";

  const { status, body } = await cancel();

  assert.equal(status, 200);
  assert.equal(body.refund.status, "PENDING");
  assert.equal(orders.get("order-1").status, "CANCELLED");
  assert.match(orders.get("order-1").adminNotes, /refund automat EȘUAT/);
});

test("CARD neplătit: anulare fără refund", async () => {
  seedOrder({
    status: "PENDING",
    paidAt: null,
    stripeChargeId: null,
  });

  const { status, body } = await cancel();

  assert.equal(status, 200);
  assert.equal(body.refund.status, "NOT_REQUIRED");
  assert.equal(refundCalls.length, 0);
});

test("COD fără avans: anulare fără refund", async () => {
  seedOrder({
    paymentMethod: "COD",
    status: "PENDING",
    paidAt: null,
    stripeChargeId: null,
  });

  const { status, body } = await cancel();

  assert.equal(status, 200);
  assert.equal(body.refund.status, "NOT_REQUIRED");
  assert.equal(refundCalls.length, 0);
});

test("COD cu avans plătit: anularea e blocată (avansul nu rămâne încasat fără refund)", async () => {
  seedOrder(
    {
      paymentMethod: "COD",
      status: "PENDING",
      paidAt: null,
      stripeChargeId: null,
    },
    { depositStatus: "PAID" }
  );

  const { status, body } = await cancel();

  assert.equal(status, 409);
  assert.equal(body.error, "deposit_refund_required_before_cancel");
  assert.equal(transactionRan, false);
  assert.equal(orders.get("order-1").status, "PENDING");
  assert.equal(refundCalls.length, 0);
});
