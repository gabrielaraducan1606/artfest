// Teste HTTP pentru gate-ul de politici + Admin Legal (rutele reale;
// mock-uri doar pe DB in-memory, auth pe header și mailer).
//
// Rulare: node --experimental-test-module-mocks --test src/routes/policyGate.routes.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";
process.env.JWT_SECRET = "test-secret";

import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import { createFakePrisma } from "../testkit/fakePrisma.js";

let fake;
const sentEmails = [];

mock.module("../db.js", {
  namedExports: {
    // binding stabil; delegă la baza in-memory curentă (recreată la fiecare test)
    prisma: new Proxy({}, { get: (_target, key) => fake[key] }),
  },
});

// auth: identitatea vine din headerul x-test-user (id) și x-test-role
mock.module("../api/auth.js", {
  namedExports: {
    authRequired(req, res, next) {
      const sub = req.headers["x-test-user"];
      if (!sub) return res.status(401).json({ error: "unauthorized" });
      req.user = { sub, role: req.headers["x-test-role"] || "USER" };
      next();
    },
    enforceTokenVersion(_req, _res, next) {
      next();
    },
    requireRole(...roles) {
      return (req, res, next) =>
        roles.includes(req.user?.role) ? next() : res.status(403).json({ error: "forbidden" });
    },
  },
});

mock.module("../lib/mailer.js", {
  namedExports: {
    async sendPolicyUpdateEmail(payload) {
      sentEmails.push(payload);
    },
  },
});

let server;
let base;
let ctx;

before(async () => {
  const gateRoutes = (await import("./adminPolicyNotificationsRoutes.js")).default;
  const legalRoutes = (await import("./adminLegalRoutes.js")).default;

  const app = express();
  app.use(express.json());
  app.use("/api", gateRoutes);
  app.use("/api/admin/legal", legalRoutes);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  sentEmails.length = 0;
  fake = createFakePrisma();

  const [u1, u2, v1, v2, i1, admin] = fake.seed("user", [
    { email: "u1@t.ro", role: "USER" },
    { email: "u2@t.ro", role: "USER" },
    { email: "v1@t.ro", role: "VENDOR" },
    { email: "v2@t.ro", role: "VENDOR" },
    { email: "i1@t.ro", role: "INFLUENCER" },
    { email: "adm@t.ro", role: "ADMIN" },
  ]);

  const [vendor1] = fake.seed("vendor", [
    { userId: v1.id, displayName: "Atelier 1", email: "a1@t.ro" },
    { userId: v2.id, displayName: "Atelier 2", email: "a2@t.ro" },
  ]);

  ctx = { u1, u2, v1, v2, i1, admin, vendor1 };
});

