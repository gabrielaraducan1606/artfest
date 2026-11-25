// Artfest Creators, etapa 1a: profil (onboarding), rețele sociale, portofoliu,
// oferte cu versiuni, turul ghidat și moderarea din Admin. Rutele reale; DB în
// memorie, auth pe header, emailul simulat (fără emailuri reale, fără rețea).
//
// Rulare: node --experimental-test-module-mocks --test src/routes/creators.routes.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";
process.env.JWT_SECRET = "test-secret";

import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import sharp from "sharp";

import { createFakePrisma } from "../testkit/fakePrisma.js";

let fake;
const sentEmails = [];
let failEmails = false;
const uploads = [];

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
    enforceTokenVersion: (_req, _res, next) => next(),
  },
});

mock.module("../lib/mailer.js", {
  namedExports: {
    async sendCreatorProfileStatusEmail(payload) {
      if (failEmails) throw Object.assign(new Error("smtp_down"), { code: "smtp_down" });
      sentEmails.push(payload);
      return { messageId: `m_${sentEmails.length}` };
    },
  },
});

mock.module("../services/r2Storage.js", {
  namedExports: {
    buildPublicUrl: (key) => `https://cdn.test/${key}`,
    async uploadToR2({ folder, userId }) {
      const url = `https://cdn.test/${folder}/${userId}/${uploads.length + 1}.jpg`;
      uploads.push(url);
      return { url };
    },
  },
});

let server;
let base;
let ctx;
let service;
let termsStatus;

