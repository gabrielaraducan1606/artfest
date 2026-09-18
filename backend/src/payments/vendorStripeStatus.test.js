// src/payments/vendorStripeStatus.test.js
//
// Teste deterministe, unitare, PURE (nu ating DB/Stripe) pentru
// sursa unică de adevăr "vendorul are Stripe activ"
// (isVendorStripeReady / computeCardPaymentAvailability).
//
// Acoperă exact scenariile I, J, K, L din auditul de plăți CARD:
// - I: stripeAccountId prezent, chargesEnabled=false -> blocat
// - J: payoutsEnabled=false -> blocat
// - K: connectStatus="restricted" -> blocat
// - L: vendor complet activ -> disponibil

process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:5";

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isVendorStripeReady,
  computeCardPaymentAvailability,
} from "./vendorStripeStatus.js";

function readyVendor(overrides = {}) {
  return {
    stripeAccountId: "acct_1",
    stripeChargesEnabled: true,
    stripePayoutsEnabled: true,
    stripeDetailsSubmitted: true,
    stripeConnectStatus: "enabled",
    ...overrides,
  };
}

test("L. vendor complet activ -> Stripe ready", () => {
  assert.equal(isVendorStripeReady(readyVendor()), true);
});

test("vendor fără stripeAccountId -> NU e ready", () => {
  assert.equal(
    isVendorStripeReady(readyVendor({ stripeAccountId: null })),
    false
  );
});

test("I. stripeAccountId prezent, chargesEnabled=false -> NU e ready", () => {
  assert.equal(
    isVendorStripeReady(readyVendor({ stripeChargesEnabled: false })),
    false
  );
});

test("J. payoutsEnabled=false -> NU e ready", () => {
  assert.equal(
    isVendorStripeReady(readyVendor({ stripePayoutsEnabled: false })),
    false
  );
});

test("stripeDetailsSubmitted=false (onboarding incomplet) -> NU e ready", () => {
  assert.equal(
    isVendorStripeReady(readyVendor({ stripeDetailsSubmitted: false })),
    false
  );
});

test("K. connectStatus='restricted' -> NU e ready", () => {
  assert.equal(
    isVendorStripeReady(readyVendor({ stripeConnectStatus: "restricted" })),
    false
  );
});

test("connectStatus='pending' -> NU e ready", () => {
  assert.equal(
    isVendorStripeReady(readyVendor({ stripeConnectStatus: "pending" })),
    false
  );
});

test("vendor null/undefined -> NU e ready, nu aruncă", () => {
  assert.equal(isVendorStripeReady(null), false);
  assert.equal(isVendorStripeReady(undefined), false);
});

test("A/B. computeCardPaymentAvailability: un singur vendor, ready/not-ready", () => {
  assert.equal(computeCardPaymentAvailability([readyVendor()]), true);
  assert.equal(
    computeCardPaymentAvailability([readyVendor({ stripeChargesEnabled: false })]),
    false
  );
});

test("C. multi-vendor, unul fără Stripe -> indisponibil pentru toată comanda", () => {
  const vendors = [
    readyVendor(),
    readyVendor({ stripeAccountId: null }),
  ];
  assert.equal(computeCardPaymentAvailability(vendors), false);
});

test("multi-vendor, toți activi -> disponibil", () => {
  const vendors = [readyVendor(), readyVendor()];
  assert.equal(computeCardPaymentAvailability(vendors), true);
});

test("fără vendori relevanți (coș gol) -> considerăm disponibil (nu blocăm fals)", () => {
  assert.equal(computeCardPaymentAvailability([]), true);
  assert.equal(computeCardPaymentAvailability(undefined), true);
});
