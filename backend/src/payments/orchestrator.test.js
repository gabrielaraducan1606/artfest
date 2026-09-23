// src/payments/orchestrator.test.js
//
// Teste deterministe pentru createPaymentForOrder() - protecția
// CENTRALĂ obligatorie pentru ORICE flux de plată CARD (creare
// comandă, retry payment, accept ofertă din assistant).
//
// Mocăm STRICT "../db.js" (Prisma) și "../lib/stripe.js" (Stripe
// client) cu node:test mock.module - restul e codul REAL de
// producție (orchestrator.js + vendorStripeStatus.js, neatinse).
//
// IMPORTANT: mock.module + import dinamic afectează doar modulele
// încărcate DUPĂ înregistrarea mock-ului; orchestrator.js importă
// static "./vendorStripeStatus.js", care la rândul lui importă
// "../db.js" - dacă am re-importa orchestrator.js cu query string
// nou la fiecare test, vendorStripeStatus.js ar rămâne cache-uit
// cu legătura din PRIMUL import. De aceea înregistrăm mock-urile o
// singură dată, importăm orchestrator.js o singură dată, și
// mutăm starea fake-db-ului (mutabilă) între teste.
//
// Rulare: node --experimental-test-module-mocks --test src/payments/orchestrator.test.js

process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:5"; // niciodată contactat cu adevărat
process.env.APP_URL = "https://app.test";

import { test, mock } from "node:test";
import assert from "node:assert/strict";

function readyVendor(id, overrides = {}) {
  return {
    id,
    stripeAccountId: `acct_${id}`,
    stripeChargesEnabled: true,
    stripePayoutsEnabled: true,
    stripeDetailsSubmitted: true,
    stripeConnectStatus: "enabled",
    ...overrides,
  };
}

/* =========================================================
   Fake DB mutabil - o singură instanță, reconfigurată per test
========================================================= */
let shipments = [];
let vendors = [];

const fakeDb = {
  __setShipments(rows) {
    shipments = rows;
  },
  __setVendors(rows) {
    vendors = rows;
  },

  shipment: {
    findMany: async ({ where: { orderId } }) =>
      shipments
        .filter((s) => s.orderId === orderId)
        .map((s) => ({ vendorId: s.vendorId })),
  },

  vendor: {
    findMany: async ({ where: { id: { in: ids } } }) =>
      vendors.filter((v) => ids.includes(v.id)).map((v) => ({ ...v })),
  },

  order: {
    update: async ({ where: { id }, data }) => ({ id, ...data }),
  },
};

let lastSessionCreateArgs = null;

const fakeStripe = {
  checkout: {
    sessions: {
      create: async (opts) => {
        lastSessionCreateArgs = opts;
        return {
          id: "cs_test_1",
          url: "https://checkout.stripe.test/cs_test_1",
        };
      },
    },
  },
};

mock.module("../db.js", {
  namedExports: { prisma: fakeDb },
});

mock.module("../lib/stripe.js", {
  namedExports: { stripe: fakeStripe },
});

const { createPaymentForOrder } = await import("./orchestrator.js");

/* =========================================================
   E. createPaymentForOrder cu vendor fără Stripe -> blocat
========================================================= */
test("E. createPaymentForOrder: vendor fără Stripe -> CardPaymentUnavailableError", async () => {
  fakeDb.__setShipments([{ orderId: "order-1", vendorId: "vendor-a" }]);
  fakeDb.__setVendors([readyVendor("vendor-a", { stripeAccountId: null })]);

  await assert.rejects(
    () =>
      createPaymentForOrder({
        id: "order-1",
        total: 100,
        currency: "RON",
        userId: "user-1",
      }),
    (err) => {
      assert.equal(err.code, "vendor_stripe_not_active");
      assert.equal(err.status, 400);
      return true;
    }
  );
});

/* =========================================================
   I/J/K, la nivelul fluxului complet de plată
========================================================= */
test("I. chargesEnabled=false -> blocat prin createPaymentForOrder", async () => {
  fakeDb.__setShipments([{ orderId: "order-1", vendorId: "vendor-a" }]);
  fakeDb.__setVendors([
    readyVendor("vendor-a", { stripeChargesEnabled: false }),
  ]);

  await assert.rejects(() =>
    createPaymentForOrder({ id: "order-1", total: 100, userId: "user-1" })
  );
});

test("J. payoutsEnabled=false -> blocat prin createPaymentForOrder", async () => {
  fakeDb.__setShipments([{ orderId: "order-1", vendorId: "vendor-a" }]);
  fakeDb.__setVendors([
    readyVendor("vendor-a", { stripePayoutsEnabled: false }),
  ]);

  await assert.rejects(() =>
    createPaymentForOrder({ id: "order-1", total: 100, userId: "user-1" })
  );
});

test("K. connectStatus='restricted' -> blocat prin createPaymentForOrder", async () => {
  fakeDb.__setShipments([{ orderId: "order-1", vendorId: "vendor-a" }]);
  fakeDb.__setVendors([
    readyVendor("vendor-a", { stripeConnectStatus: "restricted" }),
  ]);

  await assert.rejects(() =>
    createPaymentForOrder({ id: "order-1", total: 100, userId: "user-1" })
  );
});

