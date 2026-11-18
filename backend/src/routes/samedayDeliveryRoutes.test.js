// Rutele „Livrare Sameday prin Artfest” (vânzător + Admin), prin HTTP real (express):
// validare pe server la activare (o cerere modificată manual nu ocolește eligibilitatea),
// doar magazinele proprii, Admin cu rol ADMIN, restricția nu atinge magazinul,
// montarea pe /api/vendor nu cere autentificare pentru alte rute.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/samedayDeliveryRoutes.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";
process.env.SAMEDAY_ARTFEST_DELIVERY_ENABLED = "true";
process.env.COURIER_INTEGRATION_ENABLED = "1";
process.env.COURIER_AWB_LIVE_ENABLED = "true";
process.env.SAMEDAY_ACTIVE_ENVIRONMENT = "production";
process.env.NODE_ENV = "production";

import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

const state = {};
function reset({ stripeOk = true, platformOk = true } = {}) {
  state.stores = new Map([
    ["s1", { id: "s1", vendorId: "v1", title: "M1", status: "ACTIVE", isActive: true, type: { code: "products" }, samedayOptInAt: null, samedayOptInById: null, samedayDisabledAt: null, samedayDisabledById: null }],
    ["s2", { id: "s2", vendorId: "v2", title: "M2", status: "ACTIVE", isActive: true, type: { code: "products" }, samedayOptInAt: null, samedayOptInById: null, samedayDisabledAt: null, samedayDisabledById: null }],
  ]);
  state.vendors = new Map([
    ["v1", { id: "v1", userId: "u1", stripeAccountId: "acct_1", stripeChargesEnabled: stripeOk, stripePayoutsEnabled: true, stripeDetailsSubmitted: true, stripeConnectStatus: "enabled" }],
    ["v2", { id: "v2", userId: "u2", stripeAccountId: "acct_2", stripeChargesEnabled: true, stripePayoutsEnabled: true, stripeDetailsSubmitted: true, stripeConnectStatus: "enabled" }],
  ]);
  state.platformOk = platformOk;
}
const pick = (s, select) => (select ? Object.fromEntries(Object.keys(select).filter((k) => k in s).map((k) => [k, s[k]])) : { ...s });
const db = {
  vendorService: {
    findFirst: async ({ where, select }) => {
      const s = state.stores.get(where.id);
      return s && s.vendorId === where.vendorId ? pick(s, select) : null;
    },
    findUnique: async ({ where, select }) => (state.stores.get(where.id) ? pick(state.stores.get(where.id), select) : null),
    update: async ({ where, data }) => Object.assign(state.stores.get(where.id), data),
    findMany: async () => [...state.stores.values()].filter((s) => s.samedayOptInAt || s.samedayDisabledAt).map((s) => ({ ...s, vendor: { displayName: "V" } })),
  },
  vendor: {
    findUnique: async ({ where }) => (where.userId ? [...state.vendors.values()].find((v) => v.userId === where.userId) || null : state.vendors.get(where.id) || null),
  },
  vendorBilling: { findUnique: async () => null },
  vendorPickupAddress: {
    findFirst: async () => ({ id: "pa", contactName: "Ion Pop", phone: "0722123456", county: "Buzău", city: "Buzău", street: "Str. A", streetNo: "1", postalCode: null }),
  },
  courierAccount: {
    findMany: async () => [
      { id: "acc", ownerType: "PLATFORM", vendorId: null, provider: "SAMEDAY", status: "ACTIVE", isDefault: true, disabledAt: null, credentialsCipher: Buffer.from("x"), publicConfig: { environment: "production", pickupPointId: "513381", serviceId: "7", awbVerifiedAt: "2026-11-20T08:00:00Z" } },
    ],
  },
  courierAwb: {
    findMany: async () => (state.platformOk ? [{ status: "CREATED", awbNumber: "1ONB1", createdAt: new Date("2026-11-20T09:00:00Z"), providerMeta: { environment: "production" } }] : []),
  },
  $queryRaw: async () => [],
  async $transaction(fn) {
    return fn(db);
  },
};

