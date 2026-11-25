// Rulare: node --test src/services/secretSantaInviteService.test.js
//
// Invitația Secret Santa prin email (Admin): destinatari eligibili, excluderi,
// adrese unice, fără trimiteri duplicate la reîncercare, rezultate salvate,
// email de test, trimitere în fundal, acces doar ADMIN.
// Fără DB reală și fără emailuri reale: db și funcția de trimitere sunt simulate.

process.env.JWT_SECRET = "secret-santa-invite-test";
process.env.RESEND_API_KEY = "";
// secretul e citit la încărcarea modulului de semnare => setat înainte de importuri
process.env.UNSUBSCRIBE_SECRET = "x".repeat(40);
process.env.PUBLIC_API_URL = "https://www.artfest.ro/api";

import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import jwt from "jsonwebtoken";

const {
  classifyInviteRecipients,
  previewInvite,
  renderInvitePreview,
  resetInviteRunState,
  runInvite,
  sendBlockReason,
  sendTestInvite,
  startInvite,
} = await import("./secretSantaInviteService.js");
const { buildSecretSantaInviteEmail, secretSantaInviteTemplate, sendSecretSantaInviteEmail } = await import("../lib/mailer.js");
const { SECRET_SANTA_VENDOR_INVITE } = await import("../config/secretSanta.js");

const NOW = new Date("2026-11-25T10:00:00+02:00");
const KEY = SECRET_SANTA_VENDOR_INVITE.campaignKey;
const OPEN_EDITION = { id: "e1", key: "SECRET_SANTA_2026", title: "Secret Santa Artfest 2026", status: "OPEN", registrationClosesAt: null };

function vendor(id, over = {}, userOver = {}) {
  const { user: userOverride, ...rest } = over;
  return {
    id,
    userId: `u_${id}`,
    displayName: `Atelier ${id}`,
    isActive: true,
    anonymizedAt: null,
    terminationNoticeAt: null,
    terminationFinalizedAt: null,
    services: [{ id: `s_${id}` }],
    ...rest,
    user:
      userOverride === null
        ? null
        : {
            id: `u_${id}`,
            email: `${id}@exemplu.ro`,
            firstName: `Nume${id}`,
            role: "VENDOR",
            status: "ACTIVE",
            locked: false,
            emailVerifiedAt: new Date("2026-01-01"),
            marketingOptIn: true,
            ...userOver,
          },
  };
}

function fakeDb({ vendors = [], edition = OPEN_EDITION, participants = [], unsubscribed = [], prefsOff = [], emailLogs = [], users = {} } = {}) {
  const deliveries = [];
  let seq = 0;
  const byId = (id) => deliveries.find((d) => d.id === id);
  const matches = (d, where) =>
    (!where.id || d.id === where.id) &&
    (!where.campaignKey || d.campaignKey === where.campaignKey) &&
    (where.emailStatus === undefined ||
      (typeof where.emailStatus === "string" ? d.emailStatus === where.emailStatus : where.emailStatus.in.includes(d.emailStatus))) &&
    (!where.updatedAt?.lt || d.updatedAt < where.updatedAt.lt);
  return {
    deliveries,
    user: { findUnique: async ({ where }) => users[where.id] || null },
    secretSantaEdition: { findFirst: async () => edition },
    vendor: { findMany: async () => vendors },
    newsletterSubscriber: {
      findMany: async ({ where }) => unsubscribed.filter((e) => where.email.in.includes(e)).map((email) => ({ email })),
    },
    userMarketingPrefs: {
      findMany: async ({ where }) => prefsOff.filter((u) => where.userId.in.includes(u)).map((userId) => ({ userId })),
    },
    secretSantaParticipant: { findMany: async () => participants.map((vendorId) => ({ vendorId })) },
    emailLog: {
      findFirst: async ({ where }) =>
        emailLogs.find((l) => l.template === where.template && l.toEmail === where.toEmail && l.status === where.status) || null,
    },
    artfestBroadcastDelivery: {
      findMany: async ({ where }) => deliveries.filter((d) => d.campaignKey === where.campaignKey).map((d) => ({ ...d })),
      findUnique: async ({ where }) => {
        if (where.id) return byId(where.id) ? { ...byId(where.id) } : null;
        const k = where.campaignKey_vendorId;
        const d = deliveries.find((x) => x.campaignKey === k.campaignKey && x.vendorId === k.vendorId);
        return d ? { ...d } : null;
      },
      upsert: async ({ where, create }) => {
        const k = where.campaignKey_vendorId;
        let d = deliveries.find((x) => x.campaignKey === k.campaignKey && x.vendorId === k.vendorId);
        if (!d) {
          d = { id: `d${++seq}`, emailStatus: "PENDING", emailAttempts: 0, emailSentAt: null, emailError: null, updatedAt: new Date(), ...create };
          deliveries.push(d);
        }
        return { ...d };
      },
      update: async ({ where, data }) => Object.assign(byId(where.id), data, { updatedAt: new Date() }),
      updateMany: async ({ where, data }) => {
        const rows = deliveries.filter((d) => matches(d, where));
        for (const d of rows) Object.assign(d, data, { updatedAt: data.updatedAt || new Date() });
        return { count: rows.length };
      },
    },
  };
}

