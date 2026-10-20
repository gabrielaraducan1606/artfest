// Teste: cine se poate înscrie / poate fi aprobat la Târgul Artfest, după starea magazinului.
//   activ => da; pus pe pauză de vendor, cu profil valid => da; niciodată activat => trebuie activat;
//   dezactivat administrativ / cont suspendat / blocat / colaborare încetată => nu.
// Înscrierile existente NU se anulează automat. Rutele reale; DB in-memory, auth pe header.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/artfestFairEligibility.routes.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";
process.env.JWT_SECRET = "test-secret";

import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import { createFakePrisma } from "../testkit/fakePrisma.js";

let fake;

mock.module("../db.js", {
  namedExports: { prisma: new Proxy({}, { get: (_t, key) => fake[key] }) },
});

mock.module("../api/auth.js", {
  namedExports: {
    authRequired(req, res, next) {
      const sub = req.headers["x-test-user"];
      if (!sub) return res.status(401).json({ error: "unauthorized" });
      req.user = { sub };
      next();
    },
  },
});

mock.module("../lib/mailer.js", {
  namedExports: {
    artfestFairInviteTemplate: (k) => `artfest_fair_invite:${k}`,
    async sendArtfestFairInviteEmail() {
      throw new Error("fără emailuri în aceste teste");
    },
  },
});

let server;
let base;
let ctx;
let elig;

