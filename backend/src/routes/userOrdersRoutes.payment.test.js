// src/routes/userOrdersRoutes.payment.test.js
//
// Teste deterministe pentru POST /api/user/orders/:id/payment
// (retry plată CARD pentru user autentificat) - FĂRĂ Stripe real,
// FĂRĂ DB real. Mocăm STRICT "../db.js" (Prisma), "../api/auth.js"
// (doar ca să treacă middleware-ul) și "../payments/orchestrator.js"
// (izolăm testul de logica internă a createPaymentForOrder, deja
// acoperită separat în orchestrator.test.js) - restul e codul REAL
// al rutei (userOrdersRoutes.js, neatins).
//
// Acoperă scenariul F din audit: retry payment pentru un user
// autentificat, DUPĂ ce vendorul și-a pierdut Stripe -> trebuie
// blocat server-side (nu doar la creare comandă).
//
// Rulare: node --experimental-test-module-mocks --test src/routes/userOrdersRoutes.payment.test.js

process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:5";

import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import { CardPaymentUnavailableError } from "../payments/vendorStripeStatus.js";

let orders;
let server;
let baseUrl;
let orchestratorBehavior;

function makeFakeDb() {
  return {
    order: {
      findFirst: async ({ where }) => {
        const candidates = [...orders.values()].filter(
          (o) => o.userId === where.userId
        );
        return (
          candidates.find((o) =>
            (where.OR || []).some(
              (cond) =>
                (cond.id && cond.id === o.id) ||
                (cond.orderNumber && cond.orderNumber === o.orderNumber)
            )
          ) || null
        );
      },
    },
  };
}

async function freshApp() {
  orders = new Map();
  orchestratorBehavior = { mode: "success" };

  const moduleMockDb = mock.module("../db.js", {
    namedExports: { prisma: makeFakeDb() },
  });

  const moduleMockAuth = mock.module("../api/auth.js", {
    namedExports: {
      authRequired: (req, _res, next) => {
        req.user = { sub: "user-1" };
        next();
      },
    },
  });

  const moduleMockOrchestrator = mock.module("../payments/orchestrator.js", {
    namedExports: {
      createPaymentForOrder: async () => {
        if (orchestratorBehavior.mode === "blocked") {
          throw new CardPaymentUnavailableError();
        }
        return {
          provider: "stripe",
          redirectUrl: "https://checkout.stripe.test/cs_retry_1",
        };
      },
      createDepositPaymentForShipment: async () => ({}),
    },
  });

  const mod = await import(
    `./userOrdersRoutes.js?t=${Date.now()}-${Math.random()}`
  );

  return {
    router: mod.default,
    restore: () => {
      moduleMockDb.restore();
      moduleMockAuth.restore();
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
  app.use("/api/user/orders", router);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (restoreCurrent) restoreCurrent();
});

function seedCardPendingOrder() {
  orders.set("order-1", {
    id: "order-1",
    orderNumber: "AF-1001",
    userId: "user-1",
    paymentMethod: "CARD",
    status: "PENDING",
    paidAt: null,
  });
}

test("F. retry payment user: vendorul și-a pierdut Stripe -> 400 vendor_stripe_not_active", async () => {
  seedCardPendingOrder();
  orchestratorBehavior.mode = "blocked";

  const res = await fetch(`${baseUrl}/api/user/orders/order-1/payment`, {
    method: "POST",
  });
  const body = await res.json();

  assert.equal(res.status, 400);
  assert.equal(body.error, "vendor_stripe_not_active");
});

test("retry payment user: vendor Stripe-ready -> 200 + redirectUrl (fluxul existent rămâne funcțional)", async () => {
  seedCardPendingOrder();
  orchestratorBehavior.mode = "success";

  const res = await fetch(`${baseUrl}/api/user/orders/order-1/payment`, {
    method: "POST",
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.payment.redirectUrl, "https://checkout.stripe.test/cs_retry_1");
});

test("retry payment user: comandă COD -> 409 order_not_card (neschimbat)", async () => {
  orders.set("order-cod", {
    id: "order-cod",
    orderNumber: "AF-1002",
    userId: "user-1",
    paymentMethod: "COD",
    status: "PENDING",
    paidAt: null,
  });

  const res = await fetch(`${baseUrl}/api/user/orders/order-cod/payment`, {
    method: "POST",
  });
  const body = await res.json();

  assert.equal(res.status, 409);
  assert.equal(body.error, "order_not_card");
});