before(async () => {
  const creatorRoutes = (await import("./creatorRoutes.js")).default;
  const adminRoutes = (await import("./adminCreatorsRoutes.js")).default;
  service = await import("../services/creators/creatorProfileService.js");
  termsStatus = await import("../services/influencerTermsStatus.js");

  const app = express();
  app.use(express.json());
  app.use("/api/creator", creatorRoutes);
  app.use("/api/admin/creators", adminRoutes);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(async () => {
  sentEmails.length = 0;
  uploads.length = 0;
  failEmails = false;
  fake = createFakePrisma();

  const [newInf, oldInf, other, disabled, plain, vendor, admin] = fake.seed("user", [
    { email: "nou@t.ro", role: "INFLUENCER", status: "ACTIVE", firstName: "Ana", lastName: "Pop" },
    { email: "vechi@t.ro", role: "INFLUENCER", status: "ACTIVE", firstName: "Ion" },
    { email: "alt@t.ro", role: "INFLUENCER", status: "ACTIVE", firstName: "Dan" },
    { email: "off@t.ro", role: "INFLUENCER", status: "ACTIVE" },
    { email: "u@t.ro", role: "USER", status: "ACTIVE" },
    { email: "v@t.ro", role: "VENDOR", status: "ACTIVE" },
    { email: "adm@t.ro", role: "ADMIN", status: "ACTIVE" },
  ]);
  const [newProfile, oldProfile] = fake.seed("influencerProfile", [
    // invitat după lansare => onboarding automat
    { userId: newInf.id, displayName: "Ana Pop", referralCode: "ANA1", commissionBps: 1000, status: "ACTIVE", anonymizedAt: null, createdAt: new Date("2026-11-24T10:00:00Z") },
    // influencer vechi, cu perioada de afiliere (3 luni) EXPIRATĂ: Creators rămâne disponibil
    { userId: oldInf.id, displayName: "Ion", referralCode: "ION1", commissionBps: 700, status: "ACTIVE", anonymizedAt: null, createdAt: new Date("2025-01-10T10:00:00Z"), collaborationEndOverride: null },
    { userId: other.id, displayName: "Dan", referralCode: "DAN1", commissionBps: 500, status: "ACTIVE", anonymizedAt: null, createdAt: new Date("2026-11-12T10:00:00Z") },
    { userId: disabled.id, displayName: "Off", referralCode: "OFF1", commissionBps: 500, status: "DISABLED", anonymizedAt: null, createdAt: new Date("2026-11-12T10:00:00Z") },
  ]);
  ctx = { newInf, oldInf, other, disabled, plain, vendor, admin, newProfile, oldProfile };

  // acordul de influencer (versiunea curentă) acceptat - ca la înregistrarea prin invitație
  const { currentVersion } = await termsStatus.getInfluencerTermsStatus(newInf.id, { prisma: fake });
  ctx.termsVersion = currentVersion;
  fake.seed(
    "userConsent",
    [newInf, oldInf, other].map((u) => ({ userId: u.id, document: "INFLUENCER_TERMS", version: currentVersion, givenAt: new Date("2026-11-01T00:00:00Z") }))
  );
});

async function call(method, path, { as, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (as) headers["x-test-user"] = as.id;
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const C = "/api/creator";
const A = "/api/admin/creators";
const ownImage = (user, n = 1) => `https://cdn.test/creators/${user.id}/${n}.jpg`;

const STEP1 = (user) => ({
  displayName: "Ana Creează",
  bio: "Creez conținut despre decorațiuni handmade, cadouri și lifestyle de peste trei ani.",
  niches: ["lifestyle", "home_decor"],
  preferredCategories: ["cadouri_anime-manga", "home_lumanari-parfumate"],
  avatarUrl: ownImage(user),
});
const SOCIALS = [
  { platform: "INSTAGRAM", url: "https://www.instagram.com/ana.creeaza/", followersDeclared: 12500, avgViewsDeclared: 3000 },
  { platform: "tiktok", url: "https://www.tiktok.com/@ana.creeaza", handle: "@ana.creeaza", followersDeclared: 8000 },
];

// onboarding complet (3 pași) => profil gata de trimis
async function completeOnboarding(user) {
  await call("POST", `${C}/profile`, { as: user });
  assert.equal((await call("PATCH", `${C}/profile`, { as: user, body: STEP1(user) })).status, 200);
  assert.equal((await call("PUT", `${C}/profile/socials`, { as: user, body: { socials: SOCIALS } })).status, 200);
  const step3 = await call("PATCH", `${C}/profile`, { as: user, body: { acceptsProducts: true, acceptsPaid: true, typicalTurnaroundDays: 7 } });
  assert.equal(step3.status, 200);
  return step3.body.profile;
}

const profileOf = (user) => {
  const inf = fake.tables.influencerProfile.find((p) => p.userId === user.id);
  return fake.tables.creatorProfile.find((p) => p.influencerId === inf.id);
};
const eventsOf = (profileId, type) => fake.tables.creatorProfileEvent.filter((e) => e.profileId === profileId && (!type || e.type === type));

/* ============================== flag + acces ============================== */

test("fără feature flag: rutele există permanent, independent de mediu (influencer + Admin)", async () => {
  for (const legacy of ["", "0", "off"]) {
    process.env.CREATORS_ENABLED = legacy; // variabila veche nu mai are niciun efect
    process.env.VITE_CREATORS_ENABLED = legacy;
    assert.equal((await call("GET", `${C}/state`, { as: ctx.newInf })).status, 200);
    assert.equal((await call("GET", `${A}/profiles`, { as: ctx.admin })).status, 200);
  }
  delete process.env.CREATORS_ENABLED;
  delete process.env.VITE_CREATORS_ENABLED;
});

test("acces: neautentificat 401; USER / VENDOR / influencer dezactivat 403; Admin doar pentru ADMIN", async () => {
  assert.equal((await call("GET", `${C}/state`)).status, 401);
  assert.equal((await call("GET", `${C}/state`, { as: ctx.plain })).body.error, "influencer_required");
  assert.equal((await call("GET", `${C}/state`, { as: ctx.vendor })).status, 403);
  assert.equal((await call("GET", `${C}/state`, { as: ctx.disabled })).body.error, "influencer_inactive");
  assert.equal((await call("GET", `${A}/profiles`, { as: ctx.newInf })).status, 403);
  assert.equal((await call("GET", `${A}/profiles`, { as: ctx.admin })).status, 200);
  // contorul „în verificare” din Admin: doar ADMIN
  assert.equal((await call("GET", `${A}/pending-count`)).status, 401);
  assert.equal((await call("GET", `${A}/pending-count`, { as: ctx.newInf })).status, 403);
  assert.equal((await call("GET", `${A}/pending-count`, { as: ctx.vendor })).status, 403);
  assert.equal((await call("GET", `${A}/pending-count`, { as: ctx.admin })).status, 200);
});

/* ============================== intrarea în Creators ============================== */

test("influencer nou (invitat după lansare) => onboarding automat; cel existent => doar invitație de configurare", async () => {
  const fresh = await call("GET", `${C}/state`, { as: ctx.newInf });
  assert.deepEqual([fresh.body.entry, fresh.body.autoOnboarding], ["setup", true]);

  const existing = await call("GET", `${C}/state`, { as: ctx.oldInf });
  assert.deepEqual([existing.body.entry, existing.body.autoOnboarding], ["setup", false]);

  // variabila veche de mediu nu mai schimbă nimic: criteriul e data fixă din cod
  process.env.CREATORS_ONBOARDING_SINCE = "";
  assert.equal((await call("GET", `${C}/state`, { as: ctx.newInf })).body.autoOnboarding, true);
  process.env.CREATORS_ONBOARDING_SINCE = "2020-01-01T00:00:00Z";
  assert.equal((await call("GET", `${C}/state`, { as: ctx.oldInf })).body.autoOnboarding, false);
  delete process.env.CREATORS_ONBOARDING_SINCE;

  // prima intrare în configurare / „Completez mai târziu” creează ciorna => fără redirecționare repetată
  assert.equal((await call("POST", `${C}/profile`, { as: ctx.newInf })).status, 201);
  const later = await call("GET", `${C}/state`, { as: ctx.newInf });
  assert.deepEqual([later.body.entry, later.body.autoOnboarding], ["draft", false]);
});

test("data fixă de lansare (UTC): exact la ea = nou; o secundă înainte = existent", async () => {
  const { CREATORS_AUTO_ONBOARDING_SINCE, isNewCreatorsInfluencer } = await import("../config/creators.js");
  assert.equal(CREATORS_AUTO_ONBOARDING_SINCE.toISOString(), "2026-11-23T00:00:00.000Z");
  assert.equal(isNewCreatorsInfluencer(new Date("2026-11-23T00:00:00.000Z")), true);
  assert.equal(isNewCreatorsInfluencer(new Date("2026-11-22T23:59:59.000Z")), false);
  assert.equal(isNewCreatorsInfluencer(null), false);
  assert.equal(isNewCreatorsInfluencer("nu-e-dată"), false);
});

test("influencer existent cu afilierea expirată își creează profilul fără invitație nouă; afilierea rămâne neatinsă", async () => {
  const affiliateBefore = { ...ctx.oldProfile };
  const usersBefore = fake.tables.user.length;

  await completeOnboarding(ctx.oldInf);
  const submitted = await call("POST", `${C}/profile/submit`, { as: ctx.oldInf });
  assert.equal(submitted.status, 200);
  const profile = profileOf(ctx.oldInf);
  await call("POST", `${A}/profiles/${profile.id}/approve`, { as: ctx.admin });

  assert.equal(fake.tables.user.length, usersBefore, "niciun cont nou");
  assert.equal(fake.tables.influencerProfile.filter((p) => p.userId === ctx.oldInf.id).length, 1);
  const affiliateAfter = fake.tables.influencerProfile.find((p) => p.id === ctx.oldProfile.id);
  for (const key of ["status", "commissionBps", "referralCode", "collaborationEndOverride", "createdAt"]) {
    assert.deepEqual(affiliateAfter[key], affiliateBefore[key], key);
  }
  const state = await call("GET", `${C}/state`, { as: ctx.oldInf });
  assert.equal(state.body.profile.visibility.visible, true, "perioada de afiliere expirată nu ascunde profilul");
});

test("„Începe” / „Completez mai târziu” de două ori simultan => un singur profil", async () => {
  const [a, b] = await Promise.all([call("POST", `${C}/profile`, { as: ctx.newInf }), call("POST", `${C}/profile`, { as: ctx.newInf })]);
  assert.deepEqual([a.status, b.status], [201, 201]);
  assert.equal(fake.tables.creatorProfile.length, 1);
  assert.equal(a.body.entry, "draft");
  assert.equal(a.body.profile.displayName, "Ana Pop");
  assert.equal(a.body.profile.slug, "ana-pop");
  assert.equal(eventsOf(a.body.profile.id, "CREATED").length, 1);
});

/* ============================== onboarding + validări ============================== */

test("draft: se salvează parțial; problemele de publicare indică pasul; validări cu mesaje pe câmp", async () => {
  await call("POST", `${C}/profile`, { as: ctx.newInf });
  const partial = await call("PATCH", `${C}/profile`, { as: ctx.newInf, body: { bio: "Scurt" } });
  assert.equal(partial.status, 200);
  assert.equal(partial.body.profile.bio, "Scurt");
  assert.deepEqual(
    partial.body.profile.publishProblems.map((p) => [p.field, p.step]),
    [["avatarUrl", 1], ["bio", 1], ["niches", 1], ["socials", 2], ["collaboration", 3]]
  );
  assert.equal(partial.body.profile.canSubmit, false);

  const bad = await call("PATCH", `${C}/profile`, {
    as: ctx.newInf,
    body: { niches: ["hacking"], bio: "x".repeat(1501), typicalTurnaroundDays: 0, acceptsPaid: "da" },
  });
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(bad.body.fields).sort(), ["acceptsPaid", "bio", "niches", "typicalTurnaroundDays"]);

  // fotografia trebuie încărcată prin Artfest, în folderul propriu
  for (const avatarUrl of [ownImage(ctx.other), "https://evil.example/a.jpg", "javascript:alert(1)"]) {
    const res = await call("PATCH", `${C}/profile`, { as: ctx.newInf, body: { avatarUrl } });
    assert.equal(res.status, 400, avatarUrl);
    assert.ok(res.body.fields.avatarUrl);
  }
  assert.equal((await call("PATCH", `${C}/profile`, { as: ctx.newInf, body: { avatarUrl: ownImage(ctx.newInf) } })).status, 200);
});

test("versiune: o salvare dintr-un tab vechi (expectedVersion depășit) => 409, nimic suprascris", async () => {
  const created = await call("POST", `${C}/profile`, { as: ctx.newInf });
  const v = created.body.profile.version;
  assert.equal((await call("PATCH", `${C}/profile`, { as: ctx.newInf, body: { city: "Buzău", expectedVersion: v } })).status, 200);
  const stale = await call("PATCH", `${C}/profile`, { as: ctx.newInf, body: { city: "Iași", expectedVersion: v } });
  assert.equal(stale.status, 409);
  assert.equal(profileOf(ctx.newInf).city, "Buzău");
});

test("rețele sociale: doar https pe domeniile oficiale; numele contului din link; fără duplicate", async () => {
  await call("POST", `${C}/profile`, { as: ctx.newInf });
  const unsafe = [
    "javascript:alert(1)",
    "http://instagram.com/ana",
    "https://instagram.com.evil.ro/ana",
    "https://user:pass@instagram.com/ana",
    "https://instagram.com:8443/ana",
    "data:text/html,<b>x</b>",
  ];
  for (const url of unsafe) {
    const res = await call("PUT", `${C}/profile/socials`, { as: ctx.newInf, body: { socials: [{ platform: "INSTAGRAM", url, followersDeclared: 10 }] } });
    assert.equal(res.status, 400, url);
  }
  const dup = await call("PUT", `${C}/profile/socials`, { as: ctx.newInf, body: { socials: [SOCIALS[0], SOCIALS[0]] } });
  assert.equal(dup.status, 400);
  const noFollowers = await call("PUT", `${C}/profile/socials`, { as: ctx.newInf, body: { socials: [{ platform: "YOUTUBE", url: "https://www.youtube.com/@ana" }] } });
  assert.equal(noFollowers.status, 400);

  const ok = await call("PUT", `${C}/profile/socials`, { as: ctx.newInf, body: { socials: SOCIALS } });
  assert.equal(ok.status, 200);
  assert.deepEqual(
    ok.body.profile.socials.map((s) => [s.platform, s.handle, s.followersDeclared]),
    [["INSTAGRAM", "ana.creeaza", 12500], ["TIKTOK", "ana.creeaza", 8000]]
  );
});

test("portofoliu: fotografii doar proprii, linkuri doar spre platformele permise, maximum 12, ștergere doar din profilul propriu", async () => {
  await call("POST", `${C}/profile`, { as: ctx.newInf });
  await call("POST", `${C}/profile`, { as: ctx.other });

  assert.equal((await call("POST", `${C}/profile/portfolio`, { as: ctx.newInf, body: { kind: "IMAGE", title: "X", imageUrl: ownImage(ctx.other) } })).status, 400);
  assert.equal((await call("POST", `${C}/profile/portfolio`, { as: ctx.newInf, body: { kind: "LINK", title: "X", linkUrl: "https://bit.ly/abc" } })).status, 400);

  const img = await call("POST", `${C}/profile/portfolio`, { as: ctx.newInf, body: { kind: "IMAGE", title: "Colaborare", imageUrl: ownImage(ctx.newInf, 2) } });
  assert.equal(img.status, 201);
  const link = await call("POST", `${C}/profile/portfolio`, { as: ctx.newInf, body: { kind: "LINK", title: "Reel", linkUrl: "https://www.instagram.com/reel/abc/" } });
  assert.equal(link.status, 201);
  const itemId = link.body.profile.portfolio[1].id;

  // alt influencer nu poate șterge elementul (IDOR)
  assert.equal((await call("DELETE", `${C}/profile/portfolio/${itemId}`, { as: ctx.other })).status, 404);
  assert.equal((await call("DELETE", `${C}/profile/portfolio/${itemId}`, { as: ctx.newInf })).status, 200);

  for (let i = 0; i < 11; i += 1) {
    await call("POST", `${C}/profile/portfolio`, { as: ctx.newInf, body: { kind: "LINK", title: `R${i}`, linkUrl: "https://vimeo.com/1" } });
  }
  const full = await call("POST", `${C}/profile/portfolio`, { as: ctx.newInf, body: { kind: "LINK", title: "13", linkUrl: "https://vimeo.com/1" } });
  assert.equal(full.status, 409);
  assert.equal(full.body.error, "portfolio_full");
});

test("upload: fotografia ajunge în folderul propriu; fișierele care nu sunt imagini sunt refuzate", async () => {
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).png().toBuffer();
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), "a.png");
  const res = await fetch(`${base}${C}/uploads`, { method: "POST", headers: { "x-test-user": ctx.newInf.id }, body: form });
  assert.equal(res.status, 201);
  assert.ok((await res.json()).url.startsWith(`https://cdn.test/creators/${ctx.newInf.id}/`));

  const text = new FormData();
  text.append("file", new Blob(["nu e imagine"], { type: "text/plain" }), "a.txt");
  const rejected = await fetch(`${base}${C}/uploads`, { method: "POST", headers: { "x-test-user": ctx.newInf.id }, body: text });
  assert.equal(rejected.status, 400);

  const asUser = await fetch(`${base}${C}/uploads`, { method: "POST", headers: { "x-test-user": ctx.plain.id }, body: form });
  assert.equal(asUser.status, 403);
});

