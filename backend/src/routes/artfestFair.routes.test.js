// Teste pentru Târgul de Crăciun Artfest: înscrierea vendorului, Admin
// (aprobare / respingere) și invitația idempotentă (notificare + email
// separate). Rutele reale; mock-uri doar pe DB in-memory, auth pe header și
// mailer (fără emailuri reale).
//
// Rulare: node --experimental-test-module-mocks --test src/routes/artfestFair.routes.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";
process.env.JWT_SECRET = "test-secret";

import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import { createFakePrisma } from "../testkit/fakePrisma.js";

let fake;
const sentEmails = [];
const failingEmails = new Set();

mock.module("../db.js", {
  namedExports: {
    prisma: new Proxy({}, { get: (_target, key) => fake[key] }),
  },
});

mock.module("../api/auth.js", {
  namedExports: {
    authRequired(req, res, next) {
      const sub = req.headers["x-test-user"];
      if (!sub) return res.status(401).json({ error: "unauthorized" });
      req.user = { sub, role: req.headers["x-test-role"] || "USER" };
      next();
    },
  },
});

// ca sendMailLogged: EmailLog + eșec simulat pentru adresele din failingEmails
mock.module("../lib/mailer.js", {
  namedExports: {
    artfestFairInviteTemplate(campaignKey) {
      return `artfest_fair_invite:${campaignKey}`;
    },
    async sendArtfestFairInviteEmail(payload) {
      const failed = failingEmails.has(payload.to);
      await fake.emailLog.create({
        data: {
          toEmail: payload.to,
          userId: payload.userId,
          template: `artfest_fair_invite:${payload.campaignKey}`,
          status: failed ? "FAILED" : "SENT",
          sentAt: failed ? null : new Date(),
          subject: "Te invităm la Târgul de Crăciun Artfest 🎄",
          senderKey: "noreply",
        },
      });
      if (failed) throw new Error("smtp_down");
      sentEmails.push(payload);
      return { messageId: `m_${sentEmails.length}` };
    },
  },
});

const CAMPAIGN = "CHRISTMAS_FAIR_BUZAU_2026_INVITE";

let server;
let base;
let ctx;
let invite;