function recordingSend({ failFor = new Set() } = {}) {
  const calls = [];
  const send = async (payload) => {
    calls.push(payload);
    if (failFor.has(payload.to)) throw new Error("smtp_down");
    return { ok: true };
  };
  return { calls, send };
}

/* ============================== destinatari ============================== */

test("eligibili: doar vânzătorii care pot participa ȘI pot primi comunicări; fiecare excludere are motiv", async () => {
  const db = fakeDb({
    vendors: [
      vendor("ok1"),
      vendor("ok2"),
      vendor("anon", { anonymizedAt: new Date() }),
      vendor("term", { terminationNoticeAt: new Date() }),
      vendor("nouser", { user: null }),
      vendor("rol", {}, { role: "USER" }),
      vendor("susp", {}, { status: "SUSPENDED" }),
      vendor("blocat", {}, { locked: true }),
      vendor("inactiv", { isActive: false }),
      vendor("faramag", { services: [] }),
      vendor("neconf", {}, { emailVerifiedAt: null }),
      vendor("faraemail", {}, { email: "nu-e-email" }),
      vendor("dezab"),
      vendor("prefoff"),
      vendor("faraacord", {}, { marketingOptIn: false }),
      vendor("inscris"),
    ],
    unsubscribed: ["dezab@exemplu.ro"],
    prefsOff: ["u_prefoff"],
    participants: ["inscris"],
  });
  const { eligible, excluded } = await classifyInviteRecipients(db);
  assert.deepEqual(eligible.map((r) => r.vendorId), ["ok1", "ok2"]);
  assert.deepEqual(Object.fromEntries(excluded.map((e) => [e.vendorId, e.reason])), {
    anon: "anonymized",
    term: "terminated",
    nouser: "userMissing",
    rol: "notVendor",
    susp: "userInactive",
    blocat: "userLocked",
    inactiv: "storeInactive",
    faramag: "noStore",
    neconf: "emailUnverified",
    faraemail: "noEmail",
    dezab: "unsubscribed",
    prefoff: "unsubscribed",
    faraacord: "noMarketingConsent",
    inscris: "alreadyRegistered",
  });
});

test("adrese duplicate: o singură invitație per adresă (fără diferențe de majuscule / spații)", async () => {
  const db = fakeDb({
    vendors: [vendor("a", {}, { email: "Atelier@Exemplu.ro" }), vendor("b", {}, { email: " atelier@exemplu.ro " }), vendor("c")],
  });
  const { eligible, excluded } = await classifyInviteRecipients(db);
  assert.deepEqual(eligible.map((r) => [r.vendorId, r.email]), [
    ["a", "atelier@exemplu.ro"],
    ["c", "c@exemplu.ro"],
  ]);
  assert.deepEqual(excluded.map((e) => [e.vendorId, e.reason]), [["b", "duplicateEmail"]]);
});