/* ============================== trimitere + moderare ============================== */

test("trimitere: incomplet => 400 cu pașii lipsă; complet => PENDING, Admin notificat, dublu click => o singură trimitere", async () => {
  await call("POST", `${C}/profile`, { as: ctx.newInf });
  const incomplete = await call("POST", `${C}/profile/submit`, { as: ctx.newInf });
  assert.equal(incomplete.status, 400);
  assert.equal(incomplete.body.error, "profile_incomplete");
  assert.ok(incomplete.body.problems.length >= 4);

  await completeOnboarding(ctx.newInf);
  const results = await Promise.all([call("POST", `${C}/profile/submit`, { as: ctx.newInf }), call("POST", `${C}/profile/submit`, { as: ctx.newInf })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const profile = profileOf(ctx.newInf);
  assert.equal(profile.status, "PENDING");
  assert.equal(eventsOf(profile.id, "SUBMITTED").length, 1);
  assert.ok(profile.onboardingCompletedAt instanceof Date);

  const adminNotes = fake.tables.notification.filter((n) => n.userId === ctx.admin.id);
  assert.equal(adminNotes.length, 1);
  // Admin → Marketing → Influenceri → Profiluri Creators, cu profilul deschis; numele profilului în text
  assert.equal(adminNotes[0].link, `/admin/marketing?tab=influencers&sub=creators&profile=${encodeURIComponent(profile.id)}`);
  assert.match(adminNotes[0].body, new RegExp(profile.displayName));

  // contorul real: profilul trimis apare în „în verificare”
  const pendingNow = fake.tables.creatorProfile.filter((p) => p.status === "PENDING").length;
  assert.equal((await call("GET", `${A}/pending-count`, { as: ctx.admin })).body.pending, pendingNow);
  assert.ok(pendingNow >= 1);

  // retrimiterea aceleiași cereri (încă în verificare) => refuzată, fără notificare nouă
  assert.equal((await call("POST", `${C}/profile/submit`, { as: ctx.newInf })).body.error, "already_pending");
  assert.equal(fake.tables.notification.filter((n) => n.userId === ctx.admin.id).length, 1);

  // în verificare: conținutul nu se poate schimba, preferințele da
  assert.equal((await call("PATCH", `${C}/profile`, { as: ctx.newInf, body: { bio: "Alt text ".repeat(10) } })).body.error, "profile_pending");
  assert.equal((await call("PATCH", `${C}/profile`, { as: ctx.newInf, body: { availableForCollabs: false } })).status, 200);
});

test("aprobare: versiunea trimisă devine publică; notificare + email o singură dată, fără date private", async () => {
  await completeOnboarding(ctx.newInf);
  await call("POST", `${C}/profile/submit`, { as: ctx.newInf });
  const profile = profileOf(ctx.newInf);

  const pendingBefore = (await call("GET", `${A}/pending-count`, { as: ctx.admin })).body.pending;
  const approved = await call("POST", `${A}/profiles/${profile.id}/approve`, { as: ctx.admin });
  assert.equal(approved.status, 200);
  // contorul scade după decizie
  assert.equal((await call("GET", `${A}/pending-count`, { as: ctx.admin })).body.pending, pendingBefore - 1);
  assert.equal(approved.body.profile.status, "APPROVED");
  const snapshot = profileOf(ctx.newInf).approvedSnapshot;
  assert.equal(snapshot.displayName, "Ana Creează");
  assert.equal(snapshot.socials.length, 2);
  assert.doesNotMatch(JSON.stringify(snapshot), /nou@t\.ro|referral|commission|iban/i);

  const [event] = eventsOf(profile.id, "APPROVED");
  assert.equal(event.actorUserId, ctx.admin.id);
  assert.equal(event.emailStatus, "SENT");
  assert.equal(sentEmails.length, 1);
  assert.deepEqual([sentEmails[0].to, sentEmails[0].kind, sentEmails[0].idempotencyKey], ["nou@t.ro", "approved", `creator_profile_event:${event.id}`]);
  const notes = fake.tables.notification.filter((n) => n.userId === ctx.newInf.id);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].link, "/influencer/creatori");

  // retry / redeclanșare => niciun email sau notificare în plus
  await service.deliverProfileEventNotification({ eventId: event.id, db: fake });
  await service.retryCreatorProfileEmails({ db: fake, now: new Date(Date.now() + 3_600_000) });
  assert.equal(sentEmails.length, 1);
  assert.equal(fake.tables.notification.filter((n) => n.userId === ctx.newInf.id).length, 1);

  // aprobarea de două ori => 409
  assert.equal((await call("POST", `${A}/profiles/${profile.id}/approve`, { as: ctx.admin })).status, 409);

  const state = await call("GET", `${C}/state`, { as: ctx.newInf });
  assert.equal(state.body.entry, "approved");
  assert.equal(state.body.profile.visibility.visible, true);
});