before(async () => {
  elig = await import("../services/artfestFairEligibility.js");
  const app = express();
  app.use(express.json());
  app.use("/api/vendor/artfest-fair", (await import("./vendorArtfestFairRoutes.js")).default);
  app.use("/api/admin/artfest-fair", (await import("./adminArtfestFairRoutes.js")).default);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((r) => server.close(r)));

const PROFILE = (i) => ({ displayName: `Magazin ${i}`, slug: `magazin-${i}`, logoUrl: `https://cdn.test/${i}.png` });

beforeEach(() => {
  fake = createFakePrisma();
  const U = (email, extra = {}) => ({ email, role: "VENDOR", status: "ACTIVE", locked: false, ...extra });
  const users = fake.seed("user", [
    U("activ@t.ro"), // 0 magazin activ
    U("pauza@t.ro"), // 1 pus pe pauză de vendor, profil valid
    U("pauza-incomplet@t.ro"), // 2 pauză, fără logo
    U("neactivat@t.ro"), // 3 niciodată activat (doar ciornă)
    U("dezactivat@t.ro"), // 4 dezactivat de Admin
    U("suspendat@t.ro", { status: "SUSPENDED" }), // 5
    U("blocat@t.ro", { locked: true }), // 6
    U("incetat@t.ro"), // 7 colaborare în preaviz
    U("fara-servicii@t.ro"), // 8 vendor activ, dar fără niciun magazin
    { email: "adm@t.ro", role: "ADMIN", status: "ACTIVE", locked: false }, // 9
  ]);
  const V = (i, extra = {}) => ({
    userId: users[i].id, displayName: `Vendor ${i}`, isActive: true,
    anonymizedAt: null, terminationNoticeAt: null, terminationFinalizedAt: null, ...extra,
  });
  const vendors = fake.seed("vendor", [
    V(0), V(1), V(2), V(3, { isActive: false }), V(4, { isActive: false }), V(5), V(6), V(7, { terminationNoticeAt: new Date() }), V(8),
  ]);
  const S = (i, status) => ({ vendorId: vendors[i].id, title: `S${i}`, status, isActive: status === "ACTIVE" });
  const services = fake.seed("vendorService", [
    S(0, "ACTIVE"), S(1, "INACTIVE"), S(2, "INACTIVE"), S(3, "DRAFT"), S(4, "ACTIVE"), S(5, "ACTIVE"), S(6, "ACTIVE"), S(7, "ACTIVE"),
  ]);
  fake.seed("serviceProfile", services.map((s, i) => ({ serviceId: s.id, ...PROFILE(i), ...(i === 2 ? { logoUrl: null } : {}) })));
  fake.seed("artfestFair", [
    { key: "CHRISTMAS_FAIR_BUZAU_2026", title: "Târg", registrationOpen: true, termsVersion: "1.1.0", termsUrl: "/targ-artfest/regulament/v1.1.0" },
  ]);
  ctx = { users, vendors, admin: users[9] };
});

async function call(method, path, { as, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (as) headers["x-test-user"] = as.id;
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const form = {
  participationType: "PARTICIPARE_LA_DISTANTA", contactName: "Ana Pop", contactPhone: "0722000111", contactEmail: "ana@t.ro",
  productTypes: ["ceramică"], estimatedProductCount: 5, termsAccepted: true, termsVersion: "1.1.0",
};
const register = (i) => call("POST", "/api/vendor/artfest-fair/registration", { as: ctx.users[i], body: form });
const state = (i) => call("GET", "/api/vendor/artfest-fair", { as: ctx.users[i] });
const registrations = () => fake.tables.artfestFairRegistration;

test("regula (unitar): activ / pauză / neactivat / dezactivat / restricționat / încetat", () => {
  const user = { status: "ACTIVE", locked: false };
  const v = (extra = {}) => ({ isActive: true, anonymizedAt: null, terminationNoticeAt: null, terminationFinalizedAt: null, user, ...extra });
  const ok = { displayName: "M", slug: "m", logoUrl: "l" };
  const e = (vendor, services) => elig.evaluateFairEligibility(vendor, services);

  assert.deepEqual([e(v(), [{ status: "ACTIVE", profile: ok }]).eligible, e(v(), [{ status: "ACTIVE", profile: ok }]).storeState], [true, "active"]);
  assert.deepEqual([e(v(), [{ status: "INACTIVE", profile: ok }]).eligible, e(v(), [{ status: "INACTIVE", profile: ok }]).storeState], [true, "paused"]);
  assert.equal(e(v(), [{ status: "INACTIVE", profile: { ...ok, logoUrl: "" } }]).reason, "profile_incomplete");
  assert.equal(e(v({ isActive: false }), [{ status: "DRAFT", profile: ok }]).reason, "store_not_activated");
  assert.equal(e(v({ isActive: false }), []).reason, "store_not_activated");
  assert.equal(e(v(), []).reason, "store_not_activated");
  assert.equal(e(v({ isActive: false }), [{ status: "ACTIVE", profile: ok }]).reason, "store_deactivated");
  assert.equal(e(v({ isActive: false }), [{ status: "INACTIVE", profile: ok }]).reason, "store_deactivated");
  assert.equal(e(v({ user: { status: "SUSPENDED", locked: false } }), [{ status: "ACTIVE", profile: ok }]).reason, "account_restricted");
  assert.equal(e(v({ user: { status: "DELETED", locked: false } }), [{ status: "ACTIVE", profile: ok }]).reason, "account_restricted");
  assert.equal(e(v({ user: { status: "ACTIVE", locked: true } }), [{ status: "ACTIVE", profile: ok }]).reason, "account_restricted");
  assert.equal(e(v({ terminationFinalizedAt: new Date() }), [{ status: "ACTIVE", profile: ok }]).reason, "collaboration_ended");
  assert.equal(e(v({ anonymizedAt: new Date() }), [{ status: "ACTIVE", profile: ok }]).reason, "collaboration_ended");
  assert.equal(e(null, []).reason, "vendor_missing");
});

test("înscriere: activ și pauză (profil valid) => acceptată; ceilalți => 409 cu motivul, nimic salvat", async () => {
  const expected = [
    [0, 201, null],
    [1, 201, null],
    [2, 409, "profile_incomplete"],
    [3, 409, "store_not_activated"],
    [4, 409, "store_deactivated"],
    [5, 409, "account_restricted"],
    [6, 409, "account_restricted"],
    [7, 409, "collaboration_ended"],
    [8, 409, "store_not_activated"],
  ];
  for (const [i, status, reason] of expected) {
    const res = await register(i);
    assert.equal(res.status, status, `vendor ${i}`);
    if (reason) {
      assert.equal(res.body.error, reason, `vendor ${i}`);
      assert.ok(res.body.message.length > 10);
    }
  }
  assert.deepEqual(registrations().map((r) => r.vendorId).sort(), [ctx.vendors[0].id, ctx.vendors[1].id].sort());
});

test("pagina vendorului: butonul de înscriere doar pentru eligibili; motivul fără detalii interne", async () => {
  const active = await state(0);
  assert.equal(active.body.actions.canRegister, true);
  assert.deepEqual(active.body.eligibility, { eligible: true, reason: null, message: null, storeState: "active" });

  const paused = await state(1);
  assert.equal(paused.body.actions.canRegister, true);
  assert.equal(paused.body.eligibility.storeState, "paused");

  const notActivated = await state(3);
  assert.equal(notActivated.body.actions.canRegister, false);
  assert.equal(notActivated.body.eligibility.reason, "store_not_activated");
  assert.match(notActivated.body.eligibility.message, /Finalizează mai întâi activarea magazinului/);

  const deactivated = await state(4);
  assert.equal(deactivated.body.actions.canRegister, false);
  assert.equal(deactivated.body.eligibility.reason, "store_deactivated");
  assert.equal(JSON.stringify(deactivated.body).includes("adminLabel"), false);
});

test("Admin: aprobarea e blocată pentru un magazin devenit neeligibil; înscrierea NU se anulează automat", async () => {
  assert.equal((await register(0)).status, 201);
  assert.equal((await register(1)).status, 201);
  const [rActive, rPaused] = registrations();

  // după înscriere, Adminul dezactivează magazinul vendorului 0
  fake.tables.vendor.find((v) => v.id === ctx.vendors[0].id).isActive = false;

  const list = await call("GET", "/api/admin/artfest-fair/registrations", { as: ctx.admin });
  const item = list.body.items.find((i) => i.id === rActive.id);
  assert.deepEqual(item.storeEligibility, { eligible: false, reason: "store_deactivated", label: "Magazin dezactivat administrativ", storeState: "deactivated" });
  assert.equal(item.actions.canApprove, false);
  assert.equal(item.status, "SUBMITTED"); // nimic anulat automat
  assert.equal(list.body.items.find((i) => i.id === rPaused.id).storeEligibility.storeState, "paused");

  const blocked = await call("POST", `/api/admin/artfest-fair/registrations/${rActive.id}/approve`, { as: ctx.admin });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, "vendor_not_eligible");
  assert.match(blocked.body.message, /magazin dezactivat administrativ/);
  assert.equal(registrations().find((r) => r.id === rActive.id).status, "SUBMITTED");

  // respingerea rămâne posibilă; magazinul pus pe pauză se aprobă normal
  assert.equal((await call("POST", `/api/admin/artfest-fair/registrations/${rActive.id}/reject`, { as: ctx.admin, body: {} })).status, 200);
  assert.equal((await call("POST", `/api/admin/artfest-fair/registrations/${rPaused.id}/approve`, { as: ctx.admin })).status, 200);
  assert.equal(registrations().find((r) => r.id === rPaused.id).status, "APPROVED");

  // o participare deja aprobată rămâne aprobată dacă magazinul devine neeligibil (decizia rămâne la Admin)
  fake.tables.vendor.find((v) => v.id === ctx.vendors[1].id).isActive = false;
  const after = await call("GET", `/api/admin/artfest-fair/registrations/${rPaused.id}`, { as: ctx.admin });
  assert.equal(after.body.item.status, "APPROVED");
  assert.equal(after.body.item.storeEligibility.eligible, false);
  assert.equal(after.body.item.actions.canCancel, true);
});
