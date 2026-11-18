// Livrare Sameday prin Artfest per magazin (samedayStoreDelivery.js): eligibilitate,
// activare / dezactivare, restricții Stripe și Admin, indisponibilitatea Sameday.
// DB în memorie (fără rețea, fără Sameday, fără Stripe).
//
// Rulare: node --experimental-test-module-mocks --test src/services/shipping/samedayStoreDelivery.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";

import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("../../db.js", { namedExports: { prisma: {} } });

const svc = await import("./samedayStoreDelivery.js");

const READY_ENV = {
  SAMEDAY_ARTFEST_DELIVERY_ENABLED: "true",
  COURIER_INTEGRATION_ENABLED: "1",
  COURIER_AWB_LIVE_ENABLED: "true",
  SAMEDAY_ACTIVE_ENVIRONMENT: "production",
  NODE_ENV: "production",
};
const NOW = new Date("2026-11-21T12:00:00Z");
const STRIPE_OK = { stripeAccountId: "acct_1", stripeChargesEnabled: true, stripePayoutsEnabled: true, stripeDetailsSubmitted: true, stripeConnectStatus: "enabled" };
const PICKUP_OK = { id: "pa1", vendorId: "v1", contactName: "Ion Pop", phone: "0722123456", county: "Buzău", city: "Buzău", street: "Str. A", streetNo: "1", postalCode: "120001", isDefault: true, createdAt: new Date() };

function makeDb({ store = {}, vendor = STRIPE_OK, pickup = PICKUP_OK, account = "ready", awbs = "success", throwOnAccount = false } = {}) {
  const stores = new Map([
    ["s1", { id: "s1", vendorId: "v1", title: "Magazin 1", status: "ACTIVE", isActive: true, type: { code: "products" }, samedayOptInAt: null, samedayOptInById: null, samedayDisabledAt: null, samedayDisabledById: null, ...store }],
    ["s2", { id: "s2", vendorId: "v2", title: "Altul", status: "ACTIVE", isActive: true, type: { code: "products" }, samedayOptInAt: null, samedayOptInById: null, samedayDisabledAt: null, samedayDisabledById: null }],
  ]);
  const acc =
    account === "ready"
      ? { id: "acc", ownerType: "PLATFORM", vendorId: null, provider: "SAMEDAY", status: "ACTIVE", isDefault: true, disabledAt: null, credentialsCipher: Buffer.from("x"), publicConfig: { environment: "production", pickupPointId: "513381", serviceId: "7", awbVerifiedAt: "2026-11-20T08:00:00Z" } }
      : account;
  const awbRows =
    awbs === "success"
      ? [{ status: "CREATED", awbNumber: "1ONB1", createdAt: new Date("2026-11-20T09:00:00Z"), updatedAt: new Date(), providerMeta: { environment: "production" } }]
      : awbs;
  const pick = (s, select) => (select ? Object.fromEntries(Object.keys(select).filter((k) => k in s).map((k) => [k, s[k]])) : { ...s });
  const db = {
    stores,
    vendorService: {
      findFirst: async ({ where, select }) => {
        const s = stores.get(where.id);
        return s && s.vendorId === where.vendorId ? pick(s, select) : null;
      },
      findUnique: async ({ where, select }) => (stores.get(where.id) ? pick(stores.get(where.id), select) : null),
      update: async ({ where, data }) => Object.assign(stores.get(where.id), data),
      findMany: async () => [...stores.values()].filter((s) => s.samedayOptInAt || s.samedayDisabledAt).map((s) => ({ ...s, vendor: { id: s.vendorId, displayName: "Vânzător" } })),
    },
    vendor: { findUnique: async () => vendor },
    vendorBilling: { findUnique: async () => null },
    vendorPickupAddress: { findFirst: async () => pickup },
    courierAccount: {
      findMany: async () => {
        if (throwOnAccount) throw new Error("db down");
        return acc ? [acc] : [];
      },
    },
    courierAwb: { findMany: async () => awbRows },
    $queryRaw: async () => [],
    async $transaction(fn) {
      return fn(db);
    },
  };
  return db;
}