let server;
let base;
before(async () => {
  mock.module("../db.js", { namedExports: { prisma: db } });
  mock.module("../api/auth.js", {
    namedExports: {
      authRequired(req, res, next) {
        const id = req.headers["x-test-user"];
        if (!id) return res.status(401).json({ error: "unauthenticated" });
        req.user = { sub: id, role: req.headers["x-test-role"] || "VENDOR" };
        next();
      },
      enforceTokenVersion: (_req, _res, next) => next(),
      requireRole: (...roles) => (req, res, next) => (roles.includes(req.user?.role) ? next() : res.status(403).json({ error: "forbidden" })),
      optionalAuth: (_req, _res, next) => next(),
    },
  });
  const vendorRoutes = (await import("./vendorSamedayDeliveryRoutes.js")).default;
  const adminRoutes = (await import("./adminSamedayDeliveryRoutes.js")).default;
  const app = express();
  app.use(express.json());
  app.use("/api/vendor", vendorRoutes);
  // o rută publică montată DUPĂ, pe același prefix: nu trebuie să ceară autentificare
  app.get("/api/vendor/public-check", (_req, res) => res.json({ ok: true }));
  app.use("/api/admin/sameday-delivery", adminRoutes);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));
beforeEach(() => reset());

async function call(method, path, { user, role, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (user) headers["x-test-user"] = user;
  if (role) headers["x-test-role"] = role;
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}
const V = "/api/vendor/stores/s1/sameday-delivery";

test("vânzător eligibil: GET -> poate activa; PUT enabled=true -> activ", async () => {
  let r = await call("GET", V, { user: "u1" });
  assert.equal(r.status, 200);
  assert.equal(r.body.sameday.canActivate, true);
  assert.equal(r.body.sameday.optedIn, false);
  r = await call("PUT", V, { user: "u1", body: { enabled: true } });
  assert.equal(r.status, 200);
  assert.equal(r.body.sameday.active, true);
  assert.ok(state.stores.get("s1").samedayOptInAt);
});

test("cerere API manuală fără eligibilitate (Stripe inactiv) -> 409, nimic scris", async () => {
  reset({ stripeOk: false });
  const r = await call("PUT", V, { user: "u1", body: { enabled: true } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "sameday_not_eligible");
  assert.ok(r.body.reasons.includes("vendor_stripe_not_ready"));
  assert.equal(state.stores.get("s1").samedayOptInAt, null);
});

test("platformă indisponibilă -> activarea refuzată (409), dezactivarea permisă", async () => {
  reset({ platformOk: false });
  state.stores.get("s1").samedayOptInAt = new Date();
  let r = await call("GET", V, { user: "u1" });
  assert.equal(r.body.sameday.active, false);
  r = await call("PUT", V, { user: "u1", body: { enabled: false } });
  assert.equal(r.status, 200);
  assert.equal(state.stores.get("s1").samedayOptInAt, null);
  r = await call("PUT", V, { user: "u1", body: { enabled: true } });
  assert.equal(r.status, 409);
});

test("magazinul altui vânzător -> 404; fără autentificare -> 401", async () => {
  assert.equal((await call("GET", "/api/vendor/stores/s2/sameday-delivery", { user: "u1" })).status, 404);
  assert.equal((await call("PUT", "/api/vendor/stores/s2/sameday-delivery", { user: "u1", body: { enabled: true } })).status, 404);
  assert.equal(state.stores.get("s2").samedayOptInAt, null);
  assert.equal((await call("GET", V)).status, 401);
});

test("montarea pe /api/vendor NU cere autentificare pentru alte rute de pe același prefix", async () => {
  const r = await call("GET", "/api/vendor/public-check");
  assert.equal(r.status, 200);
});

test("Admin: rol ADMIN obligatoriu; restricția blochează Sameday fără să atingă magazinul", async () => {
  assert.equal((await call("PUT", "/api/admin/sameday-delivery/stores/s1", { user: "u1", body: { disabled: true } })).status, 403);
  await call("PUT", V, { user: "u1", body: { enabled: true } });
  const r = await call("PUT", "/api/admin/sameday-delivery/stores/s1", { user: "admin", role: "ADMIN", body: { disabled: true } });
  assert.equal(r.status, 200);
  const s = state.stores.get("s1");
  assert.ok(s.samedayDisabledAt);
  assert.equal(s.samedayDisabledById, "admin");
  assert.equal(s.status, "ACTIVE");
  assert.equal(s.isActive, true);
  const vendorView = await call("GET", V, { user: "u1" });
  assert.equal(vendorView.body.sameday.active, false);
  assert.equal(vendorView.body.sameday.disabledByArtfest, true);
  const list = await call("GET", "/api/admin/sameday-delivery/stores", { user: "admin", role: "ADMIN" });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.stores.map((x) => [x.serviceId, x.optedIn, x.disabledByArtfest]), [["s1", true, true]]);
});
