// src/pages/Checkout/thankYouPurchase.test.js
// Rulare: node --test src/pages/Checkout/thankYouPurchase.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CARD_CONFIRMATION_POLL,
  getGuestOrderPath,
  getOrderApiPath,
  getPurchaseDecision,
  getThankYouOrderAccess,
  shouldPollForCardConfirmation,
  trackPurchaseOnce,
  wasPurchaseTracked,
} from "./thankYouPurchase.js";

const params = (query) => new URLSearchParams(query);

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

/* =========================================================
   Acces la comandă după Stripe (success_url)
========================================================= */

test("user întors din Stripe: /multumim?order=…&payment=success -> /api/user/orders/:id", () => {
  const access = getThankYouOrderAccess(params("order=ord_1&payment=success"), { id: "u1" });
  assert.equal(access.kind, "user");
  assert.equal(getOrderApiPath(access), "/api/user/orders/ord_1");
});

test("guest întors din Stripe cu token -> endpoint guest și link corect spre comandă", () => {
  const access = getThankYouOrderAccess(params("order=ord_2&token=abc&payment=success"), null);
  assert.equal(access.kind, "guest");
  assert.equal(getOrderApiPath(access), "/api/guest/orders/ord_2?token=abc");
  assert.equal(getGuestOrderPath(access), "/comanda-guest/ord_2?token=abc");
});

test("guest cu paymentToken (reminder de plată) -> același parametru păstrat", () => {
  const access = getThankYouOrderAccess(params("order=ord_3&paymentToken=jwt.x&payment=success"), null);
  assert.equal(getOrderApiPath(access), "/api/guest/orders/ord_3?paymentToken=jwt.x");
  assert.equal(getGuestOrderPath(access), "/comanda-guest/ord_3?paymentToken=jwt.x");
});

test("token guest are prioritate chiar dacă vizitatorul e autentificat", () => {
  const access = getThankYouOrderAccess(params("order=ord_4&token=abc"), { id: "u1" });
  assert.equal(access.kind, "guest");
});

test("fără order sau fără acces -> null", () => {
  assert.equal(getThankYouOrderAccess(params("payment=success"), { id: "u1" }), null);
  assert.equal(getThankYouOrderAccess(params("order=ord_5"), null), null);
});

/* =========================================================
   Decizia de raportare
========================================================= */

test("COD plasat -> raportăm", () => {
  const d = getPurchaseDecision({ paymentMethod: "COD", orderStatus: "PENDING", total: 120 });
  assert.equal(d.shouldTrack, true);
});

test("CARD neconfirmat (webhook încă neprocesat) -> NU raportăm", () => {
  const d = getPurchaseDecision({ paymentMethod: "CARD", orderStatus: "PENDING", total: 120 });
  assert.equal(d.shouldTrack, false);
  assert.equal(d.isPendingCard, true);
});

test("CARD confirmat (PAID sau paidAt) -> raportăm", () => {
  assert.equal(getPurchaseDecision({ paymentMethod: "CARD", orderStatus: "PAID", total: 99 }).shouldTrack, true);
  assert.equal(
    getPurchaseDecision({ paymentMethod: "card", orderStatus: "PENDING", paidAt: "2026-10-14T10:00:00Z", total: 99 }).shouldTrack,
    true
  );
});

test("comandă anulată sau total invalid -> NU raportăm", () => {
  assert.equal(getPurchaseDecision({ paymentMethod: "COD", orderStatus: "CANCELLED", total: 50 }).shouldTrack, false);
  assert.equal(getPurchaseDecision({ paymentMethod: "COD", total: 0 }).shouldTrack, false);
  assert.equal(getPurchaseDecision({ paymentMethod: "COD", total: "abc" }).shouldTrack, false);
  assert.equal(getPurchaseDecision(null).shouldTrack, false);
});

/* =========================================================
   Reîncercare până la confirmarea webhook-ului
========================================================= */

test("reîncercăm doar la întoarcerea din Stripe cu succes și doar cât CARD e neconfirmat", () => {
  const pending = getPurchaseDecision({ paymentMethod: "CARD", orderStatus: "PENDING", total: 10 });
  const paid = getPurchaseDecision({ paymentMethod: "CARD", orderStatus: "PAID", total: 10 });
  const cod = getPurchaseDecision({ paymentMethod: "COD", total: 10 });

  assert.equal(shouldPollForCardConfirmation(pending, { paymentReturn: "success", attempt: 0 }), true);
  assert.equal(shouldPollForCardConfirmation(paid, { paymentReturn: "success", attempt: 0 }), false);
  assert.equal(shouldPollForCardConfirmation(cod, { paymentReturn: "success", attempt: 0 }), false);
  assert.equal(shouldPollForCardConfirmation(pending, { paymentReturn: null, attempt: 0 }), false);
  assert.equal(
    shouldPollForCardConfirmation(pending, {
      paymentReturn: "success",
      attempt: CARD_CONFIRMATION_POLL.maxAttempts,
    }),
    false,
    "reîncercările sunt limitate"
  );
});

/* =========================================================
   Fără duplicate
========================================================= */

test("Purchase se raportează o singură dată per comandă (refresh / revenire / retry)", () => {
  const storage = memoryStorage();
  const calls = [];
  const track = (payload) => calls.push(payload);
  const data = {
    paymentMethod: "CARD",
    orderStatus: "PAID",
    total: 150,
    currency: "RON",
    items: [{ productId: "p1", price: 150, qty: 1 }],
  };

  // prima montare
  assert.equal(trackPurchaseOnce({ orderId: "ord_9", data, trackedRef: { current: false }, track, storage }), true);
  // același ref (re-render / effect rerulat)
  const ref = { current: true };
  assert.equal(trackPurchaseOnce({ orderId: "ord_9", data, trackedRef: ref, track, storage }), false);
  // montare nouă (refresh) - protecția din storage
  assert.equal(trackPurchaseOnce({ orderId: "ord_9", data, trackedRef: { current: false }, track, storage }), false);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    id: "ord_9",
    total: 150,
    currency: "RON",
    shippingTotal: undefined,
    items: data.items,
  });
  assert.equal(wasPurchaseTracked("ord_9", storage), true);
});

test("CARD neconfirmat nu marchează comanda ca raportată (poate fi raportată după confirmare)", () => {
  const storage = memoryStorage();
  const calls = [];
  const ref = { current: false };

  trackPurchaseOnce({
    orderId: "ord_10",
    data: { paymentMethod: "CARD", orderStatus: "PENDING", total: 80 },
    trackedRef: ref,
    track: (p) => calls.push(p),
    storage,
  });
  assert.equal(calls.length, 0);
  assert.equal(wasPurchaseTracked("ord_10", storage), false);

  trackPurchaseOnce({
    orderId: "ord_10",
    data: { paymentMethod: "CARD", orderStatus: "PAID", total: 80 },
    trackedRef: ref,
    track: (p) => calls.push(p),
    storage,
  });
  assert.equal(calls.length, 1);
});