const status = (db, env = READY_ENV) => svc.getStoreSamedayStatus({ db, vendorId: "v1", serviceId: "s1", env, now: NOW });
const setOptIn = (db, enabled, env = READY_ENV) => svc.setStoreSamedayOptIn({ db, vendorId: "v1", serviceId: "s1", enabled, userId: "u1", env, now: NOW });

test("magazin eligibil: poate activa; NU e activat automat", async () => {
  const s = await status(makeDb());
  assert.equal(s.canActivate, true);
  assert.equal(s.optedIn, false);
  assert.equal(s.active, false);
  assert.deepEqual(s.reasons, []);
});

test("activare: setează samedayOptInAt / ById; idempotentă; dezactivarea le șterge", async () => {
  const db = makeDb();
  let s = await setOptIn(db, true);
  assert.equal(s.optedIn, true);
  assert.equal(s.active, true);
  assert.equal(db.stores.get("s1").samedayOptInById, "u1");
  const first = db.stores.get("s1").samedayOptInAt;
  await setOptIn(db, true);
  assert.equal(db.stores.get("s1").samedayOptInAt, first, "a doua activare nu schimbă data");
  s = await setOptIn(db, false);
  assert.equal(s.optedIn, false);
  assert.equal(db.stores.get("s1").samedayOptInAt, null);
  assert.equal(db.stores.get("s1").samedayOptInById, null);
});

test("Stripe Connect inactiv: activarea refuzată pe server, mesaj clar, magazinul neatins", async () => {
  const db = makeDb({ vendor: { ...STRIPE_OK, stripeConnectStatus: "pending" } });
  const s = await status(db);
  assert.equal(s.canActivate, false);
  assert.equal(s.stripeReady, false);
  assert.match(s.messages.join(" "), /încasările online \(Stripe\)/);
  await assert.rejects(setOptIn(db, true), (e) => e.status === 409 && e.code === "sameday_not_eligible" && e.reasons.includes("vendor_stripe_not_ready"));
  assert.equal(db.stores.get("s1").samedayOptInAt, null);
  assert.equal(db.stores.get("s1").status, "ACTIVE");
  assert.equal(db.stores.get("s1").isActive, true);
  for (const flag of ["stripeChargesEnabled", "stripePayoutsEnabled", "stripeDetailsSubmitted"]) {
    assert.equal((await status(makeDb({ vendor: { ...STRIPE_OK, [flag]: false } }))).canActivate, false, flag);
  }
});

test("adresa de ridicare lipsă / incompletă / telefon invalid -> nu se poate activa", async () => {
  assert.ok((await status(makeDb({ pickup: null }))).reasons.includes("pickup_address_not_ready"));
  assert.ok((await status(makeDb({ pickup: { ...PICKUP_OK, streetNo: "" } }))).reasons.includes("pickup_address_not_ready"));
  assert.ok((await status(makeDb({ pickup: { ...PICKUP_OK, phone: "123" } }))).reasons.includes("pickup_address_not_ready"));
});

test("magazin fără produse fizice -> nu se poate activa", async () => {
  const s = await status(makeDb({ store: { type: { code: "photography" } } }));
  assert.ok(s.reasons.includes("store_not_physical"));
});

test("restricție Admin: blochează activarea și o face inactivă; NU atinge magazinul; se poate ridica", async () => {
  const db = makeDb();
  await setOptIn(db, true);
  await svc.setStoreSamedayAdminDisabled({ db, serviceId: "s1", disabled: true, adminId: "admin1", now: NOW });
  let s = await status(db);
  assert.equal(s.disabledByArtfest, true);
  assert.equal(s.optedIn, true, "alegerea vânzătorului rămâne înregistrată");
  assert.equal(s.active, false);
  assert.equal(db.stores.get("s1").samedayDisabledById, "admin1");
  assert.equal(db.stores.get("s1").status, "ACTIVE");
  assert.equal(db.stores.get("s1").isActive, true);
  // vânzătorul poate dezactiva oricând; nu poate reactiva cât e restricționat
  await setOptIn(db, false);
  await assert.rejects(setOptIn(db, true), (e) => e.reasons.includes("store_disabled_by_artfest"));
  // ridicarea restricției
  await svc.setStoreSamedayAdminDisabled({ db, serviceId: "s1", disabled: false, adminId: "admin1", now: NOW });
  s = await status(db);
  assert.equal(s.disabledByArtfest, false);
  assert.equal(s.canActivate, true);
});

