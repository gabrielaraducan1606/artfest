// Teste: invitația la Târg pentru magazinele NEACTIVATE (Admin).
// Rutele reale; DB in-memory, auth pe header, mailer simulat (niciun email real).
//
// Rulare: node --experimental-test-module-mocks --test src/routes/artfestFairActivationInvite.routes.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";
process.env.JWT_SECRET = "test-secret";
process.env.UNSUBSCRIBE_SECRET = "secret-de-test-0123456789-abcdefghij";

import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import { createFakePrisma } from "../testkit/fakePrisma.js";

let fake;
const sent = [];
const failing = new Set();
let gate = null; // trimiterea simulată așteaptă poarta (test de concurență determinist)

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
      throw new Error("invitația principală nu trebuie trimisă în aceste teste");
    },
    artfestFairActivationInviteTemplate: (k) => `artfest_fair_activation_invite:${k}`,
    artfestFairActivationUnsubscribeUrl: (email) => `https://api.test/unsubscribe?token=${email}`,
    buildArtfestFairActivationInviteEmail: ({ firstName, ctaPath, helpPhoneDisplay }) => ({
      subject: "Activează-ți magazinul Artfest",
      preheader: "p",
      html: `<p>Bună, ${firstName}</p><a href="https://www.artfest.ro${ctaPath}">Activează-ți magazinul</a> ${helpPhoneDisplay}`,
      text: "t",
    }),
    async sendArtfestFairActivationInviteEmail(payload) {
      if (gate) await gate.promise;
      if (failing.has(payload.to)) throw new Error("smtp_down");
      await fake.emailLog.create({
        data: { toEmail: payload.to, userId: payload.userId, template: `artfest_fair_activation_invite:${payload.campaignKey}`, status: "SENT", sentAt: new Date() },
      });
      sent.push(payload);
      return { messageId: `m_${sent.length}` };
    },
  },
});

const CAMPAIGN = "CHRISTMAS_FAIR_BUZAU_2026_ACTIVATION_INVITE";
const API = "/api/admin/artfest-fair/activation-invite";

let server;
let base;
let ctx;