before(async () => {
  const vendorRoutes = (await import("./vendorArtfestFairRoutes.js")).default;
  const adminRoutes = (await import("./adminArtfestFairRoutes.js")).default;
  invite = await import("../services/artfestFairInviteService.js");

  const app = express();
  app.use(express.json());
  app.use("/api/vendor/artfest-fair", vendorRoutes);
  app.use("/api/admin/artfest-fair", adminRoutes);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const activeVendor = { isActive: true, anonymizedAt: null, terminationNoticeAt: null, terminationFinalizedAt: null };

beforeEach(() => {
  sentEmails.length = 0;
  failingEmails.clear();
  fake = createFakePrisma();

  const users = fake.seed("user", [
    { email: "v1@t.ro", role: "VENDOR", status: "ACTIVE", locked: false, firstName: "Ana", lastName: "Pop" },
    { email: "v2@t.ro", role: "VENDOR", status: "ACTIVE", locked: false },
    { email: "v3@t.ro", role: "VENDOR", status: "ACTIVE", locked: false },
    { email: "u1@t.ro", role: "USER", status: "ACTIVE", locked: false },
    { email: "adm@t.ro", role: "ADMIN", status: "ACTIVE", locked: false },
  ]);
  const [v1, v2, v3, u1, admin] = users;

  const [vendor1, vendor2, vendor3] = fake.seed("vendor", [
    { userId: v1.id, displayName: "Atelier 1", email: "Atelier1@T.ro", phone: "0722000111", ...activeVendor },
    { userId: v2.id, displayName: "Atelier 2", email: null, ...activeVendor },
    { userId: v3.id, displayName: "Atelier 3", email: "a3@t.ro", ...activeVendor },
  ]);

  // magazine activate (înscrierea la târg cere magazin activ / pe pauză, cu profil valid)
  const [service1, service2, service3] = fake.seed("vendorService", [
    { vendorId: vendor1.id, title: "Serviciu 1", status: "ACTIVE", isActive: true },
    { vendorId: vendor2.id, title: "Serviciu 2", status: "ACTIVE", isActive: true },
    { vendorId: vendor3.id, title: "Serviciu 3", status: "ACTIVE", isActive: true },
  ]);
  fake.seed("serviceProfile", [
    { serviceId: service1.id, displayName: "Magazin Ana", slug: "magazin-ana", logoUrl: "https://cdn.test/l1.png" },
    { serviceId: service2.id, displayName: "Atelier 2", slug: "atelier-2", logoUrl: "https://cdn.test/l2.png" },
    { serviceId: service3.id, displayName: "Atelier 3", slug: "atelier-3", logoUrl: "https://cdn.test/l3.png" },
  ]);

  ctx = { v1, v2, v3, u1, admin, vendor1, vendor2, vendor3 };
});

async function call(method, path, { as, body, headers: extra } = {}) {
  const headers = { "content-type": "application/json", ...(extra || {}) };
  if (as) {
    headers["x-test-user"] = as.id;
    headers["x-test-role"] = as.role;
  }
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const validForm = (extra = {}) => ({
  participationType: "PARTICIPARE_FIZICA",
  contactName: "Ana Pop",
  contactPhone: "0722 000 111",
  contactEmail: "Ana@Example.ro",
  productTypes: ["ceramică", "Ceramică", "lumânări"],
  estimatedProductCount: 25,
  notes: "Am nevoie de priză.",
  termsAccepted: true,
  ...extra,
});

// leagă de târg o versiune publicată a regulamentului (ca scripts/linkFairTerms.mjs)
async function linkTerms(version = "1.1.0") {
  if (!fake.tables.artfestFair?.length) await call("GET", "/api/vendor/artfest-fair", { as: ctx.v3 });
  const fair = fake.tables.artfestFair[0];
  fair.termsVersion = version;
  fair.termsUrl = `/targ-artfest/regulament/v${version}`;
  return fair;
}

// înscriere ca din formular: regulamentul legat (dacă lipsește) + versiunea afișată și bifată
const register = async (user, extra) => {
  if (!fake.tables.artfestFair?.[0]?.termsVersion) await linkTerms();
  return call("POST", "/api/vendor/artfest-fair/registration", {
    as: user,
    body: validForm({ termsVersion: fake.tables.artfestFair[0].termsVersion, ...extra }),
  });
};

const registrations = () => fake.tables.artfestFairRegistration;

/* ============================== auth ============================== */

test("auth: fără sesiune 401; cont fără vendor 403; vendor nu are acces la Admin", async () => {
  assert.equal((await call("GET", "/api/vendor/artfest-fair")).status, 401);
  assert.equal((await call("GET", "/api/admin/artfest-fair/registrations")).status, 401);

  const asUser = await call("GET", "/api/vendor/artfest-fair", { as: ctx.u1 });
  assert.equal(asUser.status, 403);
  assert.equal(asUser.body.error, "vendor_only");

  // rolul se verifică în DB, nu în header
  for (const [method, path] of [
    ["GET", "/api/admin/artfest-fair/registrations"],
    ["GET", "/api/admin/artfest-fair/invite/preview"],
    ["POST", "/api/admin/artfest-fair/invite/send"],
    ["POST", "/api/admin/artfest-fair/registrations/x/approve"],
  ]) {
    const res = await call(method, path, {
      as: { id: ctx.v1.id, role: "ADMIN" },
      body: method === "GET" ? undefined : { confirm: CAMPAIGN },
    });
    assert.equal(res.status, 403, `${method} ${path}`);
  }
  assert.equal(fake.tables.notification.length, 0);
  assert.equal(sentEmails.length, 0);
});

/* ============================== vendor ============================== */

test("vendor: starea inițială creează târgul și precompletează contactul", async () => {
  const res = await call("GET", "/api/vendor/artfest-fair", { as: ctx.v1 });
  assert.equal(res.status, 200);
  assert.equal(res.body.fair.key, "CHRISTMAS_FAIR_BUZAU_2026");
  assert.equal(res.body.fair.title, "Târgul de Crăciun Artfest – Buzău");
  assert.equal(res.body.fair.termsVersion, null);
  assert.equal(res.body.registration, null);
  // fără regulament publicat și legat nu există ce accepta => înscrierea nu e disponibilă
  assert.deepEqual(res.body.actions, { canRegister: false, canWithdraw: false });
  await linkTerms();
  const linked = await call("GET", "/api/vendor/artfest-fair", { as: ctx.v1 });
  assert.deepEqual(linked.body.actions, { canRegister: true, canWithdraw: false });
  assert.equal(linked.body.fair.termsUrl, "/targ-artfest/regulament/v1.1.0");
  assert.equal(res.body.prefill.contactName, "Ana Pop");
  assert.equal(res.body.prefill.contactPhone, "0722000111");
  assert.equal(res.body.prefill.contactEmail, "Atelier1@T.ro");

  // al doilea GET nu creează alt târg
  await call("GET", "/api/vendor/artfest-fair", { as: ctx.v2 });
  assert.equal(fake.tables.artfestFair.length, 1);
});

test("vendor: înscriere -> SUBMITTED, vendorId doar din sesiune, acceptarea condițiilor salvată", async () => {
  const res = await register(ctx.v1, { vendorId: ctx.vendor2.id, status: "APPROVED" });
  assert.equal(res.status, 201);
  assert.equal(res.body.message, "Înscrierea ta a fost trimisă. Te vom anunța după verificare.");
  assert.equal(res.body.registration.status, "SUBMITTED");

  assert.equal(registrations().length, 1);
  const row = registrations()[0];
  assert.equal(row.vendorId, ctx.vendor1.id);
  assert.equal(row.submittedByUserId, ctx.v1.id);
  assert.equal(row.status, "SUBMITTED");
  assert.equal(row.contactEmail, "ana@example.ro");
  assert.deepEqual(row.productTypes, ["ceramică", "lumânări"]);
  assert.equal(row.estimatedProductCount, 25);
  assert.ok(row.termsAcceptedAt instanceof Date);
  assert.equal(row.termsVersion, "1.1.0");
  assert.match(row.termsIp, /127.0.0.1/);
  assert.ok(row.termsUa);

  // răspunsul către vendor nu conține IP/UA sau motivul intern
  assert.equal("termsIp" in res.body.registration, false);
  assert.equal("rejectionReason" in res.body.registration, false);

  const state = await call("GET", "/api/vendor/artfest-fair", { as: ctx.v1 });
  assert.deepEqual(state.body.actions, { canRegister: false, canWithdraw: true });
  assert.equal(state.body.prefill, null);
});

test("vendor: validare - câmpuri lipsă și condiții neacceptate => 400, nimic salvat", async () => {
  const res = await call("POST", "/api/vendor/artfest-fair/registration", {
    as: ctx.v1,
    body: {
      participationType: "ALTCEVA",
      contactName: "",
      contactPhone: "abc",
      contactEmail: "nu-e-email",
      productTypes: [],
      estimatedProductCount: 0,
    },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "invalid_registration");
  for (const field of [
    "participationType",
    "contactName",
    "contactPhone",
    "contactEmail",
    "productTypes",
    "estimatedProductCount",
    "termsAccepted",
  ]) {
    assert.ok(res.body.fields[field], field);
  }

  const noTerms = await register(ctx.v1, { termsAccepted: "true" });
  assert.equal(noTerms.status, 400);
  assert.ok(noTerms.body.fields.termsAccepted);
  assert.equal(registrations().length, 0);
});

test("vendor: înscriere duplicată => 409, o singură înregistrare (și la submit simultan)", async () => {
  const [a, b] = await Promise.all([register(ctx.v1), register(ctx.v1)]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);

  const again = await register(ctx.v1);
  assert.equal(again.status, 409);
  assert.equal(again.body.error, "already_registered");
  assert.equal(registrations().length, 1);
});

test("vendor: retragere -> WITHDRAWN; reînscriere pe aceeași înregistrare", async () => {
  await register(ctx.v1);
  const original = { ...registrations()[0] };

  const withdrawn = await call("POST", "/api/vendor/artfest-fair/registration/withdraw", { as: ctx.v1 });
  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.body.registration.status, "WITHDRAWN");
  assert.ok(registrations()[0].withdrawnAt instanceof Date);

  const state = await call("GET", "/api/vendor/artfest-fair", { as: ctx.v1 });
  assert.deepEqual(state.body.actions, { canRegister: true, canWithdraw: false });

  const twice = await call("POST", "/api/vendor/artfest-fair/registration/withdraw", { as: ctx.v1 });
  assert.equal(twice.status, 409);

  await new Promise((resolve) => setTimeout(resolve, 5));
  const again = await register(ctx.v1, { participationType: "PARTICIPARE_LA_DISTANTA", estimatedProductCount: 10 });
  assert.equal(again.status, 201);
  assert.equal(registrations().length, 1);

  const row = registrations()[0];
  assert.equal(row.id, original.id);
  assert.equal(row.status, "SUBMITTED");
  assert.equal(row.withdrawnAt, null);
  assert.equal(row.participationType, "PARTICIPARE_LA_DISTANTA");
  assert.equal(row.estimatedProductCount, 10);
  assert.ok(row.submittedAt.getTime() > original.submittedAt.getTime());
});

test("vendor: după REJECTED nu se poate reînscrie; motivul intern nu ajunge la vendor", async () => {
  await register(ctx.v1);
  const id = registrations()[0].id;

  const rejected = await call("POST", `/api/admin/artfest-fair/registrations/${id}/reject`, {
    as: ctx.admin,
    body: { reason: "Produse în afara tematicii" },
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.item.status, "REJECTED");
  assert.equal(rejected.body.item.rejectionReason, "Produse în afara tematicii");

  const state = await call("GET", "/api/vendor/artfest-fair", { as: ctx.v1 });
  assert.equal(state.body.registration.status, "REJECTED");
  assert.equal("rejectionReason" in state.body.registration, false);
  assert.deepEqual(state.body.actions, { canRegister: false, canWithdraw: false });

  const again = await register(ctx.v1);
  assert.equal(again.status, 409);
  assert.equal(again.body.error, "registration_rejected");
  assert.equal(registrations()[0].status, "REJECTED");
});

test("cross-vendor: un vendor nu vede și nu retrage înscrierea altuia", async () => {
  await register(ctx.v1);

  const other = await call("GET", "/api/vendor/artfest-fair", { as: ctx.v2 });
  assert.equal(other.body.registration, null);

  const withdraw = await call("POST", "/api/vendor/artfest-fair/registration/withdraw", { as: ctx.v2 });
  assert.equal(withdraw.status, 404);
  assert.equal(registrations()[0].status, "SUBMITTED");

  // înscrierea vendorului 2 e separată, chiar dacă trimite vendorId-ul primului
  const own = await register(ctx.v2, { vendorId: ctx.vendor1.id });
  assert.equal(own.status, 201);
  assert.deepEqual(
    registrations().map((r) => r.vendorId).sort(),
    [ctx.vendor1.id, ctx.vendor2.id].sort()
  );
});

/* ============================== admin ============================== */

test("admin: listă cu vendor/magazin, filtre, aprobare și tranziții invalide", async () => {
  await register(ctx.v1);
  await register(ctx.v2, { participationType: "PARTICIPARE_LA_DISTANTA" });
  const [r1, r2] = registrations();

  const list = await call("GET", "/api/admin/artfest-fair/registrations", { as: ctx.admin });
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 2);
  const item1 = list.body.items.find((i) => i.id === r1.id);
  assert.equal(item1.vendorName, "Atelier 1");
  assert.deepEqual(item1.stores, [{ name: "Magazin Ana", slug: "magazin-ana" }]);
  assert.equal(item1.contactPhone, "0722 000 111");
  assert.equal(item1.estimatedProductCount, 25);
  assert.equal(list.body.counts.SUBMITTED, 2);

  const remote = await call(
    "GET",
    "/api/admin/artfest-fair/registrations?participationType=PARTICIPARE_LA_DISTANTA",
    { as: ctx.admin }
  );
  assert.deepEqual(remote.body.items.map((i) => i.id), [r2.id]);

  const approved = await call("POST", `/api/admin/artfest-fair/registrations/${r1.id}/approve`, { as: ctx.admin });
  assert.equal(approved.status, 200);
  assert.equal(registrations()[0].status, "APPROVED");
  assert.equal(registrations()[0].reviewedById, ctx.admin.id);
  assert.ok(registrations()[0].reviewedAt instanceof Date);

  const vendorView = await call("GET", "/api/vendor/artfest-fair", { as: ctx.v1 });
  assert.equal(vendorView.body.registration.status, "APPROVED");

  // aprobat de două ori => 409; retras => nu se mai aprobă
  assert.equal((await call("POST", `/api/admin/artfest-fair/registrations/${r1.id}/approve`, { as: ctx.admin })).status, 409);
  await call("POST", "/api/vendor/artfest-fair/registration/withdraw", { as: ctx.v2 });
  const onWithdrawn = await call("POST", `/api/admin/artfest-fair/registrations/${r2.id}/approve`, { as: ctx.admin });
  assert.equal(onWithdrawn.status, 409);
  assert.equal(onWithdrawn.body.currentStatus, "WITHDRAWN");

  assert.equal((await call("POST", "/api/admin/artfest-fair/registrations/nope/reject", { as: ctx.admin })).status, 404);

  const detail = await call("GET", `/api/admin/artfest-fair/registrations/${r1.id}`, { as: ctx.admin });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.item.status, "APPROVED");
});

/* ============================== invitație ============================== */

const run = (extra = {}) => invite.runInvite({ emailDelayMs: 0, ...extra });
const notificationsFor = (vendorId) => fake.tables.notification.filter((n) => n.vendorId === vendorId);

test("invitație: doar vendori eligibili; email din vendor.email sau fallback user.email", async () => {
  const [inactiveUser, suspended, lockedUser, anon, noticed] = fake.seed("user", [
    { email: "x1@t.ro", status: "ACTIVE", locked: false },
    { email: "x2@t.ro", status: "SUSPENDED", locked: false },
    { email: "x3@t.ro", status: "ACTIVE", locked: true },
    { email: "x4@t.ro", status: "ACTIVE", locked: false },
    { email: "x5@t.ro", status: "ACTIVE", locked: false },
  ]);
  fake.seed("vendor", [
    { userId: inactiveUser.id, displayName: "Inactiv", ...activeVendor, isActive: false },
    { userId: suspended.id, displayName: "Suspendat", ...activeVendor },
    { userId: lockedUser.id, displayName: "Blocat", ...activeVendor },
    { userId: anon.id, displayName: "Anonim", ...activeVendor, anonymizedAt: new Date() },
    { userId: noticed.id, displayName: "Preaviz", ...activeVendor, terminationNoticeAt: new Date() },
    { userId: null, displayName: "Fără cont", ...activeVendor },
  ]);

  const preview = await invite.previewInvite();
  assert.equal(preview.eligibleVendors, 3);
  assert.equal(preview.notifications.toSend, 3);
  assert.equal(preview.emails.toSend, 3);

  const result = await run();
  assert.equal(result.eligibleVendors, 3);
  assert.equal(result.notificationsSent, 3);
  assert.equal(result.emailsSent, 3);
  assert.equal(result.errors, 0);

  assert.deepEqual(sentEmails.map((e) => e.to).sort(), ["a3@t.ro", "atelier1@t.ro", "v2@t.ro"]);

  const notification = notificationsFor(ctx.vendor1.id)[0];
  assert.equal(notification.title, "Artfest iese din online 🎄");
  assert.equal(
    notification.body,
    "Te invităm să participi alături de noi la Târgul de Crăciun Artfest din Buzău. Poți participa fizic sau ne poți trimite produsele tale."
  );
  assert.equal(notification.link, "/vendor/targ-artfest");
  assert.equal(notification.type, "system");
  assert.equal(notification.meta.ctaLabel, "Înscrie-te la târg");
  assert.equal(notification.dedupeKey, `artfest_fair_invite:${CAMPAIGN}:${ctx.vendor1.id}`);
  assert.equal(notification.userId, undefined);
});

test("invitație: rerularea nu retrimite nimic (notificare și email SENT)", async () => {
  await run();
  const second = await run();

  assert.equal(second.notificationsSent, 0);
  assert.equal(second.emailsSent, 0);
  assert.equal(second.notificationsAlreadySent, 3);
  assert.equal(second.emailsAlreadySent, 3);
  assert.equal(second.skippedVendors, 3);
  assert.equal(fake.tables.notification.length, 3);
  assert.equal(sentEmails.length, 3);
  assert.equal(fake.tables.artfestBroadcastDelivery.length, 3);

  // vendor nou apărut între timp => primește doar el
  const [nu] = fake.seed("user", [{ email: "nou@t.ro", status: "ACTIVE", locked: false }]);
  const [vendorNew] = fake.seed("vendor", [{ userId: nu.id, displayName: "Nou", email: "nou@t.ro", ...activeVendor }]);
  const third = await run();
  assert.equal(third.notificationsSent, 1);
  assert.equal(third.emailsSent, 1);
  assert.equal(notificationsFor(vendorNew.id).length, 1);
  assert.equal(sentEmails.length, 4);
});

test("invitație: email FAILED se reîncearcă, notificarea nu se dublează", async () => {
  failingEmails.add("a3@t.ro");
  const first = await run();
  assert.equal(first.notificationsSent, 3);
  assert.equal(first.emailsSent, 2);
  assert.equal(first.emailsFailed, 1);
  assert.equal(first.errors, 1);

  const row = fake.tables.artfestBroadcastDelivery.find((d) => d.vendorId === ctx.vendor3.id);
  assert.equal(row.notificationStatus, "SENT");
  assert.equal(row.emailStatus, "FAILED");
  assert.match(row.emailError, /smtp_down/);

  const preview = await invite.previewInvite();
  assert.equal(preview.emails.toSend, 1);
  assert.equal(preview.emails.failedRetry, 1);
  assert.equal(preview.notifications.toSend, 0);

  failingEmails.clear();
  const second = await run();
  assert.equal(second.emailsSent, 1);
  assert.equal(second.notificationsSent, 0);
  assert.equal(notificationsFor(ctx.vendor3.id).length, 1);
  assert.equal(row.emailStatus, "SENT");
  assert.equal(row.emailAttempts, 2);
  assert.equal(sentEmails.filter((e) => e.to === "a3@t.ro").length, 1);
});

test("invitație: SENDING întrerupt devine UNKNOWN și nu se retrimite automat", async () => {
  const old = new Date(Date.now() - invite.STALE_SENDING_MS - 60_000);
  fake.seed("artfestBroadcastDelivery", [
    { campaignKey: CAMPAIGN, vendorId: ctx.vendor1.id, notificationStatus: "PENDING", emailStatus: "SENDING", updatedAt: old },
    { campaignKey: CAMPAIGN, vendorId: ctx.vendor3.id, notificationStatus: "SENT", emailStatus: "UNKNOWN", updatedAt: old },
  ]);

  const result = await run();
  assert.equal(result.staleMarkedUnknown, 1);
  assert.equal(result.emailsUnknown, 2);
  assert.equal(result.emailsSent, 1); // doar vendor2 (fallback user.email)
  assert.deepEqual(sentEmails.map((e) => e.to), ["v2@t.ro"]);

  const row1 = fake.tables.artfestBroadcastDelivery.find((d) => d.vendorId === ctx.vendor1.id);
  assert.equal(row1.emailStatus, "UNKNOWN");
  // notificarea are stare separată: vendor1 o primește
  assert.equal(row1.notificationStatus, "SENT");
  assert.equal(notificationsFor(ctx.vendor1.id).length, 1);
  assert.equal(notificationsFor(ctx.vendor3.id).length, 0);

  const again = await run();
  assert.equal(again.emailsSent, 0);
  assert.equal(again.emailsUnknown, 2);
});

test("invitație: notificare/EmailLog existente => marcate SENT fără retrimitere", async () => {
  fake.seed("notification", [
    { vendorId: ctx.vendor1.id, title: "x", dedupeKey: `artfest_fair_invite:${CAMPAIGN}:${ctx.vendor1.id}` },
  ]);
  fake.seed("emailLog", [
    { toEmail: "atelier1@t.ro", template: `artfest_fair_invite:${CAMPAIGN}`, status: "SENT", sentAt: new Date(), subject: "s" },
  ]);

  const result = await run();
  assert.equal(result.notificationsAlreadySent, 1);
  assert.equal(result.emailsAlreadySent, 1);
  assert.equal(notificationsFor(ctx.vendor1.id).length, 1);
  assert.equal(sentEmails.some((e) => e.to === "atelier1@t.ro"), false);

  const row = fake.tables.artfestBroadcastDelivery.find((d) => d.vendorId === ctx.vendor1.id);
  assert.equal(row.notificationStatus, "SENT");
  assert.equal(row.emailStatus, "SENT");
});

test("invitație: vendor fără nicio adresă primește doar notificarea", async () => {
  fake.tables.user.find((u) => u.id === ctx.v2.id).email = null;
  const result = await run();
  assert.equal(result.emailsNoAddress, 1);
  assert.equal(notificationsFor(ctx.vendor2.id).length, 1);
  assert.equal(sentEmails.length, 2);
});

test("invitație: două rulări simultane => fiecare vendor primește un singur email", async () => {
  const [a, b] = await Promise.all([run(), run()]);
  assert.equal(a.emailsSent + b.emailsSent, 3);
  assert.equal(a.notificationsSent + b.notificationsSent, 3);
  assert.equal(sentEmails.length, 3);
  assert.equal(new Set(sentEmails.map((e) => e.to)).size, 3);
  assert.equal(fake.tables.notification.length, 3);
});

test("invitație din Admin: confirmare obligatorie, rulare manuală, rezultat în status", async () => {
  const noConfirm = await call("POST", "/api/admin/artfest-fair/invite/send", { as: ctx.admin, body: {} });
  assert.equal(noConfirm.status, 400);
  assert.equal(noConfirm.body.error, "confirmation_required");
  assert.equal(fake.tables.notification.length, 0);

  const preview = await call("GET", "/api/admin/artfest-fair/invite/preview", { as: ctx.admin });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.eligibleVendors, 3);

  const started = await call("POST", "/api/admin/artfest-fair/invite/send", {
    as: ctx.admin,
    body: { confirm: CAMPAIGN },
  });
  assert.equal(started.status, 202);

  let status;
  for (let i = 0; i < 500; i += 1) {
    status = (await call("GET", "/api/admin/artfest-fair/invite/status", { as: ctx.admin })).body;
    if (!status.running) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.equal(status.running, false);
  assert.equal(status.last.error, null);
  assert.equal(status.last.result.notificationsSent, 3);
  assert.equal(status.last.result.emailsSent, 3);
  assert.equal(status.last.startedBy, ctx.admin.id);
});

/* ============================== regulamentul târgului ============================== */

test("regulament: versiunea acceptată e cea de la înscriere și nu se rescrie ulterior", async () => {
  // fără regulament legat: înscrierea e refuzată, nu se salvează o acceptare fără versiune
  const none = await call("POST", "/api/vendor/artfest-fair/registration", { as: ctx.v1, body: validForm() });
  assert.equal(none.status, 409);
  assert.equal(none.body.error, "terms_not_published");
  assert.equal(registrations().length, 0);

  const fairRow = fake.tables.artfestFair[0];

  // o versiune NEPUBLICATĂ (nu e în registrul real) => fără link și fără înscriere
  fairRow.termsVersion = "9.9.9";
  fairRow.termsUrl = "/targ-artfest/regulament/v9.9.9";
  const unpublished = await call("GET", "/api/vendor/artfest-fair", { as: ctx.v2 });
  assert.equal(unpublished.body.fair.termsVersion, "9.9.9");
  assert.equal(unpublished.body.fair.termsUrl, null);
  assert.equal(unpublished.body.actions.canRegister, false);
  const unpub = await call("POST", "/api/vendor/artfest-fair/registration", { as: ctx.v2, body: validForm({ termsVersion: "9.9.9" }) });
  assert.equal(unpub.body.error, "terms_not_published");
  assert.equal(registrations().length, 0);

  // versiunea publicată 1.0.0 (registrul real) => link canonic; v1 o acceptă
  await linkTerms("1.0.0");
  const state = await call("GET", "/api/vendor/artfest-fair", { as: ctx.v2 });
  assert.equal(state.body.fair.termsVersion, "1.0.0");
  assert.equal(state.body.fair.termsUrl, "/targ-artfest/regulament/v1.0.0");
  assert.equal((await register(ctx.v1)).status, 201);

  // Artfest leagă 1.1.0; v2 avea formularul deschis cu 1.0.0 => refuz, fără înscriere
  await linkTerms("1.1.0");
  const stale = await register(ctx.v2, { termsVersion: "1.0.0" });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, "terms_version_changed");
  assert.ok(stale.body.fields.termsAccepted);
  // nici fără versiune trimisă nu se înregistrează acceptarea
  assert.equal((await register(ctx.v2, { termsVersion: undefined })).body.error, "terms_version_changed");
  assert.equal(registrations().some((r) => r.vendorId === ctx.vendor2.id), false);

  // după ce citește și bifează versiunea nouă => 1.1.0
  assert.equal((await register(ctx.v2)).status, 201);
  const v2Row = registrations().find((r) => r.vendorId === ctx.vendor2.id);
  assert.equal(v2Row.termsVersion, "1.1.0");

  // versiunea nouă NU rescrie acceptarea existentă (v1 rămâne pe 1.0.0)
  const v1Row = registrations().find((r) => r.vendorId === ctx.vendor1.id);
  assert.equal(v1Row.termsVersion, "1.0.0");
  const v1Detail = await call("GET", `/api/admin/artfest-fair/registrations/${v1Row.id}`, { as: ctx.admin });
  assert.equal(v1Detail.body.item.termsVersion, "1.0.0");
  assert.equal(v1Detail.body.item.termsVersionUrl, "/targ-artfest/regulament/v1.0.0");

  // Admin vede versiunea acceptată, cu linkul ei
  const detail = await call("GET", `/api/admin/artfest-fair/registrations/${v2Row.id}`, { as: ctx.admin });
  assert.equal(detail.body.item.termsVersion, "1.1.0");
  assert.equal(detail.body.item.termsVersionUrl, "/targ-artfest/regulament/v1.1.0");
});

test("regulament: Admin vede versiune / dată / IP / UA; fără termeni => null; vendorul nu primește IP / UA", async () => {
  // înscriere veche, de dinaintea publicării regulamentului (există pe DEV) => fără versiune acceptată
  await register(ctx.v2);
  registrations().find((r) => r.vendorId === ctx.vendor2.id).termsVersion = null;
  await linkTerms("1.0.0");

  // înscriere cu regulamentul 1.0.0 acceptat
  const res = await call("POST", "/api/vendor/artfest-fair/registration", {
    as: ctx.v1,
    body: validForm({ termsVersion: "1.0.0" }),
    headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "TestBrowser/1.0 (Admin terms)" },
  });
  assert.equal(res.status, 201);
  const withTerms = registrations().find((r) => r.vendorId === ctx.vendor1.id);
  const withoutTerms = registrations().find((r) => r.vendorId === ctx.vendor2.id);

  const adminWith = (await call("GET", `/api/admin/artfest-fair/registrations/${withTerms.id}`, { as: ctx.admin })).body.item;
  assert.equal(adminWith.termsVersion, "1.0.0");
  assert.ok(adminWith.termsAcceptedAt);
  assert.equal(new Date(adminWith.termsAcceptedAt).getTime(), new Date(withTerms.termsAcceptedAt).getTime());
  assert.equal(adminWith.termsIp, "203.0.113.7");
  assert.equal(adminWith.termsUa, "TestBrowser/1.0 (Admin terms)");
  assert.equal(adminWith.termsVersionUrl, "/targ-artfest/regulament/v1.0.0");

  const adminWithout = (await call("GET", `/api/admin/artfest-fair/registrations/${withoutTerms.id}`, { as: ctx.admin })).body.item;
  assert.equal(adminWithout.termsVersion, null);
  assert.equal(adminWithout.termsVersionUrl, null);

  // vendorul: versiunea și data, dar NICIODATĂ IP / user agent (nici la trimitere, nici la citire)
  assert.equal("termsIp" in (res.body.registration || {}), false);
  assert.equal("termsUa" in (res.body.registration || {}), false);
  const vendorState = (await call("GET", "/api/vendor/artfest-fair", { as: ctx.v1 })).body;
  assert.equal(vendorState.registration.termsVersion, "1.0.0");
  assert.ok(vendorState.registration.termsAcceptedAt);
  assert.equal("termsIp" in vendorState.registration, false);
  assert.equal("termsUa" in vendorState.registration, false);
  assert.doesNotMatch(JSON.stringify(vendorState), /203\.0\.113\.7|TestBrowser/);
});