test("indisponibilitate Sameday: comutator oprit / cont nevalidat / fără AWB reușit / eroare de verificare -> inactivă, fără eroare", async () => {
  const db = makeDb();
  await setOptIn(db, true);
  for (const [label, d, env] of [
    ["comutator oprit", db, { ...READY_ENV, SAMEDAY_ARTFEST_DELIVERY_ENABLED: "" }],
    ["AWB live oprit", db, { ...READY_ENV, COURIER_AWB_LIVE_ENABLED: "false" }],
    ["cont INVALID_CREDENTIALS", Object.assign(makeDb({ account: { id: "acc", ownerType: "PLATFORM", vendorId: null, provider: "SAMEDAY", status: "INVALID_CREDENTIALS", isDefault: true, disabledAt: null, credentialsCipher: Buffer.from("x"), publicConfig: { environment: "production", pickupPointId: "1", serviceId: "7", awbVerifiedAt: "2026-11-20" } } }), {}), READY_ENV],
    ["fără AWB reușit", makeDb({ awbs: [] }), READY_ENV],
    ["eroare la verificare (fail closed)", makeDb({ throwOnAccount: true }), READY_ENV],
  ]) {
    if (d !== db) d.stores.get("s1").samedayOptInAt = NOW;
    const s = await status(d, env);
    assert.equal(s.active, false, label);
    assert.equal(s.platform.ready, false, label);
    assert.ok(s.reasons.includes("platform_not_ready"), label);
    assert.match(s.messages.join(" "), /livrarea ta obișnuită/, label);
  }
});

test("alt vânzător: 404, fără scriere", async () => {
  const db = makeDb();
  await assert.rejects(svc.getStoreSamedayStatus({ db, vendorId: "v1", serviceId: "s2", env: READY_ENV, now: NOW }), (e) => e.status === 404);
  await assert.rejects(svc.setStoreSamedayOptIn({ db, vendorId: "v1", serviceId: "s2", enabled: true, env: READY_ENV, now: NOW }), (e) => e.status === 404);
  assert.equal(db.stores.get("s2").samedayOptInAt, null);
});

test("cerere invalidă (enabled lipsă / text) -> 400", async () => {
  const db = makeDb();
  await assert.rejects(svc.setStoreSamedayOptIn({ db, vendorId: "v1", serviceId: "s1", enabled: "true", env: READY_ENV, now: NOW }), (e) => e.status === 400);
  await assert.rejects(svc.setStoreSamedayAdminDisabled({ db, serviceId: "s1", disabled: undefined }), (e) => e.status === 400);
});

test("lista Admin: magazinele cu opțiune / restricție + starea platformei", async () => {
  const db = makeDb();
  await setOptIn(db, true);
  const list = await svc.listSamedayStoresForAdmin({ db, env: READY_ENV, now: NOW });
  assert.equal(list.platform.ready, true);
  assert.deepEqual(list.stores.map((s) => [s.serviceId, s.optedIn, s.disabledByArtfest]), [["s1", true, false]]);
});

/* ---------- checkout (etapa 3): disponibilitatea pe coș ---------- */

const groupsOf = (...pairs) => pairs.map(([serviceId, vendorId]) => ({ serviceId, vendorId }));
function withVendors(db, vendors) {
  db.vendor.findMany = async ({ where }) => where.id.in.filter((id) => vendors[id]).map((id) => ({ id, ...vendors[id] }));
  return db;
}

test("checkout: comutator oprit -> nimic oferit, ZERO interogări (checkout-ul vechi neatins)", async () => {
  const touched = [];
  const db = new Proxy({}, { get: (_t, k) => touched.push(k) && undefined });
  const r = await svc.checkoutSamedayAvailability({ db, groups: groupsOf(["s1", "v1"]), env: { ...READY_ENV, SAMEDAY_ARTFEST_DELIVERY_ENABLED: "" }, now: NOW });
  assert.equal(r.offered, false);
  assert.deepEqual(r.byService, {});
  assert.deepEqual(touched, []);
  assert.equal(await svc.isArtfestSamedayOffered({ db, env: { ...READY_ENV, SAMEDAY_ARTFEST_DELIVERY_ENABLED: "" }, now: NOW }), false);
  assert.deepEqual(touched, []);
});