/* =========================================================
   C. Multi-vendor, unul fără Stripe -> blocat integral
========================================================= */
test("C. multi-vendor, unul fără Stripe -> blocat integral", async () => {
  fakeDb.__setShipments([
    { orderId: "order-1", vendorId: "vendor-a" },
    { orderId: "order-1", vendorId: "vendor-b" },
  ]);
  fakeDb.__setVendors([
    readyVendor("vendor-a"),
    readyVendor("vendor-b", { stripeDetailsSubmitted: false }),
  ]);

  await assert.rejects(() =>
    createPaymentForOrder({ id: "order-1", total: 100, userId: "user-1" })
  );
});

/* =========================================================
   L. vendor(i) complet activ(i) -> fluxul CARD existent
   rămâne funcțional (creează Checkout Session, nu aruncă)
========================================================= */
test("L. vendor complet activ -> Checkout Session creată normal", async () => {
  fakeDb.__setShipments([{ orderId: "order-1", vendorId: "vendor-a" }]);
  fakeDb.__setVendors([readyVendor("vendor-a")]);

  const payment = await createPaymentForOrder({
    id: "order-1",
    total: 150,
    currency: "RON",
    userId: "user-1",
  });

  assert.equal(payment.provider, "stripe");
  assert.equal(payment.redirectUrl, "https://checkout.stripe.test/cs_test_1");
  assert.equal(lastSessionCreateArgs.metadata.orderId, "order-1");
});

test("L. multi-vendor, toți activi -> Checkout Session creată normal", async () => {
  fakeDb.__setShipments([
    { orderId: "order-1", vendorId: "vendor-a" },
    { orderId: "order-1", vendorId: "vendor-b" },
  ]);
  fakeDb.__setVendors([readyVendor("vendor-a"), readyVendor("vendor-b")]);

  const payment = await createPaymentForOrder({
    id: "order-1",
    total: 150,
    currency: "RON",
    userId: "user-1",
  });

  assert.equal(payment.provider, "stripe");
});

/* =========================================================
   Comandă fără shipments -> nu blochează (nimic de verificat);
   nu ar trebui să existe în practică, dar nu trebuie să crape
   pe verificarea Stripe.
========================================================= */
test("comandă fără shipments -> verificarea Stripe nu blochează", async () => {
  fakeDb.__setShipments([]);
  fakeDb.__setVendors([]);

  const payment = await createPaymentForOrder({
    id: "order-empty",
    total: 100,
    currency: "RON",
    userId: "user-1",
  });

  assert.equal(payment.provider, "stripe");
});

/* =========================================================
   GUEST: success/cancel URL - guestAccessToken (neschimbat) vs.
   guestReturnToken (paymentToken din reminder-ul de plată)
========================================================= */

test("guest, doar guestAccessToken (comportament EXISTENT, neschimbat): success/cancel URL cu ?token=", async () => {
  fakeDb.__setShipments([{ orderId: "order-guest-1", vendorId: "vendor-a" }]);
  fakeDb.__setVendors([readyVendor("vendor-a")]);

  await createPaymentForOrder({
    id: "order-guest-1",
    total: 100,
    currency: "RON",
    isGuestOrder: true,
    guestAccessToken: "plain-guest-token",
  });

  assert.equal(
    lastSessionCreateArgs.success_url,
    "https://app.test/comanda-guest/order-guest-1?token=plain-guest-token&payment=success"
  );

  assert.equal(
    lastSessionCreateArgs.cancel_url,
    "https://app.test/comanda-guest/order-guest-1?token=plain-guest-token&payment=cancelled"
  );
});

test("guest, cu guestReturnToken + guestReturnTokenParam=paymentToken (reminder plată): success/cancel URL cu ?paymentToken=", async () => {
  fakeDb.__setShipments([{ orderId: "order-guest-2", vendorId: "vendor-a" }]);
  fakeDb.__setVendors([readyVendor("vendor-a")]);

  await createPaymentForOrder({
    id: "order-guest-2",
    total: 100,
    currency: "RON",
    isGuestOrder: true,
    guestReturnToken: "jwt-payment-token",
    guestReturnTokenParam: "paymentToken",
  });

  assert.equal(
    lastSessionCreateArgs.success_url,
    "https://app.test/comanda-guest/order-guest-2?paymentToken=jwt-payment-token&payment=success"
  );

  assert.equal(
    lastSessionCreateArgs.cancel_url,
    "https://app.test/comanda-guest/order-guest-2?paymentToken=jwt-payment-token&payment=cancelled"
  );
});

test("guest, fără niciun token de acces -> guest_access_token_missing (neschimbat)", async () => {
  fakeDb.__setShipments([{ orderId: "order-guest-3", vendorId: "vendor-a" }]);
  fakeDb.__setVendors([readyVendor("vendor-a")]);

  await assert.rejects(
    () =>
      createPaymentForOrder({
        id: "order-guest-3",
        total: 100,
        currency: "RON",
        isGuestOrder: true,
      }),
    (err) => {
      assert.equal(err.message, "guest_access_token_missing");
      return true;
    }
  );
});