test("trimiterea e permisă doar cu o ediție publicată și înscrieri deschise", () => {
  assert.match(sendBlockReason(null, NOW), /Nu există/);
  assert.match(sendBlockReason({ ...OPEN_EDITION, status: "CLOSED" }, NOW), /nu sunt deschise/);
  assert.match(sendBlockReason({ ...OPEN_EDITION, status: "DRAWN" }, NOW), /Extragerea/);
  assert.match(sendBlockReason({ ...OPEN_EDITION, registrationClosesAt: new Date("2026-11-20") }, NOW), /nu sunt deschise/);
  assert.equal(sendBlockReason(OPEN_EDITION, NOW), null);
});

/* ============================== conținut ============================== */

test("email: subiectul cerut, extragerea 5 decembrie 2026, buget 50–80 lei, CTA spre pagina reală /secret-santa", () => {
  const email = buildSecretSantaInviteEmail({ ...SECRET_SANTA_VENDOR_INVITE, firstName: "Ana", unsubscribeUrl: "https://www.artfest.ro/api/unsubscribe?t=x" });
  assert.equal(email.subject, "🎁 Secret Santa Artfest – Înscrie-te până la extragerea din 5 decembrie!");
  assert.match(email.ctaUrl, /\/secret-santa$/);
  for (const part of [email.html, email.text]) {
    assert.match(part, /5 decembrie 2026/);
    assert.match(part, /50–80 lei/);
    assert.match(part, /Înscrie-te la Secret Santa/);
    assert.match(part, /vânzătorii Artfest/);
    assert.match(part, /api\/unsubscribe\?t=x/);
  }
  assert.match(email.html, /Bună, Ana,/);
  assert.match(email.html, /name="viewport"/);
  assert.match(email.html, /max-width:600px/);
  assert.ok(email.html.includes(`href="${email.ctaUrl}"`));
  // previzualizarea din Admin = același șablon
  assert.equal(renderInvitePreview().subject, email.subject);
});

test("fără link de dezabonare valid emailul nu pleacă; emailul de test are alt template în EmailLog", async () => {
  const saved = process.env.UNSUBSCRIBE_SECRET;
  process.env.UNSUBSCRIBE_SECRET = "";
  try {
    await assert.rejects(() => sendSecretSantaInviteEmail({ to: "a@exemplu.ro", campaignKey: KEY }), /unsubscribe_link_unavailable/);
  } finally {
    process.env.UNSUBSCRIBE_SECRET = saved;
  }
  assert.notEqual(secretSantaInviteTemplate(KEY), secretSantaInviteTemplate(KEY, { test: true }));
});

/* ============================== trimitere ============================== */

test("trimitere: fiecare eligibil primește exact un email; rezultatele se salvează; reîncercarea nu dublează", async () => {
  const db = fakeDb({ vendors: [vendor("a"), vendor("b"), vendor("c"), vendor("x", {}, { marketingOptIn: false })] });
  const { calls, send } = recordingSend();
  const first = await runInvite({ db, send, emailDelayMs: 0, now: NOW });
  assert.equal(first.sent, 3);
  assert.deepEqual(calls.map((c) => c.to).sort(), ["a@exemplu.ro", "b@exemplu.ro", "c@exemplu.ro"]);
  for (const c of calls) {
    assert.equal(c.campaignKey, KEY);
    assert.equal(c.ctaPath, "/secret-santa");
    assert.equal(c.test, undefined);
  }
  assert.ok(db.deliveries.every((d) => d.emailStatus === "SENT" && d.emailSentAt instanceof Date));

  const again = await runInvite({ db, send, emailDelayMs: 0, now: NOW });
  assert.equal(again.sent, 0);
  assert.equal(again.alreadySent, 3);
  assert.equal(calls.length, 3);

  const preview = await previewInvite({ db, now: NOW });
  assert.equal(preview.eligible, 3);
  assert.deepEqual(preview.counts, { toSend: 0, alreadySent: 3, unknown: 0, failedRetry: 0 });
  assert.equal(preview.willSend, 0);
  assert.equal(preview.results.sent, 3);
  assert.ok(preview.results.firstSentAt && preview.results.lastSentAt);
  assert.deepEqual(preview.excluded, [{ reason: "noMarketingConsent", label: "Fără acord pentru noutăți și oferte", count: 1 }]);
});

