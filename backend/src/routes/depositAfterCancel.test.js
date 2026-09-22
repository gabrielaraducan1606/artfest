// src/routes/depositAfterCancel.test.js
//
// Scenariu: comandă COD, vendorul cere avans (depositStatus = PENDING, sesiune
// Stripe Checkout deja creată), Clientul ANULEAZĂ comanda, apoi încearcă să
// plătească avansul. O comandă anulată nu trebuie să mai poată primi avans.
//
// Rutele REALE (user cancel + user pay-deposit, guest pay-deposit, webhook
// Stripe), orchestratorul real; mock-uri doar pe DB (in-memory), Stripe,
// auth și trimiterile de email/notificări.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/depositAfterCancel.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";
process.env.JWT_SECRET = "test-secret";
process.env.APP_URL = "https://app.test";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";

import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "crypto";
import express from "express";

const GUEST_TOKEN = "guest-token-plain";
const GUEST_TOKEN_HASH = crypto.createHash("sha256").update(GUEST_TOKEN).digest("hex");

/* =========================================================
   Fake DB
========================================================= */

function matches(row, where = {}) {
  for (const [key, cond] of Object.entries(where)) {
    if (key === "OR" || key === "AND" || key === "order") continue;
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

function makeFakeDb() {
  const orders = new Map();
  const shipments = new Map();
  const eventRows = new Map();

  const orderWithShipments = (o, extra = {}) => ({
    ...o,
    shipments: [...shipments.values()]
      .filter((s) => s.orderId === o.id)
      .map((s) => ({ ...s, items: [], vendor: s.vendor })),
    ...extra,
  });

  const db = {
    __orders: orders,
    __shipments: shipments,

    order: {
      findFirst: async ({ where }) => {
        // user (cancel)
        if (where.userId) {
          const o = orders.get(where.id);
          if (!o || o.userId !== where.userId) return null;
          return orderWithShipments(o, { user: { email: "client@example.com" } });
        }
        // guest (token hash)
        const o = [...orders.values()].find(
          (x) => x.isGuestOrder && x.guestAccessTokenHash === where.guestAccessTokenHash
        );
        return o ? orderWithShipments(o) : null;
      },
      findUnique: async ({ where: { id } }) => {
        const o = orders.get(id);
        return o ? orderWithShipments(o) : null;
      },
      update: async ({ where: { id }, data }) => Object.assign(orders.get(id), data),
    },

    shipment: {
      findFirst: async ({ where }) => {
        const s = shipments.get(where.id);
        if (!s || s.orderId !== where.orderId) return null;
        const o = orders.get(s.orderId);
        if (where.order?.userId && o.userId !== where.order.userId) return null;
        return { ...s, order: { status: o.status } };
      },
      findUnique: async ({ where: { id } }) => {
        const s = shipments.get(id);
        return s ? { ...s, order: orders.get(s.orderId) } : null;
      },
      findMany: async ({ where }) =>
        [...shipments.values()].filter((s) => matches(s, where)),
      update: async ({ where: { id }, data }) => Object.assign(shipments.get(id), data),
      updateMany: async ({ where, data }) => {
        const rows = [...shipments.values()].filter((s) => matches(s, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    },

    // StripeEvent cu semantica reală: conflict de unicitate = P2002, stări
    // PROCESSING/COMPLETED/FAILED (services/stripeEventClaim.js)
    stripeEvent: {
      create: async ({ data }) => {
        if (eventRows.has(data.eventId)) {
          const error = new Error("Unique constraint failed on eventId");
          error.code = "P2002";
          throw error;
        }
        eventRows.set(data.eventId, { ...data, receivedAt: new Date(), processedAt: null, error: null });
        return data;
      },
      findUnique: async ({ where: { eventId } }) => {
        const row = eventRows.get(eventId);
        return row ? { ...row } : null;
      },
      updateMany: async ({ where, data }) => {
        const row = eventRows.get(where.eventId);
        if (!row) return { count: 0 };
        const matchesState = Object.entries(where).every(([k, v]) => {
          if (k === "eventId") return true;
          if (v instanceof Date) return row[k] instanceof Date && row[k].getTime() === v.getTime();
          return row[k] === v;
        });
        if (!matchesState) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },

    $transaction: async (cb) => cb(db),
  };

  return db;
}

/* =========================================================
   Fake Stripe
========================================================= */

function makeFakeStripe() {
  const calls = {
    sessionsCreate: [],
    sessionsExpire: [],
    refunds: [],
    transfers: [],
  };

  return {
    checkout: {
      sessions: {
        create: async (opts) => {
          calls.sessionsCreate.push(opts);
          return { id: `cs_new_${calls.sessionsCreate.length}`, url: "https://checkout.stripe.test/new" };
        },
        expire: async (id) => {
          calls.sessionsExpire.push(id);
          return { id, status: "expired" };
        },
      },
    },
    refunds: {
      create: async (opts) => {
        calls.refunds.push(opts);
        return { id: `re_${calls.refunds.length}` };
      },
    },
    transfers: {
      create: async (opts) => {
        calls.transfers.push(opts);
        return { id: `tr_${calls.transfers.length}` };
      },
    },
    webhooks: { constructEvent: (body) => (Buffer.isBuffer(body) ? JSON.parse(body.toString()) : body) },
    __calls: calls,
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

const dbProxy = new Proxy({}, { get: (_t, k) => fakeDb[k] });
const stripeProxy = new Proxy({}, { get: (_t, k) => fakeStripe[k] });

before(async () => {
  const mocks = [];
  const reg = (spec, exports) => mocks.push(mock.module(spec, { namedExports: exports }));

  reg("../db.js", { prisma: dbProxy });
  reg("../lib/stripe.js", { stripe: stripeProxy });
  reg("../api/auth.js", {
    authRequired: (req, _res, next) => {
      req.user = { sub: "user-1", email: "client@test.local" };
      next();
    },
    requireRole: () => (_req, _res, next) => next(),
    enforceTokenVersion: (_req, _res, next) => next(),
  });

  const actualMailer = await import("../lib/mailer.js");
  const actualMessaging = await import("../services/orderMessaging.js");
  const actualStock = await import("../services/stockRestore.js");

  reg("../lib/mailer.js", { ...actualMailer, sendOrderCancelledByUserEmail: async () => {} });
  reg("../services/orderMessaging.js", {
    ...actualMessaging,
    sendOrderCancelledByUserNotifications: async () => {},
  });
  reg("../services/stockRestore.js", { ...actualStock, restoreStockFromItems: async () => {} });

  restoreAll = () => mocks.forEach((m) => m.restore());

  const stamp = Date.now();
  const userRouter = (await import(`./userOrdersRoutes.js?t=${stamp}-u`)).default;
  const guestRouter = (await import(`./guestOrderRoutes.js?t=${stamp}-g`)).default;
  const webhookRouter = (await import(`./stripeWebhookRoutes.js?t=${stamp}-w`)).default;

  const app = express();
  app.use(express.json());
  app.use("/api/user/orders", userRouter);
  app.use("/api/guest/orders", guestRouter);
  app.use("/api/stripe/webhook", webhookRouter);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  restoreAll?.();
});

const vendorReady = {
  id: "vA",
  stripeAccountId: "acct_1",
  stripeChargesEnabled: true,
  stripePayoutsEnabled: true,
  stripeDetailsSubmitted: true,
  stripeConnectStatus: "enabled",
  displayName: "Atelier A",
  email: "a@v.ro",
  user: { email: "a@u.ro" },
};

function seedCodOrderWithPendingDeposit({ guest = false } = {}) {
  fakeDb = makeFakeDb();
  fakeStripe = makeFakeStripe();

  fakeDb.__orders.set("o1", {
    id: "o1",
    orderNumber: "AF-3001",
    userId: guest ? null : "user-1",
    isGuestOrder: guest,
    guestAccessTokenHash: guest ? GUEST_TOKEN_HASH : null,
    guestAccessExpiresAt: null,
    paymentMethod: "COD",
    status: "PENDING",
    currency: "RON",
    shippingAddress: { email: "client@example.com" },
  });

  fakeDb.__shipments.set("s1", {
    id: "s1",
    orderId: "o1",
    vendorId: "vA",
    status: "PENDING",
    depositStatus: "PENDING",
    depositPercent: 15,
    depositRequestedAmount: 15,
    depositExpiresAt: new Date(Date.now() + 20 * 60 * 60 * 1000),
    stripeDepositSessionId: "cs_old",
    depositMeta: { checkoutUrl: "https://checkout.stripe.test/old" },
    vendor: vendorReady,
  });
}

async function post(path, body) {
  const res = await fetch(baseUrl + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

const payDepositUser = () => post("/api/user/orders/o1/shipments/s1/pay-deposit");
const payDepositGuest = () =>
  post(`/api/guest/orders/o1/shipments/s1/pay-deposit?token=${GUEST_TOKEN}`);

/* =========================================================
   Scenariul cerut
========================================================= */

test("CONTROL: comandă activă, avans PENDING -> plata avansului se deschide (user)", async () => {
  seedCodOrderWithPendingDeposit();

  const r = await payDepositUser();

  assert.equal(r.status, 200);
  assert.ok(r.body.url);
  assert.equal(fakeStripe.__calls.sessionsCreate.length, 1);
});

test("CONTROL: comandă activă, avans PENDING -> plata avansului se deschide (guest)", async () => {
  seedCodOrderWithPendingDeposit({ guest: true });

  const r = await payDepositGuest();

  assert.equal(r.status, 200);
  assert.ok(r.body.url);
});

test("SCENARIU: COD + avans PENDING -> Clientul anulează -> plata avansului (user) e BLOCATĂ, fără sesiune Stripe nouă", async () => {
  seedCodOrderWithPendingDeposit();

  const cancel = await post("/api/user/orders/o1/cancel");
  assert.equal(cancel.status, 200, "anularea reușește (avans doar PENDING, nu PAID)");
  assert.equal(fakeDb.__orders.get("o1").status, "CANCELLED");

  const pay = await payDepositUser();

  assert.equal(pay.status, 409, `plata trebuie refuzată, primit ${pay.status}`);
  assert.equal(fakeStripe.__calls.sessionsCreate.length, 0, "nu se creează sesiune Stripe pe o comandă anulată");
});

test("ANULARE: avansul PENDING devine EXPIRED, iar sesiunea Stripe deja creată e expirată (linkul din email nu mai plătește)", async () => {
  seedCodOrderWithPendingDeposit();

  await post("/api/user/orders/o1/cancel");

  assert.equal(fakeDb.__shipments.get("s1").depositStatus, "EXPIRED");
  assert.equal(fakeDb.__shipments.get("s1").depositPaymentError, "order_cancelled");
  assert.deepEqual(fakeStripe.__calls.sessionsExpire, ["cs_old"]);
});

test("GUEST: comandă anulată (de vendor/admin) cu avans încă PENDING -> plata avansului e blocată", async () => {
  seedCodOrderWithPendingDeposit({ guest: true });
  fakeDb.__orders.get("o1").status = "CANCELLED";
  fakeDb.__shipments.get("s1").status = "REFUSED";

  const r = await payDepositGuest();

  assert.equal(r.status, 409);
  assert.equal(fakeStripe.__calls.sessionsCreate.length, 0);
});

test("ORCHESTRATOR (apărare centrală): createDepositPaymentForShipment refuză o comandă/livrare anulată", async () => {
  seedCodOrderWithPendingDeposit();
  fakeDb.__orders.get("o1").status = "CANCELLED";

  const { createDepositPaymentForShipment } = await import("../payments/orchestrator.js");

  await assert.rejects(createDepositPaymentForShipment({ shipmentId: "s1" }), (error) =>
    ["order_cancelled", "shipment_cancelled"].includes(error.code)
  );
  assert.equal(fakeStripe.__calls.sessionsCreate.length, 0);

  // livrare anulată individual, comanda încă activă (multi-vendor)
  fakeDb.__orders.get("o1").status = "PENDING";
  fakeDb.__shipments.get("s1").status = "REFUSED";

  await assert.rejects(createDepositPaymentForShipment({ shipmentId: "s1" }), (error) =>
    error.code === "shipment_cancelled"
  );
  assert.equal(fakeStripe.__calls.sessionsCreate.length, 0);
});

/* =========================================================
   Plasă de siguranță: avans plătit efectiv pe comandă anulată
========================================================= */

function depositPaymentIntentEvent(id = "evt_1") {
  return {
    id,
    type: "payment_intent.succeeded",
    livemode: false,
    data: {
      object: {
        id: "pi_dep_1",
        amount: 1500,
        amount_received: 1500,
        metadata: { kind: "deposit_payment", shipmentId: "s1", vendorId: "vA", orderId: "o1" },
        charges: { data: [{ id: "ch_dep", balance_transaction: { fee: 50 } }] },
      },
    },
  };
}

test("WEBHOOK: avans plătit pe comandă ANULATĂ -> refund automat al avansului, fără transfer către vendor, fără PAID", async () => {
  seedCodOrderWithPendingDeposit();
  fakeDb.__orders.get("o1").status = "CANCELLED";
  fakeDb.__shipments.get("s1").status = "REFUSED";

  const r = await post("/api/stripe/webhook", depositPaymentIntentEvent());

  assert.equal(r.status, 200);
  assert.equal(fakeStripe.__calls.refunds.length, 1);
  assert.equal(fakeStripe.__calls.refunds[0].payment_intent, "pi_dep_1");
  assert.equal(fakeStripe.__calls.transfers.length, 0, "vendorul nu primește transfer");
  assert.equal(fakeDb.__shipments.get("s1").depositStatus, "REFUNDED");
  assert.notEqual(fakeDb.__shipments.get("s1").depositStatus, "PAID");

  // webhook duplicat: ignorat, fără al doilea refund
  const again = await post("/api/stripe/webhook", depositPaymentIntentEvent());
  assert.equal(again.status, 200);
  assert.equal(fakeStripe.__calls.refunds.length, 1);
});

test("WEBHOOK CONTROL: avans plătit pe comandă ACTIVĂ -> PAID + transfer către vendor, fără refund", async () => {
  seedCodOrderWithPendingDeposit();

  const r = await post("/api/stripe/webhook", depositPaymentIntentEvent("evt_ok"));

  assert.equal(r.status, 200);
  assert.equal(fakeStripe.__calls.refunds.length, 0);
  assert.equal(fakeStripe.__calls.transfers.length, 1);
  assert.equal(fakeDb.__shipments.get("s1").depositStatus, "PAID");
});