test("profil aprobat editat: versiunea publică rămâne până la o nouă aprobare; revenirea la textul aprobat anulează modificarea", async () => {
  await completeOnboarding(ctx.newInf);
  await call("POST", `${C}/profile/submit`, { as: ctx.newInf });
  const profile = profileOf(ctx.newInf);
  await call("POST", `${A}/profiles/${profile.id}/approve`, { as: ctx.admin });

  const edited = await call("PATCH", `${C}/profile`, { as: ctx.newInf, body: { displayName: "Ana Nou" } });
  assert.equal(edited.body.profile.hasUnpublishedChanges, true);
  assert.equal(profileOf(ctx.newInf).approvedSnapshot.displayName, "Ana Creează", "publicul vede tot versiunea aprobată");

  // adresa (slug) nu se mai schimbă după publicare
  assert.equal((await call("PATCH", `${C}/profile`, { as: ctx.newInf, body: { slug: "alt-slug" } })).body.error, "slug_locked");

  const reverted = await call("PATCH", `${C}/profile`, { as: ctx.newInf, body: { displayName: "Ana Creează" } });
  assert.equal(reverted.body.profile.hasUnpublishedChanges, false);
  assert.equal((await call("POST", `${C}/profile/submit`, { as: ctx.newInf })).body.error, "nothing_to_submit");

  // preferințele nu cer moderare
  const pref = await call("PATCH", `${C}/profile`, { as: ctx.newInf, body: { acceptsPaid: false } });
  assert.equal(pref.body.profile.hasUnpublishedChanges, false);

  await call("PATCH", `${C}/profile`, { as: ctx.newInf, body: { displayName: "Ana Nou" } });
  const resubmitted = await call("POST", `${C}/profile/submit`, { as: ctx.newInf });
  assert.equal(resubmitted.body.entry, "pending");
  assert.equal(resubmitted.body.profile.visibility.visible, true, "rămâne vizibil cu versiunea aprobată anterior");
});