test("eșecuri: salvate cu motivul; la o nouă pornire se reîncearcă DOAR cele eșuate", async () => {
  const db = fakeDb({ vendors: [vendor("a"), vendor("b")] });
  const failing = recordingSend({ failFor: new Set(["b@exemplu.ro"]) });
  const first = await runInvite({ db, send: failing.send, emailDelayMs: 0, now: NOW });
  assert.equal(first.sent, 1);
  assert.equal(first.failed, 1);
  assert.deepEqual(first.failures, [{ email: "b@exemplu.ro", error: "smtp_down" }]);

  const preview = await previewInvite({ db, now: NOW });
  assert.equal(preview.results.failed, 1);
  assert.equal(preview.results.failures[0].error, "smtp_down");
  assert.equal(preview.willSend, 1);

  const ok = recordingSend();
  const retry = await runInvite({ db, send: ok.send, emailDelayMs: 0, now: NOW });
  assert.deepEqual(ok.calls.map((c) => c.to), ["b@exemplu.ro"]);
  assert.equal(retry.sent, 1);
  assert.equal(retry.alreadySent, 1);
});

test("plasă: emailul deja trimis (EmailLog SENT) sau o trimitere întreruptă nu se retrimit", async () => {
  const db = fakeDb({
    vendors: [vendor("a"), vendor("b")],
    emailLogs: [{ template: secretSantaInviteTemplate(KEY), toEmail: "a@exemplu.ro", status: "SENT", sentAt: new Date() }],
  });
  // „b” rămas în SENDING de la o rulare întreruptă
  await db.artfestBroadcastDelivery.upsert({ where: { campaignKey_vendorId: { campaignKey: KEY, vendorId: "b" } }, create: { campaignKey: KEY, vendorId: "b" } });
  Object.assign(db.deliveries[0], { emailStatus: "SENDING", updatedAt: new Date(NOW.getTime() - 60 * 60 * 1000) });

  const { calls, send } = recordingSend();
  const result = await runInvite({ db, send, emailDelayMs: 0, now: NOW });
  assert.equal(calls.length, 0);
  assert.equal(result.alreadySent, 1);
  assert.equal(result.unknown, 1);
  assert.equal(result.staleMarkedUnknown, 1);
});

test("emailul de test: o singură adresă, același mesaj, marcat test, fără evidență de campanie", async () => {
  const { calls, send } = recordingSend();
  const out = await sendTestInvite({ to: "  Eu@Exemplu.ro ", firstName: "Ana", send });
  assert.deepEqual(out, { ok: true, to: "eu@exemplu.ro" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].test, true);
  assert.equal(calls[0].ctaPath, "/secret-santa");
  assert.equal(calls[0].drawDateLabel, "5 decembrie 2026");
  await assert.rejects(() => sendTestInvite({ to: "nu-e-email", send }), { code: "invalid_fields" });
  await assert.rejects(() => sendTestInvite({ to: "x@exemplu.ro", send: async () => Promise.reject(new Error("unsubscribe_link_unavailable")) }), {
    code: "unsubscribe_unavailable",
  });
});

/* ============================== pornire din Admin ============================== */

