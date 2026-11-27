// Cereri de ofertă fără cont (QR flyere) - rutele /api/customer-requests/guest/*
// și efectele lor în rutele existente /api/customer-requests:
//  - vizitator fără cont: trimitere -> email de confirmare -> publicare -> oferte prin link;
//  - email cu cont existent: răspuns identic, publicare doar autentificat în ACEL cont;
//  - utilizator autentificat: fluxul existent (POST /api/customer-requests) neschimbat;
//  - acces securizat: doar sesiunea vizitatorului (cookie) vede ofertele; revocare;
//  - emailuri: confirmare, link nou, ofertă nouă (o singură notificare până la vizită);
//  - duplicate / spam: câmp ascuns, trimitere prea rapidă, retrimitere cu pauză, limită per email;
//  - asociere cu un cont nou: doar email identic ȘI verificat; fără conturi create automat;
//  - fotografii după confirmare: doar proprietarul, moderate, max 10.
// Fără rețea: Prisma în memorie, mailer / moderare / R2 / OpenAI simulate.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/customerRequestGuest.routes.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";
process.env.JWT_SECRET = "test-secret";
process.env.APP_URL = "https://www.artfest.ro";
process.env.NODE_ENV = "test";
delete process.env.CUSTOMER_REQUEST_GUEST_ENABLED;
delete process.env.RATE_LIMIT_IP_MODE;

import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";

import { createFakePrisma } from "../testkit/fakePrisma.js";

let fake;
let sent;
let moderation;
let imageModeration;

mock.module("../db.js", {
  namedExports: { prisma: new Proxy({}, { get: (_t, key) => fake[key] }) },
});

function testAuth(required) {
  return (req, res, next) => {
    const sub = req.headers["x-test-user"];
    if (sub) req.user = { sub, role: req.headers["x-test-role"] || "USER" };
    if (required && !sub) return res.status(401).json({ error: "unauthenticated" });
    next();
  };
}

mock.module("../api/auth.js", {
  namedExports: { authRequired: testAuth(true), optionalAuth: testAuth(false) },
});

const record = (kind) => async (args) => {
  sent.push({ kind, ...args });
  return { ok: true };
};

mock.module("../lib/mailer.js", {
  namedExports: {
    sendGuestCustomerRequestConfirmEmail: record("confirm"),
    sendGuestCustomerRequestAccessEmail: record("access"),
    sendGuestCustomerRequestOfferEmail: record("offer"),
    sendVendorCustomerRequestMatchEmail: record("vendor_match"),
  },
});

mock.module("../lib/openai.js", { namedExports: { openai: {} } });

mock.module("../services/marketplaceMessageModeration.js", {
  namedExports: {
    async moderateMarketplaceMessage() {
      return moderation;
    },
    async moderateMarketplaceImage() {
      return imageModeration;
    },
  },
});