test("modificări solicitate: motiv obligatoriu; influencerul vede mesajul, corectează și retrimite", async () => {
  await completeOnboarding(ctx.newInf);
  await call("POST", `${C}/profile/submit`, { as: ctx.newInf });
  const profile = profileOf(ctx.newInf);

  assert.equal((await call("POST", `${A}/profiles/${profile.id}/request-changes`, { as: ctx.admin, body: {} })).status, 400);
  const res = await call("POST", `${A}/profiles/${profile.id}/request-changes`, { as: ctx.admin, body: { reason: "Adaugă o fotografie mai clară." } });
  assert.equal(res.status, 200);
  assert.equal(sentEmails.at(-1).kind, "changes_requested");
  assert.equal(sentEmails.at(-1).message, "Adaugă o fotografie mai clară.");

  const state = await call("GET", `${C}/state`, { as: ctx.newInf });
  assert.equal(state.body.entry, "changes_requested");
  assert.equal(state.body.profile.moderationMessage, "Adaugă o fotografie mai clară.");
  assert.equal(state.body.profile.canEditContent, true);

  await call("PATCH", `${C}/profile`, { as: ctx.newInf, body: { avatarUrl: ownImage(ctx.newInf, 5) } });
  assert.equal((await call("POST", `${C}/profile/submit`, { as: ctx.newInf })).status, 200);
  assert.equal(profileOf(ctx.newInf).moderationMessage, null);
});

test("respingere: doar profiluri niciodată publicate, cu motiv; după respingere nu se mai editează / retrimite", async () => {
  await completeOnboarding(ctx.newInf);
  await call("POST", `${C}/profile/submit`, { as: ctx.newInf });
  const profile = profileOf(ctx.newInf);

  const res = await call("POST", `${A}/profiles/${profile.id}/reject`, { as: ctx.admin, body: { reason: "Conținut în afara tematicii." } });
  assert.equal(res.status, 200);
  assert.equal(sentEmails.at(-1).kind, "rejected");
  assert.equal((await call("PATCH", `${C}/profile`, { as: ctx.newInf, body: { bio: "x".repeat(60) } })).body.error, "profile_rejected");
  assert.equal((await call("POST", `${C}/profile/submit`, { as: ctx.newInf })).body.error, "profile_rejected");

  // un profil publicat nu se respinge (se cer modificări sau se suspendă)
  await completeOnboarding(ctx.oldInf);
  await call("POST", `${C}/profile/submit`, { as: ctx.oldInf });
  const old = profileOf(ctx.oldInf);
  await call("POST", `${A}/profiles/${old.id}/approve`, { as: ctx.admin });
  await call("PATCH", `${C}/profile`, { as: ctx.oldInf, body: { displayName: "Ion Nou" } });
  await call("POST", `${C}/profile/submit`, { as: ctx.oldInf });
  const rejectPublished = await call("POST", `${A}/profiles/${old.id}/reject`, { as: ctx.admin, body: { reason: "x y z" } });
  assert.equal(rejectPublished.status, 409);
});

test("suspendare: motiv obligatoriu, profilul dispare din public, influencerul nu poate edita; reactivare", async () => {
  await completeOnboarding(ctx.newInf);
  await call("POST", `${C}/profile/submit`, { as: ctx.newInf });
  const profile = profileOf(ctx.newInf);
  await call("POST", `${A}/profiles/${profile.id}/approve`, { as: ctx.admin });

  assert.equal((await call("POST", `${A}/profiles/${profile.id}/suspend`, { as: ctx.admin, body: {} })).status, 400);
  assert.equal((await call("POST", `${A}/profiles/${profile.id}/suspend`, { as: ctx.admin, body: { reason: "Raportări repetate." } })).status, 200);
  assert.equal(sentEmails.at(-1).kind, "suspended");
  let state = await call("GET", `${C}/state`, { as: ctx.newInf });
  assert.deepEqual(state.body.profile.visibility, { visible: false, reason: "suspended" });
  assert.equal((await call("PATCH", `${C}/profile`, { as: ctx.newInf, body: { displayName: "Alt nume" } })).body.error, "profile_suspended");

  assert.equal((await call("POST", `${A}/profiles/${profile.id}/unsuspend`, { as: ctx.admin })).status, 200);
  state = await call("GET", `${C}/state`, { as: ctx.newInf });
  assert.equal(state.body.profile.visibility.visible, true);
  // istoric complet, cu autor
  assert.deepEqual(eventsOf(profile.id).map((e) => e.type), ["CREATED", "SUBMITTED", "APPROVED", "SUSPENDED", "UNSUSPENDED"]);
});

test("pauză temporară (influencer): ascunde profilul fără moderare; reluare", async () => {
  await completeOnboarding(ctx.newInf);
  await call("POST", `${C}/profile/submit`, { as: ctx.newInf });
  await call("POST", `${A}/profiles/${profileOf(ctx.newInf).id}/approve`, { as: ctx.admin });

  const paused = await call("POST", `${C}/profile/pause`, { as: ctx.newInf, body: { paused: true } });
  assert.deepEqual(paused.body.profile.visibility, { visible: false, reason: "paused" });
  const resumed = await call("POST", `${C}/profile/pause`, { as: ctx.newInf, body: { paused: false } });
  assert.equal(resumed.body.profile.visibility.visible, true);
});