test("checkout: magazin cu opțiunea activă + coș plătibil integral cu cardul -> disponibil; magazin fără opt-in -> absent", async () => {
  const db = withVendors(makeDb({ store: { samedayOptInAt: NOW } }), { v1: STRIPE_OK, v2: STRIPE_OK });
  const r = await svc.checkoutSamedayAvailability({ db, groups: groupsOf(["s1", "v1"], ["s2", "v2"]), env: READY_ENV, now: NOW });
  assert.equal(r.cartCardCapable, true);
  assert.deepEqual(r.byService.s1, { offered: true, available: true, reason: null, message: null });
  assert.equal(r.byService.s2, undefined);
});

test("checkout: un vânzător din coș fără Stripe -> Sameday afișat, dar NU selectabil (cart_not_card_capable)", async () => {
  const db = withVendors(makeDb({ store: { samedayOptInAt: NOW } }), { v1: STRIPE_OK, v2: { ...STRIPE_OK, stripeConnectStatus: "pending" } });
  const r = await svc.checkoutSamedayAvailability({ db, groups: groupsOf(["s1", "v1"], ["s2", "v2"]), env: READY_ENV, now: NOW });
  assert.equal(r.cartCardCapable, false);
  assert.equal(r.byService.s1.available, false);
  assert.equal(r.byService.s1.reason, "cart_not_card_capable");
});

test("checkout: restricție Artfest / cont Artfest nevalidat / eroare DB -> nimic disponibil (fail closed)", async () => {
  const restricted = withVendors(makeDb({ store: { samedayOptInAt: NOW, samedayDisabledAt: NOW } }), { v1: STRIPE_OK });
  assert.equal((await svc.checkoutSamedayAvailability({ db: restricted, groups: groupsOf(["s1", "v1"]), env: READY_ENV, now: NOW })).byService.s1, undefined);
  const notVerified = withVendors(makeDb({ store: { samedayOptInAt: NOW }, awbs: [] }), { v1: STRIPE_OK });
  const r = await svc.checkoutSamedayAvailability({ db: notVerified, groups: groupsOf(["s1", "v1"]), env: READY_ENV, now: NOW });
  assert.equal(r.offered, false);
  const down = withVendors(makeDb({ store: { samedayOptInAt: NOW }, throwOnAccount: true }), { v1: STRIPE_OK });
  assert.equal((await svc.checkoutSamedayAvailability({ db: down, groups: groupsOf(["s1", "v1"]), env: READY_ENV, now: NOW })).offered, false);
  assert.equal(await svc.isArtfestSamedayOffered({ db: down, env: READY_ENV, now: NOW }), false);
  assert.equal(await svc.isArtfestSamedayOffered({ db: makeDb(), env: READY_ENV, now: NOW }), true);
});

test("checkout: vechiul SAMEDAY_CHECKOUT_ENABLED=on NU ocolește comutatorul nou / opt-in-ul", async () => {
  const touched = [];
  const db = new Proxy({}, { get: (_t, k) => touched.push(k) && undefined });
  const env = { ...READY_ENV, SAMEDAY_ARTFEST_DELIVERY_ENABLED: "", SAMEDAY_CHECKOUT_ENABLED: "on", SAMEDAY_NOMENCLATOR_ENABLED: "true" };
  const r = await svc.checkoutSamedayAvailability({ db, groups: groupsOf(["s1", "v1"]), env, now: NOW });
  assert.equal(r.offered, false);
  assert.deepEqual(touched, []);
  // valori „aproape adevărate” nu pornesc Sameday prin Artfest
  for (const v of ["1", "yes", "on", "TRUE "]) {
    const x = await svc.checkoutSamedayAvailability({ db, groups: groupsOf(["s1", "v1"]), env: { ...READY_ENV, SAMEDAY_ARTFEST_DELIVERY_ENABLED: v }, now: NOW });
    if (v.trim().toLowerCase() !== "true") assert.equal(x.offered, false, v);
  }
});