test("regulament: doar versiunile din registru sunt servite (draftul și candidatul nu sunt publice)", async () => {
  const rules = await import("../lib/artfestFairRules.js");
  assert.deepEqual(rules.listPublishedFairRules().map((v) => v.version), ["1.0.0", "1.1.0"]);
  assert.equal(rules.isFairRulesVersionPublished("1.0.0"), true);
  assert.equal(rules.isFairRulesVersionPublished("1.1.0"), true);
  // 1.1.0: etichetarea e făcută de Artfest; scanarea nu scade stocul
  const v110 = rules.loadPublishedFairRules("1.1.0");
  assert.match(v110.html, /Etichetarea produselor este asigurată de Artfest/);
  assert.match(v110.html, /nu trebuie să generezi, să imprimi sau să aplici etichete/);
  assert.doesNotMatch(v110.html, /regenerezi eticheta|Eticheta se generează din aplicație/);
  // 1.0.0 rămâne neschimbată (istoricul acceptărilor)
  assert.match(rules.loadPublishedFairRules("1.0.0").html, /Eticheta se generează din aplicație/);
  assert.equal(rules.loadPublishedFairRules("1.0.0")?.publicPath, "/targ-artfest/regulament/v1.0.0");
  assert.equal(rules.isFairRulesVersionPublished("9.9.9"), false);
  assert.equal(rules.loadPublishedFairRules("9.9.9"), null);
  assert.equal(rules.loadPublishedFairRules("0.5.0"), null); // versiune veche a draftului
  assert.equal(rules.loadPublishedFairRules("0.18.0"), null); // draftul intern / candidatul
  assert.equal(rules.fairRulesPublicPath("1.0.0"), "/targ-artfest/regulament/v1.0.0");
  assert.equal(rules.normalizeFairRulesVersion("v1.2.3"), "1.2.3");
  assert.equal(rules.normalizeFairRulesVersion("../drafts"), null);
});

