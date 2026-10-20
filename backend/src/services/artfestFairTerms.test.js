// Teste: termsVersion + termsUrl se setează doar împreună, doar pentru o versiune
// publicată; linkul ajunge la vendor doar dacă e consistent; înscrierea salvează
// exact versiunea de la momentul acceptării.
// Registrul de versiuni e simulat (mock) - fișierele reale din legal/ nu se ating.
//
// Rulare: node --experimental-test-module-mocks --test src/services/artfestFairTerms.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";

import { test, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFakePrisma } from "../testkit/fakePrisma.js";

let fake;
// versiunile „publicate” în registrul simulat
let published = new Set();

mock.module("../db.js", {
  namedExports: { prisma: new Proxy({}, { get: (_t, key) => fake[key] }) },
});

const normalize = (raw) => {
  const v = String(raw || "").trim().replace(/^v/i, "");
  return /^\d+\.\d+\.\d+$/.test(v) ? v : null;
};
const publicPath = (v) => `/targ-artfest/regulament/v${v}`;
mock.module("../lib/artfestFairRules.js", {
  namedExports: {
    FAIR_RULES_TITLE: "Regulamentul",
    normalizeFairRulesVersion: normalize,
    fairRulesPublicPath: publicPath,
    isFairRulesVersionPublished: (v) => published.has(normalize(v)),
    fairRulesUrlForAcceptedVersion: (v) => (published.has(normalize(v)) ? publicPath(normalize(v)) : null),
    loadPublishedFairRules: (v) => (published.has(normalize(v)) ? { version: normalize(v), title: "Regulamentul", html: "<p/>" } : null),
  },
});

let terms;
let fairSvc;

before(async () => {
  terms = await import("./artfestFairTermsService.js");
  fairSvc = await import("./artfestFairService.js");
});

let ctx;
beforeEach(() => {
  fake = createFakePrisma();
  published = new Set();
  const [user] = fake.seed("user", [{ email: "v@t.ro", role: "VENDOR" }]);
  const [vendor] = fake.seed("vendor", [{ userId: user.id, displayName: "Atelier", isActive: true }]);
  // magazin activat, cu profil valid (înscrierea îl cere)
  const [service] = fake.seed("vendorService", [{ vendorId: vendor.id, status: "ACTIVE", isActive: true }]);
  fake.seed("serviceProfile", [{ serviceId: service.id, displayName: "Atelier", slug: "atelier", logoUrl: "https://cdn.test/a.png" }]);
  const [fair] = fake.seed("artfestFair", [{ key: "CHRISTMAS_FAIR_BUZAU_2026", title: "Târg", termsVersion: null, termsUrl: null }]);
  ctx = { user, vendor, fair };
});

const fairRow = () => fake.tables.artfestFair[0];

test("starea perechii: none / linked / inconsistent", () => {
  assert.equal(terms.termsPairState(null, null), "none");
  assert.equal(terms.termsPairState("1.0.0", "/targ-artfest/regulament/v1.0.0"), "linked");
  assert.equal(terms.termsPairState("1.0.0", null), "inconsistent");
  assert.equal(terms.termsPairState(null, "/targ-artfest/regulament/v1.0.0"), "inconsistent");
  assert.equal(terms.termsPairState("1.0.0", "/targ-artfest/regulament/v1.0.1"), "inconsistent");
});

test("versiune nepublicată sau invalidă => refuzat, nimic scris", async () => {
  await assert.rejects(terms.linkPublishedTerms({ version: "1.0.0" }), (e) => e.status === 409 && e.code === "terms_not_published");
  await assert.rejects(terms.linkPublishedTerms({ version: "abc" }), (e) => e.status === 400);
  assert.deepEqual({ v: fairRow().termsVersion, u: fairRow().termsUrl }, { v: null, u: null });
});

test("versiune publicată => termsVersion și termsUrl setate ÎMPREUNĂ, URL derivat din versiune", async () => {
  published.add("1.0.0");
  const res = await terms.linkPublishedTerms({ version: "v1.0.0" });
  assert.deepEqual(res.after, { termsVersion: "1.0.0", termsUrl: "/targ-artfest/regulament/v1.0.0" });
  assert.deepEqual({ v: fairRow().termsVersion, u: fairRow().termsUrl }, { v: "1.0.0", u: "/targ-artfest/regulament/v1.0.0" });
  assert.equal(terms.termsPairState(fairRow().termsVersion, fairRow().termsUrl), "linked");
});

test("vendorul vede linkul doar pentru o versiune publicată, cu adresa canonică", () => {
  const show = (termsVersion, termsUrl) => fairSvc.serializeFair({ key: "k", title: "t", termsVersion, termsUrl }).termsUrl;
  assert.equal(show(null, null), null);
  // setat, dar nepublicat => fără link mort
  assert.equal(show("1.0.0", "/targ-artfest/regulament/v1.0.0"), null);
  published.add("1.0.0");
  assert.equal(show("1.0.0", "/targ-artfest/regulament/v1.0.0"), "/targ-artfest/regulament/v1.0.0");
  // stări incomplete / URL străin => fără link
  assert.equal(show("1.0.0", null), null);
  assert.equal(show(null, "/targ-artfest/regulament/v1.0.0"), null);
  assert.equal(show("1.0.0", "https://exemplu.ro/alt-document"), null);
});

test("înscrierea salvează exact versiunea legată la momentul acceptării", async () => {
  published.add("1.0.0");
  await terms.linkPublishedTerms({ version: "1.0.0" });
  const reg = await fairSvc.submitRegistration({
    vendorId: ctx.vendor.id,
    userId: ctx.user.id,
    ip: "10.0.0.1",
    ua: "Test UA",
    body: {
      participationType: "PARTICIPARE_FIZICA",
      contactName: "Ana",
      contactPhone: "0722123456",
      contactEmail: "a@t.ro",
      productTypes: ["ceramică"],
      estimatedProductCount: 3,
      termsAccepted: true,
      termsVersion: "1.0.0",
    },
  });
  assert.equal(reg.termsVersion, "1.0.0");
  const row = fake.tables.artfestFairRegistration[0];
  assert.equal(row.termsVersion, "1.0.0");
  assert.ok(row.termsAcceptedAt instanceof Date);
  assert.equal(row.termsIp, "10.0.0.1");
  assert.equal(row.termsUa, "Test UA");

  // o versiune nouă legată ulterior nu rescrie acceptarea existentă
  published.add("1.1.0");
  await terms.linkPublishedTerms({ version: "1.1.0" });
  assert.equal(fake.tables.artfestFairRegistration[0].termsVersion, "1.0.0");
});