test("pornire: confirmare obligatorie, numărul confirmat trebuie să fie cel actual, rulează în fundal, o singură rulare simultan", async () => {
  resetInviteRunState();
  const db = fakeDb({ vendors: [vendor("a"), vendor("b")] });
  try {
    await assert.rejects(() => startInvite({ db, confirm: false, expectedCount: 2, now: NOW }), { code: "confirmation_required" });
    await assert.rejects(() => startInvite({ db, confirm: true, expectedCount: 5, now: NOW }), { code: "count_changed" });
    await assert.rejects(() => startInvite({ db: fakeDb({ vendors: [vendor("a")], edition: null }), confirm: true, expectedCount: 1, now: NOW }), {
      code: "invite_not_available",
    });

    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const calls = [];
    const send = async (payload) => {
      calls.push(payload.to);
      await gate; // trimiterea „durează”: pornirea NU o așteaptă
    };
    const started = await startInvite({ db, confirm: true, expectedCount: 2, send, emailDelayMs: 0, now: NOW });
    assert.equal(started.started, true);
    assert.equal(started.status.running, true);
    const second = await startInvite({ db, confirm: true, expectedCount: 2, send, emailDelayMs: 0, now: NOW });
    assert.equal(second.started, false);
    assert.equal(second.reason, "already_running");

    release();
    await started.done;
    assert.deepEqual(calls.sort(), ["a@exemplu.ro", "b@exemplu.ro"]);
    await assert.rejects(() => startInvite({ db, confirm: true, expectedCount: 0, send, emailDelayMs: 0, now: NOW }), { code: "nothing_to_send" });
  } finally {
    resetInviteRunState();
  }
});

test("rute Admin: 401 fără sesiune, 403 pentru vânzător; adminul vede numărul, trimite testul și pornește trimiterea", async () => {
  resetInviteRunState();
  const { createSecretSantaRouters } = await import("../routes/secretSantaRoutes.js");
  const db = fakeDb({
    vendors: [vendor("a"), vendor("b")],
    users: { admin1: { id: "admin1", role: "ADMIN", firstName: "Admin" }, vend1: { id: "vend1", role: "VENDOR" } },
  });
  const sent = [];
  const sendInvite = async (payload) => {
    sent.push(payload);
  };
  const { adminRouter } = createSecretSantaRouters({ db, sendInvite, inviteDelayMs: 0 });
  const app = express();
  app.use(express.json());
  app.use("/api/admin/secret-santa", adminRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/admin/secret-santa`;
  // rolul din token nu contează: ruta verifică rolul în baza de date
  const bearer = (sub) => `Bearer ${jwt.sign({ sub, role: "ADMIN" }, process.env.JWT_SECRET)}`;
  const call = (method, path, as, body) =>
    fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...(as ? { Authorization: bearer(as) } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

  try {
    assert.equal((await call("GET", "/invite")).status, 401);
    assert.equal((await call("GET", "/invite", "vend1")).status, 403);
    assert.equal((await call("POST", "/invite/send", "vend1", { confirm: true, expectedCount: 2 })).status, 403);
    assert.equal((await call("POST", "/invite/test", "vend1", { email: "x@exemplu.ro" })).status, 403);

    const view = await call("GET", "/invite", "admin1");
    assert.equal(view.status, 200);
    assert.equal(view.body.eligible, 2);
    assert.equal(view.body.willSend, 2);
    assert.equal(view.body.email.subject, "🎁 Secret Santa Artfest – Înscrie-te până la extragerea din 5 decembrie!");

    const t = await call("POST", "/invite/test", "admin1", { email: "verific@exemplu.ro" });
    assert.equal(t.status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].test, true);
    assert.equal(sent[0].firstName, "Admin");
    assert.equal(db.deliveries.length, 0);

    const go = await call("POST", "/invite/send", "admin1", { confirm: true, expectedCount: 2 });
    assert.equal(go.status, 202);
    for (let i = 0; i < 50 && db.deliveries.filter((d) => d.emailStatus === "SENT").length < 2; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.deepEqual(sent.slice(1).map((s) => s.to).sort(), ["a@exemplu.ro", "b@exemplu.ro"]);
  } finally {
    resetInviteRunState();
    await new Promise((resolve) => server.close(resolve));
  }
});
