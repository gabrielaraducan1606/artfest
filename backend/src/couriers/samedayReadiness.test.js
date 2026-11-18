// Pregătirea contului Artfest pentru „Sameday prin Artfest” (samedayReadiness.js):
// bifa manuală nu e suficientă (cere AWB real reușit în mediu), erori permanente de cont
// vs erori temporare, eligibilitatea magazinului. Fără DB reală / rețea.
//
// Rulare: node --experimental-test-module-mocks --test src/couriers/samedayReadiness.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";

import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("../db.js", { namedExports: { prisma: {} } });
const R = await import("./samedayReadiness.js");

const ENV = {
  SAMEDAY_ARTFEST_DELIVERY_ENABLED: "true",
  COURIER_INTEGRATION_ENABLED: "1",
  COURIER_AWB_LIVE_ENABLED: "true",
  SAMEDAY_ACTIVE_ENVIRONMENT: "production",
  NODE_ENV: "production",
};
const account = (over = {}) => ({
  id: "acc",
  ownerType: "PLATFORM",
  vendorId: null,
  provider: "SAMEDAY",
  status: "ACTIVE",
  isDefault: true,
  disabledAt: null,
  credentialsCipher: Buffer.from("x"),
  ...over,
  publicConfig: { environment: "production", pickupPointId: "513381", serviceId: "7", awbVerifiedAt: "2026-11-20T08:00:00Z", ...(over.publicConfig || {}) },
});
const db = (acc, rows = []) => ({
  courierAccount: { findMany: async () => (acc ? [acc] : []) },
  courierAwb: { findMany: async () => [...rows].sort((a, b) => b.createdAt - a.createdAt) },
});
const row = (status, at, meta = {}, awbNumber = null, env = "production") => ({
  status,
  awbNumber,
  createdAt: new Date(at),
  updatedAt: new Date(at),
  providerMeta: { environment: env, ...meta },
});
const now = new Date("2026-11-21T12:00:00Z");
const SUCCESS = row("CREATED", "2026-11-20T09:00:00Z", {}, "1ONB1");
const readiness = (acc, rows, env = ENV) => R.platformSamedayReadiness({ db: db(acc, rows), env, now });

test("clasificarea eșecurilor: permanent cont / date / temporar / necunoscut", () => {
  assert.equal(R.classifyAwbFailure(row("FAILED", "2026-11-16", { errorCode: "courier_validation_failed", providerStatus: 422, providerCategories: ["third_party_pickup", "permission"] })), "permanent_account");
  assert.equal(R.classifyAwbFailure(row("FAILED", "2026-11-16", { errorCode: "courier_auth_failed" })), "permanent_account");
  assert.equal(R.classifyAwbFailure(row("FAILED", "2026-11-16", { errorCode: "courier_validation_failed", providerStatus: 422, fields: ["awbRecipient.phoneNumber"] })), "permanent_data");
  assert.equal(R.classifyAwbFailure(row("FAILED", "2026-11-16", { errorCode: "courier_unavailable", providerStatus: 503 })), "temporary");
  assert.equal(R.classifyAwbFailure(row("UNKNOWN", "2026-11-16")), "temporary");
  assert.equal(R.classifyAwbFailure(row("FAILED", "2026-11-16", { errorCode: "courier_validation_failed", providerStatus: 422, providerMessagesRedacted: 1 })), "unknown_rejection");
  assert.equal(R.classifyAwbFailure(SUCCESS), null);
});

test("situația de azi din producție (respingeri 422 fără detalii, fără AWB reușit) -> NU e gata", async () => {
  const rows = Array.from({ length: 6 }, (_, i) => row("FAILED", `2026-11-16T1${i}:00:00Z`, { errorCode: "courier_validation_failed", providerStatus: 422 }));
  const r = await readiness(account({ publicConfig: { awbVerifiedAt: null } }), rows);
  assert.equal(r.ready, false);
  assert.ok(r.reasons.includes("awb_not_verified_by_admin"));
  assert.ok(r.reasons.includes("no_successful_awb_in_environment"));
});