/* ============================== notificări ============================== */

const notifications = (where = () => true) => fake.tables.notification.filter(where);
const fairNotif = (kind) => (n) => n.meta?.kind === kind;

test("notificări: cerere nouă => fiecare ADMIN activ, link direct la înscriere; retry fără duplicat", async () => {
  const [admin2] = fake.seed("user", [{ email: "adm2@t.ro", role: "ADMIN", status: "ACTIVE", locked: false }]);
  fake.seed("user", [{ email: "adm3@t.ro", role: "ADMIN", status: "DISABLED", locked: false }]);

  const res = await register(ctx.v1);
  assert.equal(res.status, 201);
  const reg = registrations()[0];
  const sent = notifications(fairNotif("artfest_fair_registration_submitted"));
  assert.deepEqual(sent.map((n) => n.userId).sort(), [ctx.admin.id, admin2.id].sort());
  for (const n of sent) {
    assert.equal(n.title, "Cerere nouă pentru Târgul Artfest");
    assert.equal(n.body, "Magazin Ana a trimis o cerere de participare la Târgul Artfest.");
    assert.equal(n.link, `/admin?tab=artfestFair&registration=${reg.id}`);
    assert.equal(n.vendorId, null);
  }

  // retry / dublu submit => 409, nicio notificare nouă
  assert.equal((await register(ctx.v1)).status, 409);
  assert.equal(notifications(fairNotif("artfest_fair_registration_submitted")).length, 2);

  // reînscriere după retragere = cerere nouă => notificare nouă
  await call("POST", "/api/vendor/artfest-fair/registration/withdraw", { as: ctx.v1 });
  assert.equal((await register(ctx.v1)).status, 201);
  assert.equal(notifications(fairNotif("artfest_fair_registration_submitted")).length, 4);
});