class FakeImageError extends Error {
  constructor(code, status, message) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

mock.module("../services/customizationImage.js", {
  namedExports: {
    CUSTOMIZATION_MAX_BYTES: 10 * 1024 * 1024,
    CustomizationImageError: FakeImageError,
    async processSafeImage(buffer) {
      if (String(buffer).startsWith("NOT-AN-IMAGE")) throw new FakeImageError("invalid_image", 415, "Fișierul nu este o fotografie acceptată.");
      return { buffer: Buffer.from("jpeg"), width: 10, height: 10, sourceFormat: "png" };
    },
  },
});

let stored = 0;
mock.module("../services/r2Storage.js", {
  namedExports: {
    buildPublicUrl: (key) => `https://cdn.test/${key}`,
    r2Client: {
      async send() {
        stored += 1;
        return {};
      },
    },
  },
});

let server;
let base;
let guestRouter;
let createGuestRouter;

before(async () => {
  ({ createCustomerRequestGuestRouter: createGuestRouter } = await import("./customerRequestGuestRoutes.js"));
  const requestRoutes = (await import("./customerRequestsRoutes.js")).default;
  const app = express();
  app.set("trust proxy", 1);
  app.use(cookieParser());
  app.use(express.json());
  // router nou la fiecare test (limitele în memorie nu se moștenesc)
  app.use("/api/customer-requests/guest", (req, res, next) => guestRouter(req, res, next));
  app.use("/api/customer-requests", requestRoutes);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

let ipCounter = 0;
let ctx;

beforeEach(() => {
  fake = createFakePrisma();
  sent = [];
  stored = 0;
  moderation = { allowed: true, reason: null, detections: [] };
  imageModeration = { allowed: true, reason: null };
  ipCounter += 1;
  guestRouter = createGuestRouter();

  const [client, vendorUser, other, unverified] = fake.seed("user", [
    { email: "client.existent@example.com", emailVerifiedAt: new Date(), name: "Client Existent" },
    { email: "atelier@example.com", emailVerifiedAt: new Date(), role: "VENDOR" },
    { email: "altcineva@example.com", emailVerifiedAt: new Date() },
    { email: "neconfirmat@example.com", emailVerifiedAt: null },
  ]);
  const [vendor] = fake.seed("vendor", [{ userId: vendorUser.id, displayName: "Atelierul Mariei", isActive: true, logoUrl: null }]);
  ctx = { client, vendorUser, other, unverified, vendor };
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 30));

async function call(method, path, { body, as, cookie, ip, headers = {} } = {}) {
  const h = { "x-forwarded-for": ip || `198.51.100.${ipCounter % 250}`, ...headers };
  if (body !== undefined) h["content-type"] = "application/json";
  if (as) h["x-test-user"] = as.id;
  if (cookie) h.cookie = cookie;
  const res = await fetch(`${base}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  const setCookie = res.headers.get("set-cookie") || "";
  return { status: res.status, body: json, text, setCookie };
}

const validRequest = (over = {}) => ({
  displayName: "Ana",
  email: "ana.vizitator@example.com",
  title: "Cutie de lemn gravată pentru nuntă",
  description: "Aș dori o cutie din lemn gravată cu numele mirilor, pentru verighete.",
  category: "alte",
  quantity: 1,
  budgetMinCents: 10000,
  budgetMaxCents: 25000,
  budgetType: "TOTAL",
  city: "Buzău",
  consent: true,
  wantsAccount: false,
  startedAt: Date.now() - 60_000,
  website: "",
  source: "flyer",
  ...over,
});

const tokenFrom = (url) => decodeURIComponent(String(url).split("#t=")[1] || "");
const sessionCookie = (setCookie) => (setCookie.match(/artfest_crg=[^;]+/) || [""])[0];

async function submitAndConfirm(over = {}) {
  const submit = await call("POST", "/api/customer-requests/guest/submit", { body: validRequest(over) });
  assert.equal(submit.status, 202);
  await flush();
  const mail = sent.filter((m) => m.kind === "confirm").at(-1);
  const confirm = await call("POST", "/api/customer-requests/guest/confirm", { body: { token: tokenFrom(mail.confirmUrl) } });
  await flush();
  return { submit, mail, confirm, cookie: sessionCookie(confirm.setCookie) };
}

/* ================= 1. Vizitator fără cont ================= */

test("config: fluxul e activ local; oprit în producție fără flag", async () => {
  const res = await call("GET", "/api/customer-requests/guest/config");
  assert.equal(res.status, 200);
  assert.equal(res.body.enabled, true);

  const { isGuestRequestsEnabled } = await import("../services/customerRequestGuestService.js");
  assert.equal(isGuestRequestsEnabled({ NODE_ENV: "production" }), false);
  assert.equal(isGuestRequestsEnabled({ NODE_ENV: "production", CUSTOMER_REQUEST_GUEST_ENABLED: "1" }), true);
  assert.equal(isGuestRequestsEnabled({ NODE_ENV: "development", CUSTOMER_REQUEST_GUEST_ENABLED: "0" }), false);
});

test("vizitator: trimiterea NU publică cererea și NU creează cont; emailul de confirmare are tokenul în #", async () => {
  const usersBefore = fake.tables.user.length;
  const res = await call("POST", "/api/customer-requests/guest/submit", { body: validRequest() });

  assert.equal(res.status, 202);
  assert.match(res.body.message, /email/);
  assert.equal(fake.tables.customerRequest.length, 0, "nepublicată");
  assert.equal(fake.tables.customerRequestPending.length, 1);
  assert.equal(fake.tables.user.length, usersBefore, "fără cont creat");
  assert.equal(fake.tables.customerRequestGuest[0].emailVerifiedAt, null);

  await flush();
  const mail = sent.find((m) => m.kind === "confirm");
  assert.equal(mail.to, "ana.vizitator@example.com");
  assert.equal(mail.accountExists, false);
  assert.match(mail.confirmUrl, /^https:\/\/www\.artfest\.ro\/cereri\/confirmare#t=/);
  assert.equal(sent.some((m) => m.kind === "vendor_match"), false, "vânzătorii nu sunt anunțați înainte de confirmare");

  const token = tokenFrom(mail.confirmUrl);
  assert.equal(fake.tables.customerRequestGuestToken.some((t) => t.tokenHash === token), false, "în DB doar hash-ul");

  const list = await call("GET", "/api/customer-requests");
  assert.equal(list.body.items.length, 0, "nu apare public");
});

test("vizitator: confirmarea publică cererea (OPEN, fără userId), setează sesiunea și anunță vânzătorii", async () => {
  fake.seed("product", []);
  const { confirm, cookie } = await submitAndConfirm();

  assert.equal(confirm.status, 201);
  assert.equal(confirm.body.outcome, "published_guest");
  assert.equal(confirm.body.email, "ana.vizitator@example.com");
  assert.ok(cookie, "cookie de sesiune");
  assert.match(confirm.setCookie, /HttpOnly/i);
  assert.match(confirm.setCookie, /Path=\/api\/customer-requests/);

  const [request] = fake.tables.customerRequest;
  assert.equal(request.status, "OPEN");
  assert.equal(request.userId, null);
  assert.ok(request.guestId);
  assert.ok(request.expiresAt > new Date(Date.now() + 29 * 24 * 3600 * 1000));
  assert.deepEqual(request.images, []);
  assert.ok(fake.tables.customerRequestGuest[0].emailVerifiedAt);

  const list = await call("GET", "/api/customer-requests");
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].user.name, "Ana");
  assert.equal(list.body.items[0].isGuestRequest, true);
  assert.equal(list.text.includes("ana.vizitator@example.com"), false, "emailul nu apare public");
});

test("vizitator: linkul de confirmare apăsat din nou nu dublează cererea; link invalid / expirat => 410", async () => {
  const { mail } = await submitAndConfirm();
  const again = await call("POST", "/api/customer-requests/guest/confirm", { body: { token: tokenFrom(mail.confirmUrl) } });
  assert.equal(again.status, 200);
  assert.equal(again.body.outcome, "already_published");
  assert.equal(fake.tables.customerRequest.length, 1);

  const bad = await call("POST", "/api/customer-requests/guest/confirm", { body: { token: "x".repeat(43) } });
  assert.equal(bad.status, 410);

  await call("POST", "/api/customer-requests/guest/submit", { body: validRequest({ title: "Alt produs dorit de mine", email: "b@example.com" }) });
  await flush();
  const second = sent.filter((m) => m.kind === "confirm").at(-1);
  fake.tables.customerRequestPending.at(-1).expiresAt = new Date(Date.now() - 1000);
  const expired = await call("POST", "/api/customer-requests/guest/confirm", { body: { token: tokenFrom(second.confirmUrl) } });
  assert.equal(expired.status, 410);
  assert.equal(fake.tables.customerRequest.length, 1);
});

test("validare server-side: acord, email, nume, titlu, categorie, termen, buget, moderare", async () => {
  const cases = [
    [{ consent: false }, 400, "consent_required"],
    [{ email: "nu-e-email" }, 400, "invalid_email"],
    [{ displayName: "A" }, 400, "invalid_display_name"],
    [{ displayName: "Ana 0722123456" }, 400, "invalid_display_name"],
    [{ displayName: "ana@example.com" }, 400, "invalid_display_name"],
    [{ title: "abc" }, 400, "title_required"],
    [{ description: "scurt" }, 400, "description_required"],
    [{ category: "categorie-inventata" }, 400, "invalid_category"],
    [{ deliveryDeadline: "2001-01-01" }, 400, "invalid_delivery_deadline"],
    [{ budgetMinCents: 5000, budgetMaxCents: 100 }, 400, "invalid_budget_range"],
    [{ quantity: 0 }, 400, "invalid_quantity"],
    [{ details: { text: "x".repeat(9000) } }, 400, "details_too_large"],
  ];

  let n = 0;
  for (const [over, status, error] of cases) {
    n += 1;
    const res = await call("POST", "/api/customer-requests/guest/submit", { body: validRequest({ email: `caz${n}@example.com`, ...over }) });
    assert.equal(res.status, status, JSON.stringify(over));
    assert.equal(res.body.error, error, JSON.stringify(over));
  }

  moderation = { allowed: false, reason: "external_contact_information", detections: ["phone_number"] };
  const blocked = await call("POST", "/api/customer-requests/guest/submit", { body: validRequest() });
  assert.equal(blocked.status, 422);
  assert.equal(blocked.body.error, "customer_request_blocked");

  moderation = { allowed: false, reason: "text_moderation_failed" };
  const technical = await call("POST", "/api/customer-requests/guest/submit", { body: validRequest() });
  assert.equal(technical.status, 503);

  assert.equal(fake.tables.customerRequestPending.length, 0);
  assert.equal(sent.length, 0);
});

test("valuta, imaginile și expirarea trimise de client sunt ignorate la vizitatori", async () => {
  await submitAndConfirm({ currency: "EUR", images: ["https://evil.example/x.jpg"], expiresAt: "2099-01-01" });
  const [request] = fake.tables.customerRequest;
  assert.equal(request.currency, "RON");
  assert.deepEqual(request.images, []);
  assert.ok(request.expiresAt < new Date("2099-01-01"));
});

/* ================= 2. Utilizator autentificat (neschimbat) ================= */

test("utilizator autentificat: POST /api/customer-requests publică direct, ca înainte", async () => {
  const res = await call("POST", "/api/customer-requests", {
    as: ctx.client,
    body: { title: "Lumânări personalizate botez", description: "Zece lumânări albe cu numele copilului." },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.request.user.name, "Client Existent");
  assert.equal(res.body.request.isGuestRequest, false);
  const [request] = fake.tables.customerRequest;
  assert.equal(request.userId, ctx.client.id);
  assert.equal(request.guestId, null);
  assert.equal(fake.tables.customerRequestPending.length, 0);

  const anon = await call("POST", "/api/customer-requests", { body: { title: "x".repeat(10), description: "y".repeat(20) } });
  assert.equal(anon.status, 401, "ruta cu cont rămâne protejată");
});

/* ================= 3 + 4. Email cu cont existent ================= */

test("email cu cont: răspuns IDENTIC cu emailul nou; publicare doar autentificat în acel cont", async () => {
  const fresh = await call("POST", "/api/customer-requests/guest/submit", { body: validRequest({ email: "nou@example.com" }) });
  const existing = await call("POST", "/api/customer-requests/guest/submit", {
    body: validRequest({ email: "Client.Existent@example.com", title: "Coroniță din flori naturale" }),
  });
  assert.equal(existing.status, fresh.status);
  assert.deepEqual(existing.body, fresh.body, "fără enumerarea conturilor");

  await flush();
  const mail = sent.find((m) => m.kind === "confirm" && m.to === "client.existent@example.com");
  assert.equal(mail.accountExists, true);
  const token = tokenFrom(mail.confirmUrl);

  const anon = await call("POST", "/api/customer-requests/guest/confirm", { body: { token } });
  assert.equal(anon.status, 409);
  assert.equal(anon.body.error, "login_required");
  assert.equal(fake.tables.customerRequest.length, 0);

  const wrong = await call("POST", "/api/customer-requests/guest/confirm", { body: { token }, as: ctx.other });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.error, "account_mismatch");
  assert.equal(fake.tables.customerRequest.length, 0);

  const ok = await call("POST", "/api/customer-requests/guest/confirm", { body: { token }, as: ctx.client });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.outcome, "published_account");
  assert.equal(ok.body.email, undefined);
  assert.equal(ok.setCookie.includes("artfest_crg="), false, "fără sesiune de vizitator pentru cont");
  const [request] = fake.tables.customerRequest;
  assert.equal(request.userId, ctx.client.id);
  assert.equal(request.guestId, null);
  const guest = fake.tables.customerRequestGuest.find((g) => g.email === "client.existent@example.com");
  assert.equal(guest.emailVerifiedAt, null, "vizitatorul nu e marcat confirmat pe calea contului");
});

/* ================= 5. Email neconfirmat ================= */

test("email neconfirmat: fără cerere publică, fără vânzători anunțați, fără acces la /me", async () => {
  const res = await call("POST", "/api/customer-requests/guest/submit", { body: validRequest() });
  assert.equal(res.status, 202);
  await flush();
  assert.equal(fake.tables.customerRequest.length, 0);
  assert.equal(sent.filter((m) => m.kind === "vendor_match").length, 0);
  const me = await call("GET", "/api/customer-requests/guest/me");
  assert.equal(me.status, 401);

  const link = await call("POST", "/api/customer-requests/guest/access-link", { body: { email: "ana.vizitator@example.com" } });
  assert.equal(link.status, 202);
  await flush();
  assert.equal(sent.filter((m) => m.kind === "access").length, 0, "fără link de acces pentru un email neconfirmat");
});

/* ================= 7. Acces securizat la oferte ================= */

async function vendorOffer(requestId, as = ctx.vendorUser) {
  return call("POST", `/api/customer-requests/${requestId}/offers`, {
    as,
    body: { unitPriceCents: 15000, shippingCents: 2000, productionDays: 7, message: "Pot realiza cutia în 7 zile." },
  });
}

test("acces: doar sesiunea vizitatorului vede ofertele; vânzătorul nu vede emailul clientului", async () => {
  const { cookie } = await submitAndConfirm();
  const [request] = fake.tables.customerRequest;

  const offer = await vendorOffer(request.id);
  assert.equal(offer.status, 201, JSON.stringify(offer.body));

  const owner = await call("GET", `/api/customer-requests/${request.id}`, { cookie });
  assert.equal(owner.body.request.viewerIsGuestOwner, true);
  assert.equal(owner.body.request.offers.length, 1);

  const anon = await call("GET", `/api/customer-requests/${request.id}`);
  assert.deepEqual(anon.body.request.offers, []);
  assert.equal(anon.body.request.viewerIsGuestOwner, undefined);

  const otherUser = await call("GET", `/api/customer-requests/${request.id}`, { as: ctx.other });
  assert.deepEqual(otherUser.body.request.offers, []);

  const forged = await call("GET", `/api/customer-requests/${request.id}`, { cookie: "artfest_crg=eyJhbGciOiJIUzI1NiJ9.e30.x" });
  assert.deepEqual(forged.body.request.offers, []);

  const vendorView = await call("GET", `/api/customer-requests/${request.id}`, { as: ctx.vendorUser });
  assert.equal(vendorView.body.request.myOffer.unitPriceCents, 15000);
  assert.equal(vendorView.text.includes("ana.vizitator@example.com"), false, "vânzătorul nu vede emailul");
  assert.equal(owner.text.includes("ana.vizitator@example.com"), false);
});

test("acces: sesiunea altui vizitator nu deschide cererea; revocarea invalidează cookie-ul", async () => {
  const first = await submitAndConfirm();
  const second = await submitAndConfirm({ email: "ion@example.com", displayName: "Ion", title: "Tablou pictat pe pânză" });
  const firstRequest = fake.tables.customerRequest[0];

  await vendorOffer(firstRequest.id);
  const foreign = await call("GET", `/api/customer-requests/${firstRequest.id}`, { cookie: second.cookie });
  assert.deepEqual(foreign.body.request.offers, []);

  const me = await call("GET", "/api/customer-requests/guest/me", { cookie: first.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.body.requests.length, 1);
  assert.equal(me.body.requests[0].offersCount, 1);

  fake.tables.customerRequestGuest.find((g) => g.email === "ana.vizitator@example.com").accessVersion += 1;
  const revoked = await call("GET", "/api/customer-requests/guest/me", { cookie: first.cookie });
  assert.equal(revoked.status, 401);
});

test("acces prin link nou: răspuns identic pentru orice email; link valabil => sesiune; pauză între linkuri", async () => {
  await submitAndConfirm();
  sent = [];

  const unknown = await call("POST", "/api/customer-requests/guest/access-link", { body: { email: "nimeni@example.com" } });
  const known = await call("POST", "/api/customer-requests/guest/access-link", { body: { email: "ANA.vizitator@example.com" } });
  assert.equal(unknown.status, 202);
  assert.deepEqual(unknown.body, known.body);

  await flush();
  const mails = sent.filter((m) => m.kind === "access");
  assert.equal(mails.length, 1);
  assert.match(mails[0].accessUrl, /\/cereri\/acces#t=/);

  const again = await call("POST", "/api/customer-requests/guest/access-link", { body: { email: "ana.vizitator@example.com" } });
  assert.equal(again.status, 202);
  await flush();
  assert.equal(sent.filter((m) => m.kind === "access").length, 1, "pauză de 5 minute între linkuri");

  const access = await call("POST", "/api/customer-requests/guest/access", { body: { token: tokenFrom(mails[0].accessUrl) } });
  assert.equal(access.status, 200);
  assert.equal(access.body.requests.length, 1);
  assert.ok(sessionCookie(access.setCookie));

  const confirmTokenAsAccess = await call("POST", "/api/customer-requests/guest/access", { body: { token: "y".repeat(43) } });
  assert.equal(confirmTokenAsAccess.status, 410);

  const logout = await call("POST", "/api/customer-requests/guest/logout");
  assert.match(logout.setCookie, /artfest_crg=;/);
});

/* ================= Emailuri la oferte ================= */

test("oferte: email către vizitator, apoi pauză până la vizită; fără notificare cu userId null", async () => {
  const { cookie } = await submitAndConfirm();
  const [request] = fake.tables.customerRequest;
  sent = [];

  const [secondVendorUser] = fake.seed("user", [{ email: "v2@example.com", role: "VENDOR", emailVerifiedAt: new Date() }]);
  fake.seed("vendor", [{ userId: secondVendorUser.id, displayName: "Lemn și Dor", isActive: true }]);
  const [thirdVendorUser] = fake.seed("user", [{ email: "v3@example.com", role: "VENDOR", emailVerifiedAt: new Date() }]);
  fake.seed("vendor", [{ userId: thirdVendorUser.id, displayName: "Atelier 3", isActive: true }]);

  // vizita din confirmare a fost înaintea primei oferte
  fake.tables.customerRequestGuest[0].lastAccessAt = new Date(Date.now() - 60_000);

  await vendorOffer(request.id);
  await flush();
  let offers = sent.filter((m) => m.kind === "offer");
  assert.equal(offers.length, 1);
  assert.equal(offers[0].to, "ana.vizitator@example.com");
  assert.equal(offers[0].vendorName, "Atelierul Mariei");
  assert.match(offers[0].accessUrl, /\/cereri\/acces#t=/);
  assert.equal(fake.tables.notification.filter((n) => n.userId == null).length, 0);

  await vendorOffer(request.id, secondVendorUser);
  await flush();
  offers = sent.filter((m) => m.kind === "offer");
  assert.equal(offers.length, 1, "fără al doilea email înainte de vizită");

  await new Promise((resolve) => setTimeout(resolve, 5));
  await call("GET", `/api/customer-requests/${request.id}`, { cookie });
  await vendorOffer(request.id, thirdVendorUser);
  await flush();
  assert.equal(sent.filter((m) => m.kind === "offer").length, 2, "după vizită pleacă următorul email");
});

test("oferte la cerere cu cont: notificarea existentă din aplicație, fără email de vizitator", async () => {
  await call("POST", "/api/customer-requests", {
    as: ctx.client,
    body: { title: "Lumânări personalizate botez", description: "Zece lumânări albe cu numele copilului." },
  });
  const [request] = fake.tables.customerRequest;
  await vendorOffer(request.id);
  await flush();
  assert.equal(sent.filter((m) => m.kind === "offer").length, 0);
  assert.equal(fake.tables.notification.filter((n) => n.userId === ctx.client.id).length, 1);
});

/* ================= 8. Duplicate și spam ================= */

test("spam: câmpul ascuns sau trimiterea prea rapidă => același 202, nimic salvat, niciun email", async () => {
  const honeypot = await call("POST", "/api/customer-requests/guest/submit", { body: validRequest({ website: "http://spam" }) });
  const fast = await call("POST", "/api/customer-requests/guest/submit", { body: validRequest({ startedAt: Date.now() - 500 }) });
  const normal = await call("POST", "/api/customer-requests/guest/submit", { body: validRequest({ email: "real@example.com" }) });

  assert.deepEqual(honeypot.body, normal.body);
  assert.deepEqual(fast.body, normal.body);
  await flush();
  assert.equal(fake.tables.customerRequestPending.length, 1);
  assert.equal(sent.length, 1);
});

test("duplicate: aceeași cerere retrimisă => o singură ciornă, email retrimis doar după pauză; după publicare nimic nou", async () => {
  await call("POST", "/api/customer-requests/guest/submit", { body: validRequest() });
  await call("POST", "/api/customer-requests/guest/submit", { body: validRequest({ title: "  CUTIE de lemn gravată   pentru nuntă " }) });
  await flush();
  assert.equal(fake.tables.customerRequestPending.length, 1);
  assert.equal(sent.filter((m) => m.kind === "confirm").length, 1);

  fake.tables.customerRequestPending[0].lastEmailAt = new Date(Date.now() - 11 * 60 * 1000);
  await call("POST", "/api/customer-requests/guest/submit", { body: validRequest() });
  await flush();
  assert.equal(fake.tables.customerRequestPending.length, 1);
  assert.equal(sent.filter((m) => m.kind === "confirm").length, 2, "retrimis după 10 minute");

  const latest = sent.filter((m) => m.kind === "confirm").at(-1);
  const first = sent.filter((m) => m.kind === "confirm")[0];
  const okFirst = await call("POST", "/api/customer-requests/guest/confirm", { body: { token: tokenFrom(first.confirmUrl) } });
  assert.equal(okFirst.status, 201, "ambele linkuri sunt valabile");
  const okLatest = await call("POST", "/api/customer-requests/guest/confirm", { body: { token: tokenFrom(latest.confirmUrl) } });
  assert.equal(okLatest.body.outcome, "already_published");

  const afterPublish = await call("POST", "/api/customer-requests/guest/submit", { body: validRequest() });
  assert.equal(afterPublish.status, 202);
  assert.equal(fake.tables.customerRequestPending.length, 1);
  assert.equal(fake.tables.customerRequest.length, 1, "fără cerere duplicată");
});

test("limită per email: max 3 ciorne neconfirmate", async () => {
  for (let i = 0; i < 3; i += 1) {
    const res = await call("POST", "/api/customer-requests/guest/submit", { body: validRequest({ title: `Produs diferit numărul ${i}` }) });
    assert.equal(res.status, 202);
  }
  const blocked = await call("POST", "/api/customer-requests/guest/submit", { body: validRequest({ title: "Al patrulea produs dorit" }) });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error, "guest_email_limit");
  assert.equal(fake.tables.customerRequestPending.length, 3);
});

test("dublu click pe confirmare (simultan) => o singură cerere", async () => {
  await call("POST", "/api/customer-requests/guest/submit", { body: validRequest() });
  await flush();
  const token = tokenFrom(sent.find((m) => m.kind === "confirm").confirmUrl);
  const [a, b] = await Promise.all([
    call("POST", "/api/customer-requests/guest/confirm", { body: { token } }),
    call("POST", "/api/customer-requests/guest/confirm", { body: { token } }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 201]);
  assert.equal(fake.tables.customerRequest.length, 1);
});

/* ================= 3 + 6. Cont creat ulterior ================= */

test("asociere cont: doar email identic ȘI verificat; nimic pentru alt email sau email neverificat", async () => {
  await submitAndConfirm({ email: "neconfirmat@example.com" });
  // contul cu acest email există, dar nu e verificat -> confirmarea a cerut login
  assert.equal(fake.tables.customerRequest.length, 0);

  await submitAndConfirm({ email: "viitor.cont@example.com", title: "Brățară din argint gravată" });
  const [request] = fake.tables.customerRequest;
  assert.equal(request.userId, null);

  const none = await call("POST", "/api/customer-requests/guest/link-account", { as: ctx.other });
  assert.equal(none.body.linked, 0);

  const [newUnverified] = fake.seed("user", [{ email: "viitor.cont@example.com", emailVerifiedAt: null }]);
  const pending = await call("POST", "/api/customer-requests/guest/link-account", { as: newUnverified });
  assert.equal(pending.body.linked, 0, "contul neverificat nu preia cererile");

  newUnverified.emailVerifiedAt = new Date();
  const linked = await call("POST", "/api/customer-requests/guest/link-account", { as: newUnverified });
  assert.equal(linked.body.linked, 1);
  assert.equal(request.userId, newUnverified.id);
  assert.equal(request.guestId !== null, true, "istoricul vizitatorului rămâne");

  const again = await call("POST", "/api/customer-requests/guest/link-account", { as: newUnverified });
  assert.equal(again.body.linked, 0, "idempotent");

  const pub = await call("GET", `/api/customer-requests/${request.id}`);
  assert.equal(pub.body.request.user.name, "Ana", "numele public rămâne cel din formular");

  const ownerView = await call("GET", `/api/customer-requests/${request.id}`, { as: newUnverified });
  assert.ok(Array.isArray(ownerView.body.request.offers));
  assert.equal(ownerView.body.request.user.id, newUnverified.id);

  const anon = await call("POST", "/api/customer-requests/guest/link-account");
  assert.equal(anon.status, 401);
});

test("roluri USER / VENDOR / INFLUENCER: aceeași regulă la confirmarea cu cont și la asociere", async () => {
  for (const role of ["USER", "VENDOR", "INFLUENCER"]) {
    const email = `rol.${role.toLowerCase()}@example.com`;
    const [account] = fake.seed("user", [{ email, role, emailVerifiedAt: new Date() }]);

    // email cu cont: publicare doar autentificat în acel cont, indiferent de rol
    await call("POST", "/api/customer-requests/guest/submit", { body: validRequest({ email, title: `Cerere pentru rolul ${role}` }) });
    await flush();
    const token = tokenFrom(sent.filter((m) => m.kind === "confirm" && m.to === email).at(-1).confirmUrl);
    const anon = await call("POST", "/api/customer-requests/guest/confirm", { body: { token } });
    assert.equal(anon.status, 409, role);
    const ok = await call("POST", "/api/customer-requests/guest/confirm", { body: { token }, as: account, headers: { "x-test-role": role } });
    assert.equal(ok.body.outcome, "published_account", role);
    assert.equal(fake.tables.customerRequest.find((r) => r.id === ok.body.requestId).userId, account.id, role);

    // contul blocat nu poate publica / prelua cereri
    account.locked = true;
    const linkedLocked = await call("POST", "/api/customer-requests/guest/link-account", { as: account });
    assert.equal(linkedLocked.body.linked, 0, `${role} blocat`);
    account.locked = false;
  }
});

/* ================= Fotografii după confirmare ================= */

async function uploadImage(requestId, cookie, content = "PNGDATA") {
  const form = new FormData();
  form.append("file", new Blob([content], { type: "image/png" }), "poza.png");
  const res = await fetch(`${base}/api/customer-requests/guest/requests/${requestId}/images`, {
    method: "POST",
    headers: cookie ? { cookie } : {},
    body: form,
  });
  return { status: res.status, body: await res.json() };
}

test("fotografii: doar proprietarul cu sesiune, moderate, stocate, max 10; ștergere", async () => {
  const { cookie } = await submitAndConfirm();
  const [request] = fake.tables.customerRequest;

  assert.equal((await uploadImage(request.id, null)).status, 401);

  const ok = await uploadImage(request.id, cookie);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.match(ok.body.url, /^https:\/\/cdn\.test\/customer-requests\/guest-/);
  assert.equal(request.images.length, 1);
  assert.equal(stored, 1);

  imageModeration = { allowed: false, reason: "external_contact_information" };
  const blocked = await uploadImage(request.id, cookie);
  assert.equal(blocked.status, 422);
  assert.equal(stored, 1, "imaginea blocată nu se stochează");

  imageModeration = { allowed: false, reason: "image_moderation_failed" };
  assert.equal((await uploadImage(request.id, cookie)).status, 503);

  imageModeration = { allowed: true };
  assert.equal((await uploadImage(request.id, cookie, "NOT-AN-IMAGE")).status, 415);

  const other = await submitAndConfirm({ email: "ion@example.com", displayName: "Ion", title: "Tablou pictat pe pânză" });
  assert.equal((await uploadImage(request.id, other.cookie)).status, 404, "alt vizitator");

  request.images = Array.from({ length: 10 }, (_, i) => `https://cdn.test/${i}.jpg`);
  assert.equal((await uploadImage(request.id, cookie)).status, 409);

  const del = await call("DELETE", `/api/customer-requests/guest/requests/${request.id}/images`, {
    cookie,
    body: { url: "https://cdn.test/3.jpg" },
  });
  assert.equal(del.status, 200);
  assert.equal(request.images.length, 9);
});

test("limită per email în memorie: a 9-a trimitere într-o oră => 429 (indiferent de IP)", async () => {
  for (let i = 0; i < 8; i += 1) {
    await call("POST", "/api/customer-requests/guest/submit", {
      body: validRequest({ website: "bot" }),
      ip: `203.0.113.${i + 1}`,
    });
  }
  const blocked = await call("POST", "/api/customer-requests/guest/submit", { body: validRequest(), ip: "203.0.113.200" });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error, "guest_rate_limited");
});

/* ================= Flag oprit ================= */

test("flag oprit: rutele de vizitator răspund 404, ruta cu cont rămâne", async () => {
  process.env.CUSTOMER_REQUEST_GUEST_ENABLED = "0";
  try {
    const res = await call("POST", "/api/customer-requests/guest/submit", { body: validRequest() });
    assert.equal(res.status, 404);
    const config = await call("GET", "/api/customer-requests/guest/config");
    assert.equal(config.body.enabled, false);
  } finally {
    delete process.env.CUSTOMER_REQUEST_GUEST_ENABLED;
  }
});

test("linkuri din email: domeniul real, token în # (nu în query), rezervă fără APP_URL", async () => {
  const { appUrl, confirmUrlFor, accessUrlFor } = await import("../services/customerRequestGuestService.js");
  assert.equal(appUrl({ APP_URL: "https://www.artfest.ro/" }), "https://www.artfest.ro");
  assert.equal(appUrl({ FRONTEND_URL: "https://artfest.ro" }), "https://artfest.ro");
  assert.equal(appUrl({}), "https://www.artfest.ro", "fără APP_URL -> domeniul public, nu link relativ");
  assert.equal(appUrl({ APP_URL: "http://localhost:5173", NODE_ENV: "production" }), "https://www.artfest.ro");
  assert.equal(appUrl({ APP_URL: "http://localhost:5173", NODE_ENV: "development" }), "http://localhost:5173");

  const confirm = new URL(confirmUrlFor("abc_DEF-123", { APP_URL: "https://www.artfest.ro" }));
  assert.equal(confirm.origin, "https://www.artfest.ro");
  assert.equal(confirm.pathname, "/cereri/confirmare");
  assert.equal(confirm.search, "", "tokenul nu ajunge în jurnalele serverului / Referer");
  assert.equal(confirm.hash, "#t=abc_DEF-123");
  assert.equal(new URL(accessUrlFor("x", { APP_URL: "https://www.artfest.ro" })).pathname, "/cereri/acces");
});
