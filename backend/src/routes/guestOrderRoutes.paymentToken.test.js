// src/routes/guestOrderRoutes.paymentToken.test.js
//
// Teste deterministe pentru accesul prin `paymentToken` (JWT
// guest_payment_access, src/lib/guestPaymentAccessToken.js) pe
// GET /api/guest/orders/:id și POST /api/guest/orders/:id/payment -
// reminder-ul de plată CARD neterminată (guestPaymentReminderJob.js).
//
// FĂRĂ Stripe real, FĂRĂ DB real - mocăm STRICT "../db.js" și
// "../payments/orchestrator.js", la fel ca guestOrderRoutes.payment.test.js.
// Restul e codul REAL al rutei (guestOrderRoutes.js, neatins) +
// verificarea REALĂ a tokenului (guestPaymentAccessToken.js, neatins).
//
// Rulare: node --experimental-test-module-mocks --test src/routes/guestOrderRoutes.paymentToken.test.js

process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:5";
process.env.JWT_SECRET = "test-secret";

import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

/*
 * Import DINAMIC, nu static: un import static se evaluează la
 * hoisting, ÎNAINTE ca instrucțiunile de mai sus (setarea
 * process.env.JWT_SECRET) să ruleze - guestPaymentAccessToken.js
 * citește JWT_SECRET o singură dată, la încărcarea modulului, deci
 * ar rămâne cu `undefined`. Același motiv pentru care
 * guestOrderRoutes.js e importat dinamic, mai jos, în freshApp().
 */
const { createGuestPaymentAccessToken } = await import(
  "../lib/guestPaymentAccessToken.js"
);

let orders;
let server;
let baseUrl;
let orchestratorBehavior;
let lastCreatePaymentForOrderArg;

function makeFakeDb() {
  return {
    order: {
      findFirst: async ({ where }) => {
        /*
         * Lookup prin guestAccessTokenHash (findGuestOrder, token
         * normal) - shape existent, neschimbat.
         */
        if (where.guestAccessTokenHash !== undefined) {
          const orderRefCond = (where.AND || [])[0]?.OR || [];
          return (
            [...orders.values()].find(
              (o) =>
                o.isGuestOrder === true &&
                o.userId === null &&
                o.guestAccessTokenHash === where.guestAccessTokenHash &&
                orderRefCond.some(
                  (cond) =>
                    (cond.id && cond.id === o.id) ||
                    (cond.orderNumber && cond.orderNumber === o.orderNumber)
                )
            ) || null
          );
        }

        /*
         * Lookup prin id (findGuestOrderByPaymentToken) - shape nou.
         */
        return (
          [...orders.values()].find(
            (o) =>
              o.id === where.id &&
              o.isGuestOrder === true &&
              o.userId === null
          ) || null
        );
      },
    },
  };
}

async function freshApp() {
  orders = new Map();
  orchestratorBehavior = { mode: "success" };
  lastCreatePaymentForOrderArg = null;

  const moduleMockDb = mock.module("../db.js", {
    namedExports: { prisma: makeFakeDb() },
  });

  const moduleMockOrchestrator = mock.module("../payments/orchestrator.js", {
    namedExports: {
      createPaymentForOrder: async (order) => {
        lastCreatePaymentForOrderArg = order;

        if (orchestratorBehavior.mode === "blocked") {
          throw new Error("blocked");
        }

        return {
          provider: "stripe",
          redirectUrl: "https://checkout.stripe.test/cs_reminder_1",
        };
      },
      createDepositPaymentForShipment: async () => ({}),
    },
  });

  const mod = await import(
    `./guestOrderRoutes.js?t=${Date.now()}-${Math.random()}`
  );

  return {
    router: mod.default,
    restore: () => {
      moduleMockDb.restore();
      moduleMockOrchestrator.restore();
    },
  };
}

let restoreCurrent = null;

before(async () => {
  const { router, restore } = await freshApp();
  restoreCurrent = restore;

  const app = express();
  app.use(express.json());
  app.use("/api/guest/orders", router);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (restoreCurrent) restoreCurrent();
});

function seedCardPendingGuestOrder(id = "order-1") {
  orders.set(id, {
    id,
    orderNumber: "AF-2001",
    userId: null,
    isGuestOrder: true,
    guestAccessTokenHash: "unused-in-these-tests",
    guestAccessExpiresAt: null,
    paymentMethod: "CARD",
    status: "PENDING",
    paidAt: null,
    total: 199.5,
    currency: "RON",
    subtotal: 199.5,
    shippingTotal: 0,
    shipments: [],
  });
}

function seedCodGuestOrder(id = "order-cod") {
  orders.set(id, {
    id,
    orderNumber: "AF-2002",
    userId: null,
    isGuestOrder: true,
    guestAccessTokenHash: "unused",
    guestAccessExpiresAt: null,
    paymentMethod: "COD",
    status: "PENDING",
    paidAt: null,
    total: 50,
    currency: "RON",
    subtotal: 50,
    shippingTotal: 0,
    shipments: [],
  });
}

function seedPaidCardGuestOrder(id = "order-paid") {
  orders.set(id, {
    id,
    orderNumber: "AF-2003",
    userId: null,
    isGuestOrder: true,
    guestAccessTokenHash: "unused",
    guestAccessExpiresAt: null,
    paymentMethod: "CARD",
    status: "PAID",
    paidAt: new Date(),
    total: 75,
    currency: "RON",
    subtotal: 75,
    shippingTotal: 0,
    shipments: [],
  });
}