test("email eșuat: rămâne FAILED, se reia o singură dată reușit; fără destinatar duplicat", async () => {
  await completeOnboarding(ctx.newInf);
  await call("POST", `${C}/profile/submit`, { as: ctx.newInf });
  const profile = profileOf(ctx.newInf);

  failEmails = true;
  assert.equal((await call("POST", `${A}/profiles/${profile.id}/approve`, { as: ctx.admin })).status, 200, "aprobarea reușește chiar dacă emailul eșuează");
  const [event] = eventsOf(profile.id, "APPROVED");
  assert.deepEqual([event.emailStatus, event.emailAttempts, event.emailError], ["FAILED", 1, "smtp_down"]);

  failEmails = false;
  const later = new Date(Date.now() + 3_600_000);
  await Promise.all([service.retryCreatorProfileEmails({ db: fake, now: later }), service.retryCreatorProfileEmails({ db: fake, now: later })]);
  assert.equal(sentEmails.length, 1);
  assert.equal(eventsOf(profile.id, "APPROVED")[0].emailStatus, "SENT");
  // notificarea în aplicație a fost creată o singură dată (dedupeKey)
  assert.equal(fake.tables.notification.filter((n) => n.userId === ctx.newInf.id).length, 1);
});

const OFFER_FOR_GATE = { title: "Reel", platform: "INSTAGRAM", contentType: "REEL", deliverables: [{ type: "REEL", count: 1 }], turnaroundDays: 7, type: "BARTER" };

test("acordul de influencer neacceptat => 428 la trimiterea profilului și la oferte (ca la coduri / colecții); draftul rămâne posibil", async () => {
  await completeOnboarding(ctx.newInf);
  fake.tables.userConsent = fake.tables.userConsent.filter((c) => c.userId !== ctx.newInf.id);
  const submit = await call("POST", `${C}/profile/submit`, { as: ctx.newInf });
  assert.equal(submit.status, 428);
  assert.equal(submit.body.error, "influencer_terms_acceptance_required");
  assert.equal((await call("POST", `${C}/offers`, { as: ctx.newInf, body: OFFER_FOR_GATE })).status, 428);
  assert.equal(profileOf(ctx.newInf).status, "DRAFT");
  assert.equal((await call("PATCH", `${C}/profile`, { as: ctx.newInf, body: { city: "Cluj" } })).status, 200);
});

/* ============================== turul ghidat ============================== */

test("tur: apare după onboarding, dispare după finalizare / omitere (per versiune)", async () => {
  await completeOnboarding(ctx.newInf);
  assert.equal((await call("GET", `${C}/state`, { as: ctx.newInf })).body.profile.tour.shouldShow, false, "nu înainte de finalizarea configurării");

  await call("POST", `${C}/profile/submit`, { as: ctx.newInf });
  assert.equal((await call("GET", `${C}/state`, { as: ctx.newInf })).body.profile.tour.shouldShow, true);

  assert.equal((await call("POST", `${C}/tour`, { as: ctx.newInf, body: { version: 99 } })).status, 400);
  const seen = await call("POST", `${C}/tour`, { as: ctx.newInf, body: { version: 1 } });
  assert.equal(seen.body.tour.shouldShow, false);
  assert.equal((await call("GET", `${C}/state`, { as: ctx.newInf })).body.profile.tour.shouldShow, false);
  // a doua marcare (ex. reluare manuală + finalizare) e idempotentă
  assert.equal((await call("POST", `${C}/tour`, { as: ctx.newInf, body: { version: 1 } })).status, 200);
});

/* ============================== oferte ============================== */

const OFFER = {
  title: "Reel + 3 Story-uri",
  platform: "INSTAGRAM",
  contentType: "REEL",
  deliverables: [{ type: "REEL", count: 1 }, { type: "STORY", count: 3 }],
  turnaroundDays: 7,
  type: "PAID",
  creatorFee: "199,50",
  conditions: "Termenul curge de la primirea produsului.",
};

test("oferte: remunerația în bani exacți; editarea creează versiune nouă, cea veche rămâne neschimbată", async () => {
  await completeOnboarding(ctx.newInf);
  const created = await call("POST", `${C}/offers`, { as: ctx.newInf, body: OFFER });
  assert.equal(created.status, 201);
  assert.equal(created.body.item.creatorFeeCents, 19950);
  assert.equal(created.body.item.version, 1);
  const id = created.body.item.id;

  // fără schimbări reale => nicio versiune nouă
  await call("PUT", `${C}/offers/${id}`, { as: ctx.newInf, body: OFFER });
  assert.equal(fake.tables.creatorOfferVersion.length, 1);

  const edited = await call("PUT", `${C}/offers/${id}`, { as: ctx.newInf, body: { ...OFFER, creatorFee: 250, expectedVersion: 1 } });
  assert.equal(edited.body.item.version, 2);
  assert.equal(edited.body.item.creatorFeeCents, 25000);
  const v1 = fake.tables.creatorOfferVersion.find((v) => v.offerId === id && v.version === 1);
  assert.equal(v1.creatorFeeCents, 19950, "versiunea acceptată anterior nu se schimbă retroactiv");

  // editare dintr-un tab vechi
  assert.equal((await call("PUT", `${C}/offers/${id}`, { as: ctx.newInf, body: { ...OFFER, creatorFee: 300, expectedVersion: 1 } })).status, 409);

  const barter = await call("POST", `${C}/offers`, { as: ctx.newInf, body: { ...OFFER, type: "BARTER", creatorFee: "500" } });
  assert.equal(barter.body.item.creatorFeeCents, null);
  assert.equal(barter.body.item.acceptsProduct, true);

  for (const bad of [{ creatorFee: "0" }, { creatorFee: "12.345" }, { creatorFee: "abc" }, { deliverables: [] }, { platform: "MYSPACE" }]) {
    assert.equal((await call("POST", `${C}/offers`, { as: ctx.newInf, body: { ...OFFER, ...bad } })).status, 400, JSON.stringify(bad));
  }
});