test("notificări: aprobare => DOAR vendorul înscrierii, după succes; retry / eșec fără notificare", async () => {
  await register(ctx.v1);
  await register(ctx.v2);
  const r1 = registrations().find((r) => r.vendorId === ctx.vendor1.id);
  const r2 = registrations().find((r) => r.vendorId === ctx.vendor2.id);

  const ok = await call("POST", `/api/admin/artfest-fair/registrations/${r1.id}/approve`, { as: ctx.admin });
  assert.equal(ok.status, 200);
  const approved = notifications(fairNotif("artfest_fair_registration_approved"));
  assert.equal(approved.length, 1);
  assert.equal(approved[0].userId, ctx.v1.id);
  assert.equal(approved[0].vendorId, ctx.vendor1.id);
  assert.equal(approved[0].title, "Participarea ta la Târgul Artfest a fost aprobată.");
  assert.equal(approved[0].body, "Cererea ta de participare a fost acceptată. Poți începe pregătirea inventarului pentru târg.");
  assert.equal(approved[0].link, "/vendor/targ-artfest");

  // retry pe o participare deja aprobată => 409, fără duplicat
  assert.equal((await call("POST", `/api/admin/artfest-fair/registrations/${r1.id}/approve`, { as: ctx.admin })).status, 409);
  assert.equal(notifications(fairNotif("artfest_fair_registration_approved")).length, 1);

  // aprobare eșuată (înscriere retrasă) => nicio notificare
  await call("POST", "/api/vendor/artfest-fair/registration/withdraw", { as: ctx.v2 });
  assert.equal((await call("POST", `/api/admin/artfest-fair/registrations/${r2.id}/approve`, { as: ctx.admin })).status, 409);
  assert.equal(notifications((n) => n.userId === ctx.v2.id && n.meta?.kind === "artfest_fair_registration_approved").length, 0);

  // respingerea nu notifică vendorul ca aprobare
  await register(ctx.v3);
  const r3 = registrations().find((r) => r.vendorId === ctx.vendor3.id);
  await call("POST", `/api/admin/artfest-fair/registrations/${r3.id}/reject`, { as: ctx.admin, body: { reason: "x" } });
  assert.equal(notifications((n) => n.userId === ctx.v3.id && n.meta?.kind === "artfest_fair_registration_approved").length, 0);
  // reaprobarea după respingere = decizie nouă => o notificare
  await call("POST", `/api/admin/artfest-fair/registrations/${r3.id}/approve`, { as: ctx.admin });
  assert.equal(notifications((n) => n.userId === ctx.v3.id && n.meta?.kind === "artfest_fair_registration_approved").length, 1);
});