/* =========================================================
   GET /:id?paymentToken=...
========================================================= */

test("GET: paymentToken valid pentru comanda corectă -> 200, access.type = payment_token", async () => {
  seedCardPendingGuestOrder("order-1");
  const paymentToken = createGuestPaymentAccessToken({ orderId: "order-1" });

  const res = await fetch(
    `${baseUrl}/api/guest/orders/order-1?paymentToken=${paymentToken}`
  );
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.id, "order-1");
  assert.equal(body.access.type, "payment_token");
});

test("GET: paymentToken valid, dar pentru O ALTĂ comandă decât cea din URL -> 404 (token legat strict de orderId)", async () => {
  seedCardPendingGuestOrder("order-1");
  seedCardPendingGuestOrder("order-2");

  const paymentTokenForOrder2 = createGuestPaymentAccessToken({
    orderId: "order-2",
  });

  const res = await fetch(
    `${baseUrl}/api/guest/orders/order-1?paymentToken=${paymentTokenForOrder2}`
  );

  assert.equal(res.status, 404);
});

test("GET: paymentToken invalid/corupt -> 404", async () => {
  seedCardPendingGuestOrder("order-1");

  const res = await fetch(
    `${baseUrl}/api/guest/orders/order-1?paymentToken=not-a-real-jwt`
  );

  assert.equal(res.status, 404);
});

test("GET: fără niciun token (nici token, nici depositToken, nici paymentToken) -> 400", async () => {
  seedCardPendingGuestOrder("order-1");

  const res = await fetch(`${baseUrl}/api/guest/orders/order-1`);

  assert.equal(res.status, 400);
});

/* =========================================================
   POST /:id/payment?paymentToken=...
========================================================= */

test("POST payment: paymentToken valid, comandă CARD/PENDING -> 200 + redirectUrl, orchestratorul primește guestReturnTokenParam=paymentToken", async () => {
  seedCardPendingGuestOrder("order-1");
  orchestratorBehavior.mode = "success";

  const paymentToken = createGuestPaymentAccessToken({ orderId: "order-1" });

  const res = await fetch(
    `${baseUrl}/api/guest/orders/order-1/payment?paymentToken=${paymentToken}`,
    { method: "POST" }
  );
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(
    body.payment.redirectUrl,
    "https://checkout.stripe.test/cs_reminder_1"
  );

  assert.equal(lastCreatePaymentForOrderArg.guestReturnToken, paymentToken);
  assert.equal(
    lastCreatePaymentForOrderArg.guestReturnTokenParam,
    "paymentToken"
  );
});

test("POST payment: comandă COD -> 409 order_not_card (job-ul/reminder-ul nu o atinge)", async () => {
  seedCodGuestOrder("order-cod");

  const paymentToken = createGuestPaymentAccessToken({ orderId: "order-cod" });

  const res = await fetch(
    `${baseUrl}/api/guest/orders/order-cod/payment?paymentToken=${paymentToken}`,
    { method: "POST" }
  );
  const body = await res.json();

  assert.equal(res.status, 409);
  assert.equal(body.error, "order_not_card");
});

test("POST payment: comandă deja plătită -> 409 order_already_paid", async () => {
  seedPaidCardGuestOrder("order-paid");

  const paymentToken = createGuestPaymentAccessToken({ orderId: "order-paid" });

  const res = await fetch(
    `${baseUrl}/api/guest/orders/order-paid/payment?paymentToken=${paymentToken}`,
    { method: "POST" }
  );
  const body = await res.json();

  assert.equal(res.status, 409);
  assert.equal(body.error, "order_already_paid");
});

test("POST payment: depositToken NU este acceptat pentru plata integrală (fără token/paymentToken) -> 400", async () => {
  seedCardPendingGuestOrder("order-1");

  const res = await fetch(
    `${baseUrl}/api/guest/orders/order-1/payment?depositToken=whatever`,
    { method: "POST" }
  );

  assert.equal(res.status, 400);
});

test("POST payment: token normal (guestAccessToken) rămâne neschimbat - orchestratorul primește guestReturnTokenParam=token", async () => {
  const crypto = await import("crypto");
  const plainToken = "guest-token-plain-2";
  const hash = crypto
    .createHash("sha256")
    .update(plainToken)
    .digest("hex");

  orders.set("order-normal", {
    id: "order-normal",
    orderNumber: "AF-2004",
    userId: null,
    isGuestOrder: true,
    guestAccessTokenHash: hash,
    guestAccessExpiresAt: null,
    paymentMethod: "CARD",
    status: "PENDING",
    paidAt: null,
    total: 30,
    currency: "RON",
    subtotal: 30,
    shippingTotal: 0,
    shipments: [],
  });

  orchestratorBehavior.mode = "success";

  const res = await fetch(
    `${baseUrl}/api/guest/orders/order-normal/payment?token=${plainToken}`,
    { method: "POST" }
  );

  assert.equal(res.status, 200);
  assert.equal(lastCreatePaymentForOrderArg.guestReturnToken, plainToken);
  assert.equal(lastCreatePaymentForOrderArg.guestReturnTokenParam, "token");
});