async function call(method, path, { as, body } = {}) {
  const headers = { "content-type": "application/json" };

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

const asAdmin = () => ({ id: ctx.admin.id, role: "ADMIN" });
const asUser = (u) => ({ id: u.id, role: u.role });

const publishDoc = (catalogId) =>
  call("POST", "/api/admin/legal/documents/publish", {
    as: asAdmin(),
    body: { catalogId, version: "1.0.0" },
  });

const requestDoc = (catalogId, audience, extra = {}) =>
  call("POST", "/api/admin/legal/documents/request-reacceptance", {
    as: asAdmin(),
    body: { catalogId, audience, version: "1.0.0", ...extra },
  });

/* --------------------------------- admin --------------------------------- */

test("admin legal: neautentificat 401, ne-admin 403", async () => {
  assert.equal((await call("GET", "/api/admin/legal/documents")).status, 401);
  assert.equal(
    (await call("GET", "/api/admin/legal/documents", { as: asUser(ctx.u1) })).status,
    403
  );
  assert.equal(
    (
      await call("POST", "/api/admin/legal/documents/publish", {
        as: asUser(ctx.u1),
        body: { catalogId: "TOS", version: "1.0.0" },
      })
    ).status,
    403
  );
});

test("admin legal: catalog, publicare și cerere prin API", async () => {
  const catalog = await call("GET", "/api/admin/legal/documents", { as: asAdmin() });
  assert.equal(catalog.status, 200);
  assert.ok(catalog.body.rows.length >= 12);

  const publish = await publishDoc("TOS");
  assert.equal(publish.status, 200);
  assert.equal(publish.body.reacceptanceRequested, false);

  const notPublished = await requestDoc("PRIVACY", "USER");
  assert.equal(notPublished.status, 409);
  assert.equal(notPublished.body.error, "version_not_published");

  const request = await requestDoc("TOS", "USER");
  assert.equal(request.status, 200);
  assert.equal(request.body.targetCount, 2);
  assert.equal(request.body.recipients, undefined);

  const history = await call("GET", "/api/admin/legal/documents/history?catalogId=TOS&audience=USER", {
    as: asAdmin(),
  });
  assert.equal(history.status, 200);
  assert.deepEqual(history.body.campaigns.map((c) => c.type).sort(), ["PUBLISH", "REQUEST"]);

  const acceptances = await call(
    "GET",
    "/api/admin/legal/documents/acceptances?catalogId=TOS&audience=USER&version=1.0.0&status=pending",
    { as: asAdmin() }
  );
  assert.equal(acceptances.body.total, 2);

  const cookies = await call("GET", "/api/admin/legal/documents/history?catalogId=COOKIES", {
    as: asAdmin(),
  });
  assert.equal(cookies.status, 404);
});

test("admin legal: emailul cererii pleacă (tranzacțional) după request", async () => {
  await publishDoc("TOS");
  const { body } = await requestDoc("TOS", "USER", {
    email: { subject: "TOS actualizat", body: "Text" },
  });

  assert.equal(body.emailRequested, true);

  // trimiterea rulează în fundal
  for (let i = 0; i < 40 && sentEmails.length < 2; i += 1) {
    await new Promise((r) => setTimeout(r, 10));
  }

  assert.deepEqual(sentEmails.map((m) => m.to).sort(), ["u1@t.ro", "u2@t.ro"]);

  const resend = await call("POST", `/api/admin/legal/campaigns/${body.campaignId}/resend-email`, {
    as: asAdmin(),
  });
  assert.equal(resend.status, 200);
  // nimic nu s-a trimis dublu doar din simpla republicare?  (EmailLog e scris de mailerul real,
  // aici mock-ul nu scrie log, deci resend retrimite - verificăm doar că răspunde ok)
  assert.equal(resend.body.ok, true);
});

/* --------------------------------- gate --------------------------------- */

test("gate: publicarea singură NU blochează pe nimeni", async () => {
  await publishDoc("TOS");
  await publishDoc("PRIVACY");

  const gate = await call("GET", "/api/policy-gate?scope=USERS", { as: asUser(ctx.u1) });

  assert.equal(gate.status, 200);
  assert.equal(gate.body.requiresAction, false);
  assert.deepEqual(gate.body.documents, []);

  const pending = await call("GET", "/api/policy-gate/pending", { as: asUser(ctx.u1) });
  assert.deepEqual(pending.body.pending, []);
});

test("gate: cerere pe audience USER se vede doar userilor; accept închide gate-ul", async () => {
  await publishDoc("TOS");
  await requestDoc("TOS", "USER", { inApp: { title: "T", message: "M" } });

  const userGate = await call("GET", "/api/policy-gate?scope=USERS", { as: asUser(ctx.u1) });
  assert.equal(userGate.body.requiresAction, true);
  assert.equal(userGate.body.documents.length, 1);
  assert.equal(userGate.body.documents[0].key, "TOS");
  assert.equal(userGate.body.documents[0].version, "1.0.0");
  assert.equal(userGate.body.documents[0].alreadyAccepted, false);
  assert.equal(userGate.body.notification.title, "T");

  const vendorGate = await call("GET", "/api/policy-gate?scope=USERS", { as: asUser(ctx.v1) });
  assert.deepEqual(vendorGate.body.documents, []);

  const influencerGate = await call("GET", "/api/policy-gate?scope=USERS", { as: asUser(ctx.i1) });
  assert.deepEqual(influencerGate.body.documents, []);

  const accept = await call("POST", "/api/policy-gate/accept", {
    as: asUser(ctx.u1),
    body: { scope: "USERS", documents: ["TOS"] },
  });

  assert.equal(accept.status, 200);
  assert.equal(accept.body.gateClosed, true);
  assert.equal(accept.body.notificationArchived, true);

  const consents = fake.tables.userConsent;
  assert.equal(consents.length, 1);
  assert.equal(consents[0].userId, ctx.u1.id);
  assert.equal(consents[0].version, "1.0.0");

  const after = await call("GET", "/api/policy-gate?scope=USERS", { as: asUser(ctx.u1) });
  assert.equal(after.body.requiresAction, false);

  // celălalt user încă are de acceptat
  const other = await call("GET", "/api/policy-gate?scope=USERS", { as: asUser(ctx.u2) });
  assert.equal(other.body.requiresAction, true);
});

test("gate multi-document: TOS + Privacy + Returns simultan; acceptare parțială nu închide", async () => {
  await publishDoc("TOS");
  await publishDoc("PRIVACY");
  await publishDoc("RETURNS_POLICY_ACK@USER");

  await requestDoc("TOS", "USER");
  await requestDoc("PRIVACY", "USER");
  await requestDoc("RETURNS_POLICY_ACK@USER", "USER");

  const gate = await call("GET", "/api/policy-gate?scope=USERS", { as: asUser(ctx.u1) });
  assert.deepEqual(gate.body.documents.map((d) => d.key).sort(), ["PRIVACY", "RETURNS_POLICY_ACK", "TOS"]);

  const partial = await call("POST", "/api/policy-gate/accept", {
    as: asUser(ctx.u1),
    body: { scope: "USERS", documents: ["TOS"] },
  });

  assert.equal(partial.body.gateClosed, false);
  assert.deepEqual(partial.body.remainingRequired.map((d) => d.key).sort(), ["PRIVACY", "RETURNS_POLICY_ACK"]);

  const rest = await call("POST", "/api/policy-gate/accept", {
    as: asUser(ctx.u1),
    body: { scope: "USERS", documents: ["PRIVACY", "RETURNS_POLICY_ACK"] },
  });

  assert.equal(rest.body.gateClosed, true);
  assert.deepEqual(
    fake.tables.userConsent.map((c) => c.document).sort(),
    ["PRIVACY_ACK", "RETURNS_POLICY_ACK", "TOS"]
  );

  // notificările lui u1 sunt arhivate, ale lui u2 nu
  const mine = fake.tables.notification.filter((n) => n.userId === ctx.u1.id);
  assert.ok(mine.length === 3 && mine.every((n) => n.archived));
  assert.ok(fake.tables.notification.filter((n) => n.userId === ctx.u2.id).every((n) => !n.archived));
});

test("gate vendor: TOS@VENDOR (stocat per user) + VENDOR_TERMS (per vendor) + Returns@VENDOR", async () => {
  await publishDoc("TOS");
  await publishDoc("VENDOR_TERMS");
  await publishDoc("RETURNS_POLICY_ACK@USER");
  await publishDoc("RETURNS_POLICY_ACK@VENDOR");

  await requestDoc("TOS", "VENDOR");
  await requestDoc("VENDOR_TERMS", "VENDOR");
  await requestDoc("RETURNS_POLICY_ACK@VENDOR", "VENDOR");

  const pending = await call("GET", "/api/policy-gate/pending", { as: asUser(ctx.v1) });
  assert.deepEqual(pending.body.pending.map((d) => d.catalogId).sort(), [
    "RETURNS_POLICY_ACK@VENDOR",
    "TOS",
    "VENDOR_TERMS",
  ]);

  const usersScope = await call("GET", "/api/policy-gate?scope=USERS", { as: asUser(ctx.v1) });
  assert.deepEqual(usersScope.body.documents.map((d) => d.key), ["TOS"]);

  const vendorsScope = await call("GET", "/api/policy-gate?scope=VENDORS", { as: asUser(ctx.v1) });
  assert.deepEqual(vendorsScope.body.documents.map((d) => d.key).sort(), ["RETURNS_POLICY_ACK", "VENDOR_TERMS"]);

  await call("POST", "/api/policy-gate/accept", {
    as: asUser(ctx.v1),
    body: { scope: "VENDORS", documents: ["VENDOR_TERMS", "RETURNS_POLICY_ACK"] },
  });

  assert.deepEqual(
    fake.tables.vendorAcceptance.map((a) => a.document).sort(),
    ["RETURNS_POLICY_ACK", "VENDOR_TERMS"]
  );
  assert.equal(fake.tables.vendorAcceptance[0].userId, ctx.v1.id);

  // acceptarea vendorului NU atinge Returns@USER
  assert.equal(fake.tables.userConsent.length, 0);

  const remaining = await call("GET", "/api/policy-gate/pending", { as: asUser(ctx.v1) });
  assert.deepEqual(remaining.body.pending.map((d) => d.catalogId), ["TOS"]);
});

test("gate: influencerii primesc TOS/Privacy pe audience INFLUENCER, nu INFLUENCER_TERMS", async () => {
  await publishDoc("TOS");
  await publishDoc("INFLUENCER_TERMS");

  await requestDoc("TOS", "INFLUENCER");
  await requestDoc("INFLUENCER_TERMS", "INFLUENCER");

  const gate = await call("GET", "/api/policy-gate?scope=USERS", { as: asUser(ctx.i1) });
  assert.deepEqual(gate.body.documents.map((d) => d.key), ["TOS"]);

  const userGate = await call("GET", "/api/policy-gate?scope=USERS", { as: asUser(ctx.u1) });
  assert.deepEqual(userGate.body.documents, []);
});

test("gate accept: documente care nu fac parte din cerere / cookies => 400", async () => {
  await publishDoc("TOS");
  await requestDoc("TOS", "USER");

  const notRequested = await call("POST", "/api/policy-gate/accept", {
    as: asUser(ctx.u1),
    body: { scope: "USERS", documents: ["PRIVACY"] },
  });
  assert.equal(notRequested.status, 400);
  assert.equal(notRequested.body.error, "invalid_documents");

  const cookies = await call("POST", "/api/policy-gate/accept", {
    as: asUser(ctx.u1),
    body: { scope: "USERS", documents: ["COOKIES"] },
  });
  assert.equal(cookies.status, 400);

  assert.equal((await call("POST", "/api/policy-gate/accept", { as: asUser(ctx.u1), body: { scope: "X", documents: ["TOS"] } })).status, 400);
  assert.equal((await call("POST", "/api/policy-gate/accept", { as: asUser(ctx.u1), body: { scope: "USERS", documents: [] } })).status, 400);
  assert.equal((await call("GET", "/api/policy-gate?scope=VENDORS", { as: asUser(ctx.u1) })).status, 403);
  assert.equal((await call("GET", "/api/policy-gate?scope=USERS")).status, 401);

  assert.equal(fake.tables.userConsent.length, 0);
});

test("gate: acceptă versiunea CERUTĂ chiar dacă între timp a fost publicată alta", async () => {
  await publishDoc("TOS");
  await requestDoc("TOS", "USER");

  // simulează o publicare ulterioară a altei versiuni (rândul cerut rămâne în tabel)
  const required = fake.tables.userPolicy.find((p) => p.document === "TOS");
  required.isActive = false;
  fake.seed("userPolicy", [{ document: "TOS", version: "9.9.9", title: "TOS", url: "/x", isActive: true }]);

  const accept = await call("POST", "/api/policy-gate/accept", {
    as: asUser(ctx.u1),
    body: { scope: "USERS", documents: ["TOS"] },
  });

  assert.equal(accept.status, 200);
  assert.equal(fake.tables.userConsent[0].version, "1.0.0");
});

test("compat legacy: notificare fără meta.requirements continuă să funcționeze; COOKIES e ignorat", async () => {
  fake.seed("userPolicy", [
    { document: "TOS", version: "1.0.0", title: "TOS", url: "/tos", checksum: "c1" },
    { document: "COOKIES_ACK", version: "1.0.0", title: "Cookies", url: "/cookies", checksum: "c2" },
  ]);

  fake.seed("notification", [
    {
      userId: ctx.u1.id,
      type: "system",
      title: "Campanie veche",
      body: "Text",
      meta: { kind: "POLICY_UPDATE", scope: "USERS", documents: ["TOS", "COOKIES"], requiresAction: true, campaignKey: "old" },
    },
  ]);

  const gate = await call("GET", "/api/policy-gate?scope=USERS", { as: asUser(ctx.u1) });

  assert.equal(gate.body.requiresAction, true);
  assert.deepEqual(gate.body.documents.map((d) => d.key), ["TOS"]);
  assert.equal(gate.body.documents[0].alreadyAccepted, false);
  assert.equal(gate.body.notification.title, "Campanie veche");

  const cookies = await call("POST", "/api/policy-gate/accept", {
    as: asUser(ctx.u1),
    body: { scope: "USERS", documents: ["COOKIES"] },
  });
  assert.equal(cookies.status, 400);

  const accept = await call("POST", "/api/policy-gate/accept", {
    as: asUser(ctx.u1),
    body: { scope: "USERS", documents: ["TOS"] },
  });

  assert.equal(accept.body.gateClosed, true);
  assert.equal(accept.body.notificationArchived, true);
  assert.equal(fake.tables.userConsent[0].document, "TOS");
  assert.equal(fake.tables.notification[0].archived, true);

  // niciun consimțământ COOKIES_ACK nu s-a creat
  assert.equal(fake.tables.userConsent.some((c) => c.document === "COOKIES_ACK"), false);
});

test("compat legacy + cerere nouă coexistă în același gate", async () => {
  fake.seed("userPolicy", [{ document: "PRIVACY_ACK", version: "1.0.0", title: "Privacy", url: "/p" }]);
  fake.seed("notification", [
    {
      userId: ctx.u1.id,
      type: "system",
      title: "Veche",
      body: "b",
      meta: { kind: "POLICY_UPDATE", documents: ["PRIVACY"], requiresAction: true, campaignKey: "old" },
    },
  ]);

  await publishDoc("TOS");
  await requestDoc("TOS", "USER");

  const gate = await call("GET", "/api/policy-gate?scope=USERS", { as: asUser(ctx.u1) });
  assert.deepEqual(gate.body.documents.map((d) => d.key).sort(), ["PRIVACY", "TOS"]);

  const accept = await call("POST", "/api/policy-gate/accept", {
    as: asUser(ctx.u1),
    body: { scope: "USERS", documents: ["TOS", "PRIVACY"] },
  });

  assert.equal(accept.body.gateClosed, true);
  assert.deepEqual(fake.tables.userConsent.map((c) => c.document).sort(), ["PRIVACY_ACK", "TOS"]);
});

test("cerere informativă (requiresAction=false): se afișează, dar nu obligă", async () => {
  await publishDoc("TOS");
  await requestDoc("TOS", "USER", { requiresAction: false });

  const gate = await call("GET", "/api/policy-gate?scope=USERS", { as: asUser(ctx.u1) });

  assert.equal(gate.body.requiresAction, false);
  assert.equal(gate.body.documents.length, 1);

  const pending = await call("GET", "/api/policy-gate/pending", { as: asUser(ctx.u1) });
  assert.deepEqual(pending.body.pending, []);
});

/* --------------------------------- /send --------------------------------- */

test("/send (wrapper): publică versiunea curentă și creează cereri; cookies respins", async () => {
  const cookies = await call("POST", "/api/admin/policy-notifications/send", {
    as: asAdmin(),
    body: { scope: "USERS", documents: ["COOKIES"], inApp: { title: "t", message: "m" } },
  });
  assert.equal(cookies.status, 400);
  assert.deepEqual(cookies.body.invalidDocuments, ["COOKIES"]);

  const res = await call("POST", "/api/admin/policy-notifications/send", {
    as: asAdmin(),
    body: {
      scope: "USERS",
      documents: ["TOS"],
      requiresAction: true,
      inApp: { title: "Actualizare", message: "Te rugăm să accepți" },
    },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.publication.publishedCount, 1);
  // TOS se aplica înainte și clienților, și vendorilor: două cereri (USER + VENDOR)
  assert.equal(res.body.campaigns.length, 2);
  assert.equal(res.body.targetCount, 4); // u1,u2 + v1,v2

  const gate = await call("GET", "/api/policy-gate?scope=USERS", { as: asUser(ctx.u1) });
  assert.equal(gate.body.requiresAction, true);

  const forbidden = await call("POST", "/api/admin/policy-notifications/send", {
    as: asUser(ctx.u1),
    body: { scope: "USERS", documents: ["TOS"] },
  });
  assert.equal(forbidden.status, 403);
});