test("draftul regulamentului: doar citire pentru vendor / Admin, marcat draft, fără efect asupra acceptării", async () => {
  const draftUrl = "/api/vendor/artfest-fair/rules-draft";
  assert.equal((await call("GET", draftUrl)).status, 401);
  assert.equal((await call("GET", draftUrl, { as: ctx.u1 })).status, 403);

  const res = await fetch(`${base}${draftUrl}`, { headers: { "x-test-user": ctx.v1.id } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.match(res.headers.get("x-robots-tag"), /noindex/);
  const body = await res.json();
  assert.equal(body.status, "draft");
  assert.equal(body.official, false);
  assert.ok(body.draftVersion);
  assert.ok(body.html.length > 1000);

  const admin = await call("GET", "/api/admin/artfest-fair/rules-draft", { as: ctx.admin });
  assert.equal(admin.status, 200);
  assert.equal(admin.body.status, "draft");

  // draftul NU devine versiune oficială / acceptată
  const rules = await import("../lib/artfestFairRules.js");
  assert.equal(rules.loadPublishedFairRules(body.draftVersion), null);
  const state = await call("GET", "/api/vendor/artfest-fair", { as: ctx.v1 });
  assert.equal(state.body.fair.termsUrl, null);
  assert.equal(state.body.fair.termsVersion, null);
  // draftul nu se poate accepta: fără versiune publicată, înscrierea e refuzată
  const res2 = await call("POST", "/api/vendor/artfest-fair/registration", { as: ctx.v1, body: validForm({ termsVersion: body.draftVersion }) });
  assert.equal(res2.status, 409);
  assert.equal(res2.body.error, "terms_not_published");
  assert.equal(registrations().length, 0);
});