test("oferte: alt influencer nu le poate modifica; dezactivarea de către Admin nu poate fi anulată de influencer", async () => {
  await completeOnboarding(ctx.newInf);
  await call("POST", `${C}/profile`, { as: ctx.other });
  const { body } = await call("POST", `${C}/offers`, { as: ctx.newInf, body: OFFER });
  const id = body.item.id;

  assert.equal((await call("PUT", `${C}/offers/${id}`, { as: ctx.other, body: OFFER })).status, 404);
  assert.equal((await call("POST", `${C}/offers/${id}/active`, { as: ctx.other, body: { active: false } })).status, 404);

  assert.equal((await call("POST", `${C}/offers/${id}/active`, { as: ctx.newInf, body: { active: false } })).body.item.isActive, false);
  assert.equal((await call("POST", `${C}/offers/${id}/active`, { as: ctx.newInf, body: { active: true } })).body.item.isActive, true);

  const profile = profileOf(ctx.newInf);
  assert.equal((await call("POST", `${A}/profiles/${profile.id}/offers/${id}/deactivate`, { as: ctx.admin, body: {} })).status, 400);
  assert.equal((await call("POST", `${A}/profiles/${profile.id}/offers/${id}/deactivate`, { as: ctx.admin, body: { reason: "Text nepotrivit." } })).status, 200);
  const blocked = await call("POST", `${C}/offers/${id}/active`, { as: ctx.newInf, body: { active: true } });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, "offer_disabled_by_admin");
});

/* ============================== Admin: listă + detaliu ============================== */

test("Admin: listă filtrată pe status, paginată; detaliul arată versiunea publicată vs. cea trimisă și contul", async () => {
  await completeOnboarding(ctx.newInf);
  await call("POST", `${C}/profile/submit`, { as: ctx.newInf });
  await call("POST", `${C}/profile`, { as: ctx.oldInf });

  const pending = await call("GET", `${A}/profiles?status=PENDING`, { as: ctx.admin });
  assert.equal(pending.body.total, 1);
  assert.equal(pending.body.pendingCount, 1);
  assert.equal((await call("GET", `${A}/profiles`, { as: ctx.admin })).body.total, 2);
  assert.equal((await call("GET", `${A}/profiles?status=NOPE`, { as: ctx.admin })).status, 400);

  const id = pending.body.items[0].id;
  const detail = await call("GET", `${A}/profiles/${id}`, { as: ctx.admin });
  assert.equal(detail.body.account.email, "nou@t.ro");
  assert.equal(detail.body.profile.approvedSnapshot, null);
  assert.equal(detail.body.profile.submittedSnapshot.displayName, "Ana Creează");
  assert.deepEqual(detail.body.actions, { canApprove: true, canRequestChanges: true, canReject: true, canSuspend: false, canUnsuspend: false });
  assert.equal((await call("POST", `${A}/profiles/${id}/delete`, { as: ctx.admin })).status, 404);
});

test("opțiuni: platformele includ toate domeniile acceptate + limita minimă a numelui (validarea locală din interfață)", async () => {
  const { creatorOptions, SOCIAL_PLATFORMS, CREATOR_LIMITS } = await import("../config/creators.js");
  const options = creatorOptions();
  for (const p of options.platforms) {
    assert.deepEqual(p.hosts, SOCIAL_PLATFORMS[p.value].hosts);
    assert.equal(p.host, SOCIAL_PLATFORMS[p.value].hosts[0]);
  }
  assert.equal(options.limits.displayNameMin, CREATOR_LIMITS.displayNameMin);
  assert.equal(options.limits.bioMin, CREATOR_LIMITS.bioMin);
});

/* ============================== categoriile din catalog ============================== */

test("categorii: o valoare nouă trebuie să fie o categorie reală din catalog; grupele vechi / invenții sunt refuzate", async () => {
  await call("POST", `${C}/profile`, { as: ctx.newInf });
  for (const bad of [["decor"], ["party"], ["servicii_dj"], ["inventata"]]) {
    const r = await call("PATCH", `${C}/profile`, { as: ctx.newInf, body: { preferredCategories: bad } });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.ok(r.body.fields?.preferredCategories);
  }
  const ok = await call("PATCH", `${C}/profile`, { as: ctx.newInf, body: { preferredCategories: ["cadouri_anime-manga"] } });
  assert.equal(ok.status, 200);
  assert.deepEqual(profileOf(ctx.newInf).preferredCategories, ["cadouri_anime-manga"]);
});

test("categorii vechi deja salvate: rămân, nu blochează editarea și se pierd doar dacă influencerul le scoate", async () => {
  await call("POST", `${C}/profile`, { as: ctx.oldInf });
  const profile = profileOf(ctx.oldInf);
  profile.preferredCategories = ["decor", "party", "cadouri_anime-manga"]; // selecții salvate înainte (grupe vechi)

  // editarea altui câmp nu le atinge
  assert.equal((await call("PATCH", `${C}/profile`, { as: ctx.oldInf, body: { city: "Cluj-Napoca" } })).status, 200);
  assert.deepEqual(profileOf(ctx.oldInf).preferredCategories, ["decor", "party", "cadouri_anime-manga"]);

  // salvarea pasului cu aceleași valori (inclusiv cele vechi) + o categorie nouă din catalog: acceptată
  const r = await call("PATCH", `${C}/profile`, { as: ctx.oldInf, body: { preferredCategories: ["decor", "party", "cadouri_anime-manga", "home_lumanari-parfumate"] } });
  assert.equal(r.status, 200);
  assert.deepEqual(profileOf(ctx.oldInf).preferredCategories, ["decor", "party", "cadouri_anime-manga", "home_lumanari-parfumate"]);

  // scoasă explicit => dispare; nu mai poate fi adăugată din nou (nu mai e în catalog)
  assert.equal((await call("PATCH", `${C}/profile`, { as: ctx.oldInf, body: { preferredCategories: ["party", "cadouri_anime-manga"] } })).status, 200);
  assert.equal((await call("PATCH", `${C}/profile`, { as: ctx.oldInf, body: { preferredCategories: ["decor", "party"] } })).status, 400);
  assert.deepEqual(profileOf(ctx.oldInf).preferredCategories, ["party", "cadouri_anime-manga"]);
});