before(async () => {
  const adminRoutes = (await import("./adminArtfestFairRoutes.js")).default;
  const unsubscribeRoutes = (await import("./unsubscribeRoutes.js")).default;
  const app = express();
  app.use(express.json());
  app.use("/api/admin/artfest-fair", adminRoutes);
  app.use("/api", unsubscribeRoutes); // ca în server.js
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((r) => server.close(r)));

// modele fără delegate în fakePrisma comun: doar citire, suficient pentru excluderi
function simpleDelegate(rows) {
  const match = (row, where = {}) =>
    Object.entries(where).every(([k, v]) => (v && typeof v === "object" && "in" in v ? v.in.includes(row[k]) : row[k] === v));
  return { findMany: async ({ where } = {}) => rows.filter((r) => match(r, where)) };
}

beforeEach(() => {
  gate = null;
  sent.length = 0;
  failing.clear();
  fake = createFakePrisma();
  const verified = new Date("2026-09-01");
  const U = (email, extra = {}) => ({ email, role: "VENDOR", status: "ACTIVE", locked: false, emailVerifiedAt: verified, firstName: "Ana", marketingOptIn: true, ...extra });
  const users = fake.seed("user", [
    U("ok1@t.ro"), // 0 eligibil, fără magazin
    U("ok2@t.ro", { firstName: "Ion" }), // 1 eligibil, magazin început (DRAFT), email din cont
    U("activ@t.ro"), // 2 magazin activ
    U("pauza@t.ro"), // 3 magazin pe pauză (INACTIVE, vendor dezactivat ulterior)
    U("dezactivat@t.ro"), // 4 dezactivat de Admin (serviciu ACTIVE)
    U("anon@t.ro"), // 5 anonimizat
    U("incetat@t.ro"), // 6 încetare colaborare
    U("suspendat@t.ro", { status: "SUSPENDED" }), // 7
    U("sters@t.ro", { status: "DELETED" }), // 8
    U("blocat@t.ro", { locked: true }), // 9
    U("neconfirmat@t.ro", { emailVerifiedAt: null }), // 10
    U("dezabonat@t.ro"), // 11 dezabonat (newsletter)
    U("pref@t.ro"), // 12 emailuri dezactivate în preferințe
    U("inscris@t.ro"), // 13 are deja înscriere la târg
    U("fara-email"), // 14 email invalid
    { email: "adm@t.ro", role: "ADMIN", status: "ACTIVE", locked: false }, // 15
    U("fara-acord@t.ro", { marketingOptIn: false }), // 16 fără acord pentru comunicări comerciale
  ]);
  const V = (i, extra = {}) => ({
    userId: users[i].id, displayName: `Magazin ${i}`, email: null, isActive: false,
    anonymizedAt: null, terminationNoticeAt: null, terminationFinalizedAt: null, createdAt: new Date(2026, 8, i + 1), ...extra,
  });
  const vendors = fake.seed("vendor", [
    V(0, { email: "OK1@T.ro" }), V(1), V(2, { isActive: true }), V(3), V(4), V(5, { anonymizedAt: new Date() }),
    V(6, { terminationNoticeAt: new Date() }), V(7), V(8), V(9), V(10), V(11), V(12), V(13), V(14), V(16),
  ]);
  fake.seed("vendorService", [
    { vendorId: vendors[1].id, status: "DRAFT", isActive: false },
    { vendorId: vendors[2].id, status: "ACTIVE", isActive: true },
    { vendorId: vendors[3].id, status: "INACTIVE", isActive: false },
    { vendorId: vendors[4].id, status: "ACTIVE", isActive: true },
  ]);
  const [fair] = fake.seed("artfestFair", [{ key: "CHRISTMAS_FAIR_BUZAU_2026", title: "Târg" }]);
  fake.seed("artfestFairRegistration", [{ fairId: fair.id, vendorId: vendors[13].id, submittedByUserId: users[13].id, status: "SUBMITTED" }]);
  fake.newsletterSubscriber = simpleDelegate([
    { email: "dezabonat@t.ro", status: "UNSUBSCRIBED" },
    { email: "ok1@t.ro", status: "SUBSCRIBED" },
  ]);
  fake.userMarketingPrefs = simpleDelegate([
    { userId: users[12].id, emailEnabled: false },
    { userId: users[0].id, emailEnabled: true },
  ]);
  ctx = { users, vendors, admin: users[15], vendorUser: users[2] };
});

async function call(method, path, { as, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (as) headers["x-test-user"] = as.id;
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function waitDone() {
  for (let i = 0; i < 200; i += 1) {
    const st = await call("GET", `${API}/status`, { as: ctx.admin });
    if (!st.body.running) return st.body.last;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("trimiterea nu s-a terminat");
}

const deliveries = () => fake.tables.artfestBroadcastDelivery;

test("acces: doar adminul (vendor 403, fără sesiune 401)", async () => {
  assert.equal((await call("GET", `${API}/preview`)).status, 401);
  assert.equal((await call("GET", `${API}/preview`, { as: ctx.vendorUser })).status, 403);
  assert.equal((await call("POST", `${API}/send`, { as: ctx.vendorUser, body: { confirm: CAMPAIGN, vendorIds: [ctx.vendors[0].id] } })).status, 403);
  assert.equal(sent.length, 0);
});

test("previzualizare: doar magazinele niciodată activate, eligibile; excluderile au motiv", async () => {
  const res = await call("GET", `${API}/preview`, { as: ctx.admin });
  assert.equal(res.status, 200);
  assert.equal(res.body.eligible, 2);
  assert.deepEqual(
    res.body.recipients.map((r) => [r.vendorId, r.email, r.ctaPath, r.state]),
    [
      [ctx.vendors[0].id, "ok1@t.ro", "/onboarding", "toSend"],
      [ctx.vendors[1].id, "ok2@t.ro", "/onboarding/details", "toSend"],
    ]
  );
  const reasons = Object.fromEntries(res.body.excluded.map((e) => [e.reason, e.count]));
  assert.deepEqual(reasons, {
    storeActivatedBefore: 2, anonymized: 1, terminated: 1, userInactive: 2, userLocked: 1,
    emailUnverified: 1, unsubscribed: 2, alreadyRegistered: 1, noEmail: 1, noMarketingConsent: 1,
  });
  // magazinul activ nu apare nici măcar printre excluși (nu e „neactivat”)
  assert.equal(JSON.stringify(res.body).includes("activ@t.ro"), false);
  // fără acord pentru comunicări comerciale => exclus (nu apare printre destinatari)
  assert.equal(res.body.recipients.some((r) => r.email === "fara-acord@t.ro"), false);
  assert.equal(res.body.status.running, false);
  assert.equal(sent.length, 0);
  assert.equal(deliveries().length, 0); // previzualizarea nu scrie nimic
});

test("previzualizarea emailului: HTML cu CTA și telefon, fără trimitere", async () => {
  const res = await call("GET", `${API}/email-preview?ctaPath=/onboarding/details`, { as: ctx.admin });
  assert.equal(res.status, 200);
  assert.match(res.body.html, /Activează-ți magazinul/);
  assert.match(res.body.html, /\/onboarding\/details/);
  assert.match(res.body.html, /0760 565 147/);
  // altă cale decât cele două permise => /onboarding
  const other = await call("GET", `${API}/email-preview?ctaPath=https://evil.test`, { as: ctx.admin });
  assert.match(other.body.html, /artfest\.ro\/onboarding"/);
  assert.equal(sent.length, 0);
});

test("trimitere: confirmare obligatorie, selecție obligatorie, eligibilitatea se verifică pe server", async () => {
  assert.equal((await call("POST", `${API}/send`, { as: ctx.admin, body: { vendorIds: [ctx.vendors[0].id] } })).body.error, "confirmation_required");
  assert.equal((await call("POST", `${API}/send`, { as: ctx.admin, body: { confirm: CAMPAIGN, vendorIds: [] } })).body.error, "no_recipients_selected");
  assert.equal(sent.length, 0);

  // selecție cu un eligibil + un magazin pe pauză + un activ + un id inexistent => doar eligibilul
  const res = await call("POST", `${API}/send`, {
    as: ctx.admin,
    body: { confirm: CAMPAIGN, vendorIds: [ctx.vendors[0].id, ctx.vendors[3].id, ctx.vendors[2].id, "nu-exista"] },
  });
  assert.equal(res.status, 202);
  const last = await waitDone();
  assert.equal(last.result.emailsSent, 1);
  assert.equal(last.result.notEligible, 3);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "ok1@t.ro");
  assert.equal(sent[0].ctaPath, "/onboarding");
  assert.equal(sent[0].helpPhoneDisplay, "0760 565 147");
  assert.equal(sent[0].campaignKey, CAMPAIGN);
  assert.equal(last.result.items[0].outcome, "sent");

  const row = deliveries().find((d) => d.vendorId === ctx.vendors[0].id);
  assert.equal(row.campaignKey, CAMPAIGN);
  assert.equal(row.emailStatus, "SENT");
  assert.equal(row.notificationStatus, "PENDING"); // doar email, fără notificare în aplicație
  assert.equal(fake.tables.notification.length, 0);

  const preview = await call("GET", `${API}/preview`, { as: ctx.admin });
  assert.equal(preview.body.recipients.find((r) => r.vendorId === ctx.vendors[0].id).state, "alreadySent");
});

test("fără duplicate: retrimiterea, EmailLog existent și trimiterea simultană nu dublează emailul", async () => {
  const body = { confirm: CAMPAIGN, vendorIds: [ctx.vendors[0].id, ctx.vendors[1].id] };

  // a doua cerere cât prima încă trimite: refuzată (409), rularea e una singură
  let release;
  gate = { promise: new Promise((r) => (release = r)) };
  const a = await call("POST", `${API}/send`, { as: ctx.admin, body });
  const b = await call("POST", `${API}/send`, { as: ctx.admin, body });
  assert.equal(a.status, 202);
  assert.equal(b.status, 409);
  assert.equal(b.body.error, "already_running");
  gate = null;
  release();
  await waitDone();
  assert.equal(sent.length, 2);

  // a doua rulare: ambii au deja SENT => nimic nou
  await call("POST", `${API}/send`, { as: ctx.admin, body });
  const again = await waitDone();
  assert.equal(again.result.emailsSent, 0);
  assert.equal(again.result.emailsAlreadySent, 2);
  assert.equal(sent.length, 2);
  assert.equal(deliveries().length, 2);
});

test("plasă: EmailLog SENT pe template => marcat trimis, fără email nou", async () => {
  await fake.emailLog.create({ data: { toEmail: "ok1@t.ro", template: `artfest_fair_activation_invite:${CAMPAIGN}`, status: "SENT", sentAt: new Date() } });
  await call("POST", `${API}/send`, { as: ctx.admin, body: { confirm: CAMPAIGN, vendorIds: [ctx.vendors[0].id] } });
  const last = await waitDone();
  assert.equal(last.result.emailsAlreadySent, 1);
  assert.equal(sent.length, 0);
});

test("eroare de trimitere: FAILED cu motiv vizibil; reîncercare explicită ulterioară", async () => {
  failing.add("ok2@t.ro");
  await call("POST", `${API}/send`, { as: ctx.admin, body: { confirm: CAMPAIGN, vendorIds: [ctx.vendors[0].id, ctx.vendors[1].id] } });
  const first = await waitDone();
  assert.equal(first.result.emailsSent, 1);
  assert.equal(first.result.emailsFailed, 1);
  assert.deepEqual(first.result.items.find((i) => i.vendorId === ctx.vendors[1].id), {
    vendorId: ctx.vendors[1].id, vendorName: "Magazin 1", email: "ok2@t.ro", outcome: "failed", error: "smtp_down",
  });
  const preview = await call("GET", `${API}/preview`, { as: ctx.admin });
  const failed = preview.body.recipients.find((r) => r.vendorId === ctx.vendors[1].id);
  assert.equal(failed.state, "failedRetry");
  assert.equal(failed.lastError, "smtp_down");

  failing.clear();
  await call("POST", `${API}/send`, { as: ctx.admin, body: { confirm: CAMPAIGN, vendorIds: [ctx.vendors[1].id] } });
  const retry = await waitDone();
  assert.equal(retry.result.emailsSent, 1);
  assert.equal(sent.filter((s) => s.to === "ok2@t.ro").length, 1);
});

test("SENDING rămas dintr-o rulare întreruptă => UNKNOWN, nu se retrimite automat", async () => {
  fake.seed("artfestBroadcastDelivery", [
    { campaignKey: CAMPAIGN, vendorId: ctx.vendors[0].id, emailStatus: "SENDING", updatedAt: new Date(Date.now() - 60 * 60 * 1000) },
  ]);
  await call("POST", `${API}/send`, { as: ctx.admin, body: { confirm: CAMPAIGN, vendorIds: [ctx.vendors[0].id] } });
  const last = await waitDone();
  assert.equal(last.result.staleMarkedUnknown, 1);
  assert.equal(last.result.emailsUnknown, 1);
  assert.equal(sent.length, 0);
});

test("invitația principală (magazine active) nu include magazinele neactivate", async () => {
  const main = await import("../services/artfestFairInviteService.js");
  const eligible = await main.loadEligibleVendors(fake);
  assert.ok(eligible.every((v) => v.vendorId === ctx.vendors[2].id));
  assert.equal(eligible.some((v) => v.vendorId === ctx.vendors[0].id), false);
});

test("dezabonarea funcționează: linkul (/api/unsubscribe) dezabonează, iar destinatarul iese din listă", async () => {
  const { buildApiUnsubscribeUrl } = await import("../lib/unsubscribeUrl.js");
  // delegate minimale pentru ruta reală de dezabonare
  const newsletter = [{ email: "dezabonat@t.ro", status: "UNSUBSCRIBED" }];
  fake.newsletterSubscriber = {
    findMany: async ({ where }) => newsletter.filter((r) => where.email.in.includes(r.email) && r.status === where.status),
    upsert: async ({ where, create, update }) => {
      const row = newsletter.find((r) => r.email === where.email);
      if (row) return Object.assign(row, update);
      newsletter.push({ ...create });
      return create;
    },
  };
  fake.userMarketingPrefs = { ...fake.userMarketingPrefs, upsert: async ({ create }) => create };

  const url = buildApiUnsubscribeUrl("ok1@t.ro", { env: { API_URL: base, UNSUBSCRIBE_SECRET: process.env.UNSUBSCRIBE_SECRET } });
  assert.ok(url.startsWith(`${base}/api/unsubscribe?token=`));
  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Te-ai dezabonat cu succes/);
  assert.equal(ctx.users[0].marketingOptIn, false);

  const preview = await call("GET", `${API}/preview`, { as: ctx.admin });
  assert.equal(preview.body.recipients.some((r) => r.email === "ok1@t.ro"), false);
  assert.equal(preview.body.eligible, 1);

  // link modificat => respins, nimic schimbat
  const bad = await fetch(url.replace(/token=./, "token=X"));
  assert.equal(bad.status, 400);
});
