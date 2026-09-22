// Influenceri: acordul NU mai blochează la schimbarea manifestului; doar o
// cerere deschisă de reacceptare (sau lipsa oricărei acceptări) o face.
//
// Rulare: node --experimental-test-module-mocks --test src/services/influencerTermsStatus.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";
process.env.JWT_SECRET = "test-secret";

import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createFakePrisma } from "../testkit/fakePrisma.js";

let fake;

mock.module("../db.js", {
  namedExports: { prisma: new Proxy({}, { get: (_t, key) => fake[key] }) },
});

const {
  acceptInfluencerTerms,
  computeInfluencerTermsState,
  getInfluencerTermsStatus,
} = await import("./influencerTermsStatus.js");
const { publishLegalDocumentVersion } = await import("./legalPublishService.js");
const { requestReacceptance } = await import("./reacceptanceService.js");
const { enforceInfluencerTermsGate } = await import("../middleware/enforceInfluencerTermsGate.js");

let ctx;

beforeEach(() => {
  fake = createFakePrisma();

  const [inf, other, admin, plain] = fake.seed("user", [
    { email: "inf@t.ro", role: "INFLUENCER" },
    { email: "inf2@t.ro", role: "INFLUENCER" },
    { email: "adm@t.ro", role: "ADMIN" },
    { email: "u@t.ro", role: "USER" },
  ]);

  fake.seed("influencerProfile", [{ userId: inf.id }, { userId: other.id }]);
  ctx = { inf, other, admin, plain };
});

const publish = () =>
  publishLegalDocumentVersion({
    catalogId: "INFLUENCER_TERMS",
    version: "1.0.0",
    actorId: ctx.admin.id,
    prisma: fake,
  });

const request = (extra = {}) =>
  requestReacceptance({
    catalogId: "INFLUENCER_TERMS",
    audience: "INFLUENCER",
    version: "1.0.0",
    prisma: fake,
    ...extra,
  });