test("opțiuni: toate categoriile active din catalog (inclusiv cele fără produse), cu gruparea oficială", async () => {
  const { CATEGORIES } = await import("../constants/categories.js");
  assert.equal(fake.tables.product?.length || 0, 0, "catalogul de test nu are niciun produs");
  for (const [path, who] of [[`${C}/options`, ctx.newInf], [`${A}/options`, ctx.admin]]) {
    const r = await call("GET", path, { as: who });
    assert.equal(r.status, 200, path);
    const values = r.body.categories.map((c) => c.value);
    assert.deepEqual(values, CATEGORIES.filter((k) => values.includes(k)));
    assert.equal(values.length, CATEGORIES.length, path);
    for (const key of ["papetarie_invitatii-nunta", "papetarie_invitatii-botez", "cadouri_anime-manga"]) assert.ok(values.includes(key), key);
    assert.ok(r.body.categories.every((c) => c.groupLabel));
    assert.equal(r.body.categoryLabels.party, "Candy bar & party");
  }
});

test("selecție mixtă salvată: grupă întreagă + excludere + categorie; limita de 6 (grupa = una)", async () => {
  await call("POST", `${C}/profile`, { as: ctx.newInf });
  const mixed = ["group:bijuterii", "exclude:bijuterii_cercei", "cadouri_anime-manga"];
  const ok = await call("PATCH", `${C}/profile`, { as: ctx.newInf, body: { preferredCategories: mixed } });
  assert.equal(ok.status, 200);
  assert.deepEqual(profileOf(ctx.newInf).preferredCategories, mixed);
  assert.deepEqual(ok.body.profile.preferredCategories, mixed);

  const six = ["group:decor", "group:papetarie", "group:ceremonie", "group:home", "group:bijuterii", "cadouri_anime-manga"];
  assert.equal((await call("PATCH", `${C}/profile`, { as: ctx.newInf, body: { preferredCategories: six } })).status, 200);
  const seven = await call("PATCH", `${C}/profile`, { as: ctx.newInf, body: { preferredCategories: [...six, "group:arta"] } });
  assert.equal(seven.status, 400);
  assert.match(seven.body.fields.preferredCategories, /o grupă întreagă contează ca una/);
  assert.deepEqual(profileOf(ctx.newInf).preferredCategories, six);
});

/* ============================== pasul 3: tarif orientativ + limbi ============================== */

test("tarif orientativ: opțional, lei cu zecimale, salvat și recuperat; nu atinge moderarea și nu e public", async () => {
  await call("POST", `${C}/profile`, { as: ctx.newInf });
  let r = await call("PATCH", `${C}/profile`, { as: ctx.newInf, body: { acceptsProducts: false, acceptsPaid: true, indicativeFee: "249,90" } });
  assert.equal(r.status, 200);
  assert.equal(profileOf(ctx.newInf).indicativeFeeCents, 24990);
  assert.equal(r.body.profile.indicativeFeeCents, 24990);
  assert.equal((await call("GET", `${C}/state`, { as: ctx.newInf })).body.profile.indicativeFeeCents, 24990);

  for (const [input, cents] of [["250", 25000], ["1.5", 150], [99.9, 9990], ["1 000", 100000]]) {
    r = await call("PATCH", `${C}/profile`, { as: ctx.newInf, body: { indicativeFee: input } });
    assert.equal(r.status, 200, String(input));
    assert.equal(profileOf(ctx.newInf).indicativeFeeCents, cents, String(input));
  }
  for (const bad of ["0", "-5", "abc", "12,345", "0,50", "100000,01", "1e5"]) {
    r = await call("PATCH", `${C}/profile`, { as: ctx.newInf, body: { indicativeFee: bad } });
    assert.equal(r.status, 400, bad);
    assert.ok(r.body.fields?.indicativeFee, bad);
  }
  assert.equal(profileOf(ctx.newInf).indicativeFeeCents, 100000, "o valoare invalidă nu suprascrie tariful salvat");

  // „Produse gratuite” fără câmpul trimis: tariful rămâne (revenirea la „plătită” îl regăsește)
  await call("PATCH", `${C}/profile`, { as: ctx.newInf, body: { acceptsProducts: true, acceptsPaid: false } });
  assert.equal(profileOf(ctx.newInf).indicativeFeeCents, 100000);
  // golit explicit => fără tarif
  await call("PATCH", `${C}/profile`, { as: ctx.newInf, body: { indicativeFee: "" } });
  assert.equal(profileOf(ctx.newInf).indicativeFeeCents, null);

  // preferință: fără modificări nepublicate / moderare; nu apare în copia publică
  const p = profileOf(ctx.newInf);
  assert.equal(p.hasUnpublishedChanges, false);
  const { buildPublicSnapshot } = await import("../services/creators/creatorProfileService.js");
  assert.equal("indicativeFeeCents" in buildPublicSnapshot({ ...p, indicativeFeeCents: 5000 }), false);
});

test("tariful orientativ nu schimbă tarifele ofertelor existente", async () => {
  await completeOnboarding(ctx.newInf);
  const created = await call("POST", `${C}/offers`, { as: ctx.newInf, body: OFFER });
  assert.equal(created.status, 201);
  await call("PATCH", `${C}/profile`, { as: ctx.newInf, body: { indicativeFee: "999" } });
  const offers = await call("GET", `${C}/offers`, { as: ctx.newInf });
  const item = (offers.body.items || []).find((o) => o.id === created.body.item.id);
  assert.equal(item.creatorFeeCents, 19950);
});

test("limba conținutului: doar Română / Engleză; „Maghiară” salvată anterior se păstrează și nu blochează salvarea", async () => {
  const { body } = await call("GET", `${C}/options`, { as: ctx.newInf });
  assert.deepEqual(body.languages.map((l) => l.value), ["ro", "en"]);

  await call("POST", `${C}/profile`, { as: ctx.newInf });
  assert.equal((await call("PATCH", `${C}/profile`, { as: ctx.newInf, body: { contentLanguages: ["ro", "hu"] } })).status, 400, "valoare nouă «hu» refuzată");

  await call("POST", `${C}/profile`, { as: ctx.oldInf });
  profileOf(ctx.oldInf).contentLanguages = ["ro", "hu"]; // salvată înainte
  assert.equal((await call("PATCH", `${C}/profile`, { as: ctx.oldInf, body: { contentLanguages: ["ro", "hu"], typicalTurnaroundDays: 5 } })).status, 200);
  assert.deepEqual(profileOf(ctx.oldInf).contentLanguages, ["ro", "hu"]);
  assert.equal((await call("PATCH", `${C}/profile`, { as: ctx.oldInf, body: { contentLanguages: ["ro"] } })).status, 200);
  assert.deepEqual(profileOf(ctx.oldInf).contentLanguages, ["ro"]);
});
