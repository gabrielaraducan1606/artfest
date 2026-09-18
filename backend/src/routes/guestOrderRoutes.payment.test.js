// src/routes/guestOrderRoutes.payment.test.js
//
// Teste deterministe pentru POST /api/guest/orders/:id/payment
// (retry plată CARD pentru guest) - FĂRĂ Stripe real, FĂRĂ DB real.
// Mocăm STRICT "../db.js" (Prisma) și "../payments/orchestrator.js"
// (izolăm testul de logica internă a createPaymentForOrder, deja
// acoperită separat în orchestrator.test.js) - restul e codul REAL
// al rutei (guestOrderRoutes.js, neatins). Nu mocăm auth - ruta
// guest nu are middleware de autentificare, tokenul e verificat
// direct de findGuestOrder() prin hash.
//
// Acoperă scenariul G din audit: retry payment guest, DUPĂ ce
// vendorul și-a pierdut Stripe -> trebuie blocat server-side.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/guestOrderRoutes.payment.test.js

process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:5";
process.env.JWT_SECRET = "test-secret";

import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import crypto from "crypto";

import { CardPaymentUnavailableError } from "../payments/vendorStripeStatus.js";

const GUEST_TOKEN = "guest-token-plain";
const GUEST_TOKEN_HASH = crypto
  .createHash("sha256")
  .update(GUEST_TOKEN)
  .digest("hex");

let orders;
let server;
let baseUrl;
let orchestratorBehavior;

function makeFakeDb() {
  return {
    order: {
      findFirst: async ({ where }) => {
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

  const moduleMockOrchestrator = mock.module("../payments/orchestrator.js", {
    namedExports: {
      createPaymentForOrder: async () => {
        if (orchestratorBehavior.mode === "blocked") {
          throw new CardPaymentUnavailableError();
        }
        return {
          provider: "stripe",
          redirectUrl: "https://checkout.stripe.test/cs_guest_retry_1",
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

function seedCardPendingGuestOrder() {
  orders.set("order-1", {
    id: "order-1",
    orderNumber: "AF-1001",
    userId: null,
    isGuestOrder: true,
    guestAccessTokenHash: GUEST_TOKEN_HASH,
    guestAccessExpiresAt: null,
    paymentMethod: "CARD",
    status: "PENDING",
    paidAt: null,
  });
}

test("G. retry payment guest: vendorul și-a pierdut Stripe -> 400 vendor_stripe_not_active", async () => {
  seedCardPendingGuestOrder();
  orchestratorBehavior.mode = "blocked";

  const res = await fetch(
    `${baseUrl}/api/guest/orders/order-1/payment?token=${GUEST_TOKEN}`,
    { method: "POST" }
  );
  const body = await res.json();

  assert.equal(res.status, 400);
  assert.equal(body.error, "vendor_stripe_not_active");
});

test("retry payment guest: vendor Stripe-ready -> 200 + redirectUrl (fluxul existent rămâne funcțional)", async () => {
  seedCardPendingGuestOrder();
  orchestratorBehavior.mode = "success";

  const res = await fetch(
    `${baseUrl}/api/guest/orders/order-1/payment?token=${GUEST_TOKEN}`,
    { method: "POST" }
  );
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(
    body.payment.redirectUrl,
    "https://checkout.stripe.test/cs_guest_retry_1"
  );
});

test("retry payment guest: token invalid -> 404 (neschimbat)", async () => {
  seedCardPendingGuestOrder();

  const res = await fetch(
    `${baseUrl}/api/guest/orders/order-1/payment?token=wrong-token`,
    { method: "POST" }
  );

  assert.equal(res.status, 404);
});