async function gate(userId) {
  const req = { user: { sub: userId } };
  let status = null;
  let body = null;
  let passed = false;
  const res = {
    status(code) {
      status = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
  };

  await enforceInfluencerTermsGate(req, res, () => {
    passed = true;
  });

  return { passed, status, body };
}

test("computeInfluencerTermsState: cazurile pure", () => {
  const published = { version: "2.0.0" };

  // fără cerere, a acceptat o versiune veche => valid, nu blochează
  const older = computeInfluencerTermsState({ published, requirement: null, consentVersions: ["1.0.0"] });
  assert.equal(older.outdated, false);
  assert.equal(older.blocking, false);
  assert.equal(older.acceptedPublished, false);

  // fără nicio acceptare => outdated + blocant
  const never = computeInfluencerTermsState({ published, requirement: null, consentVersions: [] });
  assert.equal(never.outdated, true);
  assert.equal(never.blocking, true);
  assert.equal(never.reason, "NEVER_ACCEPTED");

  // cerere deschisă, fără acceptarea versiunii cerute
  const requested = computeInfluencerTermsState({
    published,
    requirement: { version: "2.0.0", deadlineAt: null },
    consentVersions: ["1.0.0"],
  });
  assert.equal(requested.outdated, true);
  assert.equal(requested.blocking, true);
  assert.equal(requested.reason, "REACCEPTANCE_REQUESTED");

  // cu termen viitor: outdated, dar nu blochează încă
  const now = new Date("2030-01-01T00:00:00Z");
  const grace = computeInfluencerTermsState({
    published,
    requirement: { version: "2.0.0", deadlineAt: "2031-01-01T00:00:00Z" },
    consentVersions: ["1.0.0"],
    now,
  });
  assert.equal(grace.outdated, true);
  assert.equal(grace.blocking, false);

  const overdue = computeInfluencerTermsState({
    published,
    requirement: { version: "2.0.0", deadlineAt: "2029-01-01T00:00:00Z" },
    consentVersions: ["1.0.0"],
    now,
  });
  assert.equal(overdue.blocking, true);

  // a acceptat versiunea cerută
  const done = computeInfluencerTermsState({
    published,
    requirement: { version: "2.0.0", deadlineAt: null },
    consentVersions: ["1.0.0", "2.0.0"],
  });
  assert.equal(done.outdated, false);
});

test("fără cerere: manifest/publicare nu blochează un influencer care a acceptat deja o versiune", async () => {
  fake.seed("userConsent", [{ userId: ctx.inf.id, document: "INFLUENCER_TERMS", version: "0.9.0" }]);

  const before = await getInfluencerTermsStatus(ctx.inf.id, { prisma: fake });
  assert.equal(before.outdated, false);
  assert.equal(before.blocking, false);
  assert.equal(before.requiredVersion, null);
  assert.equal(before.acceptedVersion, "0.9.0");

  await publish(); // publicarea singură

  const after = await getInfluencerTermsStatus(ctx.inf.id, { prisma: fake });
  assert.equal(after.outdated, false);
  assert.equal(after.publishedVersion, "1.0.0");
  assert.equal((await gate(ctx.inf.id)).passed, true);
});

test("cont fără nicio acceptare: blocat (428) până acceptă versiunea publicată", async () => {
  await publish();

  const blocked = await gate(ctx.inf.id);
  assert.equal(blocked.passed, false);
  assert.equal(blocked.status, 428);
  assert.equal(blocked.body.error, "influencer_terms_acceptance_required");
  assert.equal(blocked.body.terms.reason, "NEVER_ACCEPTED");

  const { version, status } = await acceptInfluencerTerms(ctx.inf.id, { ip: "1.1.1.1", ua: "t", prisma: fake });

  assert.equal(version, "1.0.0");
  assert.equal(status.outdated, false);
  assert.equal((await gate(ctx.inf.id)).passed, true);
});

test("cerere de reacceptare: blochează doar influencerii vizați, până acceptă versiunea cerută", async () => {
  fake.seed("userConsent", [
    { userId: ctx.inf.id, document: "INFLUENCER_TERMS", version: "0.9.0" },
    { userId: ctx.other.id, document: "INFLUENCER_TERMS", version: "0.9.0" },
  ]);

  await publish();
  const result = await request();
  assert.equal(result.targetCount, 2);

  const blocked = await gate(ctx.inf.id);
  assert.equal(blocked.status, 428);
  assert.equal(blocked.body.terms.requiredVersion, "1.0.0");
  assert.equal(blocked.body.terms.reason, "REACCEPTANCE_REQUESTED");

  // versiunea acceptată o decide serverul (cea cerută)
  const accepted = await acceptInfluencerTerms(ctx.inf.id, { prisma: fake });
  assert.equal(accepted.version, "1.0.0");
  assert.ok(fake.tables.userConsent.some((c) => c.userId === ctx.inf.id && c.version === "1.0.0"));
  // istoricul vechi rămâne
  assert.ok(fake.tables.userConsent.some((c) => c.userId === ctx.inf.id && c.version === "0.9.0"));

  assert.equal((await gate(ctx.inf.id)).passed, true);
  // celălalt influencer încă e blocat
  assert.equal((await gate(ctx.other.id)).status, 428);
});

test("cerere cu termen în viitor: modalul apare (outdated) dar nu blochează", async () => {
  fake.seed("userConsent", [{ userId: ctx.inf.id, document: "INFLUENCER_TERMS", version: "0.9.0" }]);

  await publish();
  await request({ deadlineAt: "2099-01-01T00:00:00.000Z" });

  const status = await getInfluencerTermsStatus(ctx.inf.id, { prisma: fake });
  assert.equal(status.outdated, true);
  assert.equal(status.blocking, false);
  assert.ok(status.deadlineAt);

  assert.equal((await gate(ctx.inf.id)).passed, true);
});

test("cererea pe alt audience/document nu afectează influencerii", async () => {
  fake.seed("userConsent", [{ userId: ctx.inf.id, document: "INFLUENCER_TERMS", version: "0.9.0" }]);

  await publishLegalDocumentVersion({ catalogId: "TOS", version: "1.0.0", prisma: fake });
  await requestReacceptance({ catalogId: "TOS", audience: "USER", version: "1.0.0", prisma: fake });

  const status = await getInfluencerTermsStatus(ctx.inf.id, { prisma: fake });
  assert.equal(status.outdated, false);
  assert.equal((await gate(ctx.inf.id)).passed, true);
});

test("middleware: utilizatorii fără profil de influencer trec mai departe; fără token 401", async () => {
  assert.equal((await gate(ctx.plain.id)).passed, true);
  assert.equal((await gate(ctx.admin.id)).passed, true);
  assert.equal((await gate(undefined)).status, 401);
});

test("acceptInfluencerTerms: idempotent (același rând, givenAt actualizat)", async () => {
  await publish();

  await acceptInfluencerTerms(ctx.inf.id, { prisma: fake });
  await acceptInfluencerTerms(ctx.inf.id, { prisma: fake });

  assert.equal(fake.tables.userConsent.filter((c) => c.userId === ctx.inf.id).length, 1);
});