test("comutatorul dedicat e oprit implicit -> NU e gata", async () => {
  const r = await readiness(account(), [SUCCESS], { ...ENV, SAMEDAY_ARTFEST_DELIVERY_ENABLED: "" });
  assert.ok(!r.ready && r.reasons.includes("feature_flag_off"));
});

test("bifa Admin fără AWB real reușit nu este suficientă", async () => {
  const r = await readiness(account(), []);
  assert.ok(!r.ready && r.reasons.includes("no_successful_awb_in_environment"));
});

test("cont INVALID_CREDENTIALS / AWB live oprit / AWB reușit doar în DEMO -> NU e gata", async () => {
  assert.equal((await readiness(account({ status: "INVALID_CREDENTIALS" }), [SUCCESS])).ready, false);
  const live = await readiness(account(), [SUCCESS], { ...ENV, COURIER_AWB_LIVE_ENABLED: "false" });
  assert.ok(!live.ready && live.reasons.includes("awb_live_disabled"));
  const demo = await readiness(account(), [row("CREATED", "2026-11-19T10:00:00Z", {}, "1ONB2", "demo")]);
  assert.ok(!demo.ready && demo.reasons.includes("no_successful_awb_in_environment"));
});

test("toate condițiile îndeplinite -> gata", async () => {
  const r = await readiness(account(), [SUCCESS]);
  assert.equal(r.ready, true, JSON.stringify(r.reasons));
});

test("respingere permanentă de cont DUPĂ un AWB reușit -> blocat automat", async () => {
  const r = await readiness(account(), [SUCCESS, row("FAILED", "2026-11-21T08:00:00Z", { errorCode: "courier_validation_failed", providerStatus: 422, providerCategories: ["third_party_pickup", "permission"] })]);
  assert.ok(!r.ready && r.reasons.includes("permanent_account_rejection"));
});

test("erori temporare -> rămâne gata, marcat degraded; erori pe datele unei expedieri nu blochează", async () => {
  const t = await readiness(account(), [SUCCESS, row("FAILED", "2026-11-21T08:00:00Z", { errorCode: "courier_timeout" }), row("UNKNOWN", "2026-11-21T09:00:00Z")]);
  assert.ok(t.ready && t.degraded && t.recentTemporaryFailures === 2);
  const d = await readiness(account(), [SUCCESS, row("FAILED", "2026-11-21T08:00:00Z", { errorCode: "courier_validation_failed", providerStatus: 422, fields: ["awbRecipient.postalCode"] })]);
  assert.ok(d.ready);
});

test("eligibilitatea magazinului: opt-in, restricție Artfest, Stripe, adresă, platformă", () => {
  const vendorOk = { stripeAccountId: "acct", stripeChargesEnabled: true, stripePayoutsEnabled: true, stripeDetailsSubmitted: true, stripeConnectStatus: "enabled" };
  assert.deepEqual(R.storeSamedayEligibility({ store: { samedayOptInAt: new Date() }, vendor: vendorOk, readiness: { ready: true }, pickupReady: true }), { eligible: true, reasons: [] });
  assert.deepEqual(
    R.storeSamedayEligibility({ store: {}, vendor: { ...vendorOk, stripeConnectStatus: "pending" }, readiness: { ready: false }, pickupReady: false }).reasons,
    ["platform_not_ready", "store_not_opted_in", "vendor_stripe_not_ready", "pickup_address_not_ready"]
  );
  assert.deepEqual(
    R.storeSamedayEligibility({ store: { samedayOptInAt: new Date(), samedayDisabledAt: new Date() }, vendor: vendorOk, readiness: { ready: true }, pickupReady: true }).reasons,
    ["store_disabled_by_artfest"]
  );
});
