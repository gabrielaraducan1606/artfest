// Teste pentru mecanismul unitar de administrare + reacceptare a
// documentelor juridice (registry, publicare, cerere de reacceptare, gate
// derivat, catalog, statistici, email). DB în memorie (testkit/fakePrisma).
//
// Rulare: node --experimental-test-module-mocks --test src/services/legalAdmin.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";
process.env.JWT_SECRET = "test-secret";

import { test } from "node:test";
import assert from "node:assert/strict";

import { createFakePrisma } from "../testkit/fakePrisma.js";
import {
  LEGAL_DOCUMENTS,
  contractualEntries,
  encodeRequirement,
  findEntryByKeyAndAudience,
  getCatalogEntry,
  parseRequirement,
} from "./legalRegistry.js";
import { publishLegalDocumentVersion } from "./legalPublishService.js";
import {
  closeReacceptance,
  getOpenRequirements,
  pendingOf,
  requestReacceptance,
  resolveRequirementsForPrincipal,
} from "./reacceptanceService.js";
import { buildLegalCatalog } from "./legalCatalogService.js";
import { listAcceptances } from "./legalStatsService.js";
import { getPublishedInfo } from "./legalPublishedService.js";
import { sendCampaignEmails, htmlToPlainText } from "./policyEmailService.js";

function world() {
  const prisma = createFakePrisma();

  const users = prisma.seed("user", [
    { email: "u1@t.ro", role: "USER" },
    { email: "u2@t.ro", role: "USER" },
    { email: "u3@t.ro", role: "USER", status: "DISABLED" },
    { email: "v1@t.ro", role: "VENDOR" },
    { email: "v2@t.ro", role: "VENDOR" },
    { email: "i1@t.ro", role: "INFLUENCER" },
    { email: "adm@t.ro", role: "ADMIN" },
  ]);

  const [u1, u2, , v1, v2, i1, admin] = users;

  const vendors = prisma.seed("vendor", [
    { userId: v1.id, displayName: "Atelier 1", email: "atelier1@t.ro" },
    { userId: v2.id, displayName: "Atelier 2", email: null },
  ]);

  return { prisma, u1, u2, v1, v2, i1, admin, vendor1: vendors[0], vendor2: vendors[1] };
}

const publish = (w, catalogId) =>
  publishLegalDocumentVersion({
    catalogId,
    version: "1.0.0",
    actorId: w.admin.id,
    prisma: w.prisma,
  });

/* ------------------------------ registry ------------------------------ */

test("registry: cookies nu e contractual; returns are două rânduri separate", () => {
  const cookies = getCatalogEntry("COOKIES");

  assert.equal(cookies.contractual, false);
  assert.equal(contractualEntries().some((e) => e.key === "COOKIES"), false);

  const userReturns = findEntryByKeyAndAudience("RETURNS_POLICY_ACK", "USER");
  const vendorReturns = findEntryByKeyAndAudience("RETURNS_POLICY_ACK", "VENDOR");

  assert.equal(userReturns.storage, "USER");
  assert.equal(vendorReturns.storage, "VENDOR");
  assert.notEqual(userReturns.catalogId, vendorReturns.catalogId);

  assert.deepEqual(getCatalogEntry("TOS").audiences, ["USER", "VENDOR", "INFLUENCER"]);
  assert.deepEqual(getCatalogEntry("VENDOR_TERMS").audiences, ["VENDOR"]);
  assert.deepEqual(getCatalogEntry("INFLUENCER_TERMS").audiences, ["INFLUENCER"]);
  assert.ok(LEGAL_DOCUMENTS.length >= 9);
});

test("registry: codificarea cerințelor se parsează înapoi, legacy => null", () => {
  const deadline = new Date("2030-01-02T00:00:00.000Z");
  const raw = encodeRequirement({ key: "TOS", audience: "USER", version: "2.0.0", deadlineAt: deadline });
  const parsed = parseRequirement(raw);

  assert.equal(parsed.key, "TOS");
  assert.equal(parsed.audience, "USER");
  assert.equal(parsed.version, "2.0.0");
  assert.equal(new Date(parsed.deadlineAt).toISOString(), deadline.toISOString());

  assert.equal(parseRequirement("COOKIES_ACK"), null);
  assert.equal(parseRequirement("TOS"), null);
  assert.equal(parseRequirement(""), null);
});

/* ------------------------------ publicare ------------------------------ */

test("publish: activează versiunea, NU creează cerere, notificări sau email", async () => {
  const w = world();

  const result = await publish(w, "TOS");

  assert.equal(result.reacceptanceRequested, false);
  assert.equal(result.version, "1.0.0");

  const rows = w.prisma.tables.userPolicy;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].document, "TOS");
  assert.equal(rows[0].isActive, true);

  assert.equal(w.prisma.tables.notification.length, 0);
  assert.equal(w.prisma.tables.emailLog.length, 0);

  const campaigns = w.prisma.tables.policyGateCampaign;
  assert.equal(campaigns.length, 1);
  assert.match(campaigns[0].campaignKey, /^pub_/);
  assert.equal(campaigns[0].requiresAction, false);

  // publicarea singură nu deschide nicio cerință
  assert.deepEqual(await getOpenRequirements({ prisma: w.prisma }), []);
});

test("publish: republicarea aceleiași versiuni păstrează publishedAt", async () => {
  const w = world();

  const first = await publish(w, "TOS");
  const second = await publish(w, "TOS");

  assert.equal(w.prisma.tables.userPolicy.length, 1);
  assert.equal(second.publishedAt.getTime(), first.publishedAt.getTime());
});

test("publish: Returns USER și Returns VENDOR sunt independente", async () => {
  const w = world();

  await publish(w, "RETURNS_POLICY_ACK@USER");

  assert.equal(w.prisma.tables.userPolicy.filter((p) => p.document === "RETURNS_POLICY_ACK").length, 1);
  assert.equal(w.prisma.tables.vendorPolicy.length, 0);

  await publish(w, "RETURNS_POLICY_ACK@VENDOR");

  assert.equal(w.prisma.tables.vendorPolicy.length, 1);
  assert.equal(w.prisma.tables.userPolicy.filter((p) => p.document === "RETURNS_POLICY_ACK").length, 1);
});

test("publish: versiune inexistentă în manifest / cookies => eroare", async () => {
  const w = world();

  await assert.rejects(
    publishLegalDocumentVersion({ catalogId: "TOS", version: "2.0.0", prisma: w.prisma }),
    (e) => e.status === 404 && e.code === "version_not_in_manifest"
  );

  await assert.rejects(
    publishLegalDocumentVersion({ catalogId: "COOKIES", version: "1.0.0", prisma: w.prisma }),
    (e) => e.status === 400
  );

  await assert.rejects(
    publishLegalDocumentVersion({ catalogId: "TOS", version: "", prisma: w.prisma }),
    (e) => e.code === "version_required"
  );

  assert.equal(w.prisma.tables.userPolicy.length, 0);
});

/* --------------------------- cere reacceptarea --------------------------- */

test("request: refuzată dacă versiunea nu e publicată în DB", async () => {
  const w = world();

  await assert.rejects(
    requestReacceptance({ catalogId: "TOS", audience: "USER", version: "1.0.0", prisma: w.prisma }),
    (e) => e.status === 409 && e.code === "version_not_published"
  );

  assert.equal(w.prisma.tables.policyGateCampaign.length, 0);
});

test("request: cookies, audience greșit și termen invalid sunt respinse", async () => {
  const w = world();
  await publish(w, "TOS");
  await publish(w, "VENDOR_TERMS");

  await assert.rejects(
    requestReacceptance({ catalogId: "COOKIES", audience: "USER", version: "1", prisma: w.prisma }),
    (e) => e.code === "document_not_reacceptable"
  );

  await assert.rejects(
    requestReacceptance({ catalogId: "VENDOR_TERMS", audience: "USER", version: "1.0.0", prisma: w.prisma }),
    (e) => e.code === "audience_not_applicable"
  );

  await assert.rejects(
    requestReacceptance({
      catalogId: "TOS",
      audience: "USER",
      version: "1.0.0",
      deadlineAt: "nu-e-data",
      prisma: w.prisma,
    }),
    (e) => e.code === "invalid_deadline"
  );
});

test("request TOS@USER: vizează doar userii activi fără acceptare, nu vendori/influenceri", async () => {
  const w = world();
  await publish(w, "TOS");

  // u2 a acceptat deja versiunea
  w.prisma.seed("userConsent", [{ userId: w.u2.id, document: "TOS", version: "1.0.0" }]);

  const result = await requestReacceptance({
    catalogId: "TOS",
    audience: "USER",
    version: "1.0.0",
    inApp: { title: "Am actualizat TOS", message: "Te rugăm să accepți." },
    prisma: w.prisma,
  });

  assert.equal(result.targetCount, 1); // doar u1 (u3 e dezactivat, u2 a acceptat)
  assert.equal(result.createdCount, 1);
  assert.equal(result.emailRequested, false);

  const notifications = w.prisma.tables.notification;
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].userId, w.u1.id);
  assert.equal(notifications[0].meta.kind, "POLICY_UPDATE");
  assert.deepEqual(notifications[0].meta.requirements[0], {
    key: "TOS",
    audience: "USER",
    version: "1.0.0",
    deadlineAt: null,
  });

  const [campaign] = w.prisma.tables.policyGateCampaign.filter((c) => c.campaignKey.startsWith("req_"));
  assert.equal(campaign.requiresAction, true);
  assert.equal(campaign.targetCount, 1);
});

test("request: audience VENDOR pentru TOS țintește vendorii (rol VENDOR), INFLUENCER țintește influencerii", async () => {
  const w = world();
  await publish(w, "TOS");

  const vendorRequest = await requestReacceptance({
    catalogId: "TOS",
    audience: "VENDOR",
    version: "1.0.0",
    prisma: w.prisma,
  });

  assert.equal(vendorRequest.targetCount, 2);

  const influencerRequest = await requestReacceptance({
    catalogId: "TOS",
    audience: "INFLUENCER",
    version: "1.0.0",
    prisma: w.prisma,
  });

  assert.equal(influencerRequest.targetCount, 1);

  const influencerNotification = w.prisma.tables.notification.find((n) => n.userId === w.i1.id);
  assert.equal(influencerNotification.link, "/influencer?policyGate=1");
});

test("request Returns@VENDOR: destinatari = vendori, acceptare în VendorAcceptance; Returns@USER neafectat", async () => {
  const w = world();
  await publish(w, "RETURNS_POLICY_ACK@USER");
  await publish(w, "RETURNS_POLICY_ACK@VENDOR");

  const result = await requestReacceptance({
    catalogId: "RETURNS_POLICY_ACK@VENDOR",
    audience: "VENDOR",
    version: "1.0.0",
    prisma: w.prisma,
  });

  assert.equal(result.targetCount, 2);
  assert.ok(w.prisma.tables.notification.every((n) => n.vendorId && !n.userId));

  // userul nu are nimic de acceptat pentru returns
  const userDocs = await resolveRequirementsForPrincipal({
    userId: w.u1.id,
    role: "USER",
    prisma: w.prisma,
  });
  assert.deepEqual(userDocs, []);

  const vendorDocs = await resolveRequirementsForPrincipal({
    userId: w.v1.id,
    role: "VENDOR",
    vendorId: w.vendor1.id,
    prisma: w.prisma,
  });
  assert.equal(vendorDocs.length, 1);
  assert.equal(vendorDocs[0].catalogId, "RETURNS_POLICY_ACK@VENDOR");
  assert.equal(vendorDocs[0].alreadyAccepted, false);

  // acceptarea vendorului se scrie în VendorAcceptance și golește gate-ul
  w.prisma.seed("vendorAcceptance", [
    { vendorId: w.vendor1.id, document: "RETURNS_POLICY_ACK", version: "1.0.0" },
  ]);

  const after = await resolveRequirementsForPrincipal({
    userId: w.v1.id,
    role: "VENDOR",
    vendorId: w.vendor1.id,
    prisma: w.prisma,
  });
  assert.equal(pendingOf(after).length, 0);
});

test("request: o cerere nouă pentru aceeași pereche arhivează notificările vechi și le înlocuiește", async () => {
  const w = world();
  await publish(w, "TOS");

  await requestReacceptance({ catalogId: "TOS", audience: "USER", version: "1.0.0", prisma: w.prisma });
  await requestReacceptance({ catalogId: "TOS", audience: "USER", version: "1.0.0", prisma: w.prisma });

  const active = w.prisma.tables.notification.filter((n) => !n.archived);
  const archived = w.prisma.tables.notification.filter((n) => n.archived);

  assert.equal(active.length, 2); // u1 + u2
  assert.equal(archived.length, 2);

  const open = await getOpenRequirements({ prisma: w.prisma });
  assert.equal(open.length, 1);
});

test("request cu requiresAction=false e informativă: nu apare ca cerință deschisă", async () => {
  const w = world();
  await publish(w, "TOS");

  await requestReacceptance({
    catalogId: "TOS",
    audience: "USER",
    version: "1.0.0",
    requiresAction: false,
    prisma: w.prisma,
  });

  assert.deepEqual(await getOpenRequirements({ prisma: w.prisma }), []);
});

test("closeReacceptance: retrage cererea și arhivează notificările", async () => {
  const w = world();
  await publish(w, "TOS");

  const { campaignId } = await requestReacceptance({
    catalogId: "TOS",
    audience: "USER",
    version: "1.0.0",
    prisma: w.prisma,
  });

  await closeReacceptance({ campaignId, prisma: w.prisma });

  assert.deepEqual(await getOpenRequirements({ prisma: w.prisma }), []);
  assert.ok(w.prisma.tables.notification.every((n) => n.archived));

  await assert.rejects(closeReacceptance({ campaignId: "nu-exista", prisma: w.prisma }), (e) => e.status === 404);
});

/* ------------------------------ gate derivat ------------------------------ */

test("gate: fără cerere nu cere nimic; după cerere cere; după acceptare nu mai cere", async () => {
  const w = world();
  await publish(w, "TOS");
  await publish(w, "PRIVACY");

  const none = await resolveRequirementsForPrincipal({ userId: w.u1.id, role: "USER", prisma: w.prisma });
  assert.deepEqual(none, []);

  await requestReacceptance({ catalogId: "TOS", audience: "USER", version: "1.0.0", prisma: w.prisma });
  await requestReacceptance({ catalogId: "PRIVACY", audience: "USER", version: "1.0.0", prisma: w.prisma });

  const docs = await resolveRequirementsForPrincipal({ userId: w.u1.id, role: "USER", prisma: w.prisma });
  assert.deepEqual(docs.map((d) => d.key).sort(), ["PRIVACY", "TOS"]);
  assert.equal(pendingOf(docs).length, 2);

  w.prisma.seed("userConsent", [{ userId: w.u1.id, document: "TOS", version: "1.0.0" }]);

  const partial = await resolveRequirementsForPrincipal({ userId: w.u1.id, role: "USER", prisma: w.prisma });
  assert.deepEqual(pendingOf(partial).map((d) => d.key), ["PRIVACY"]);
});

test("gate: cerințele sunt filtrate pe audience/rol; admin nu are cerințe", async () => {
  const w = world();
  await publish(w, "TOS");
  await requestReacceptance({ catalogId: "TOS", audience: "USER", version: "1.0.0", prisma: w.prisma });

  const vendorDocs = await resolveRequirementsForPrincipal({
    userId: w.v1.id,
    role: "VENDOR",
    vendorId: w.vendor1.id,
    prisma: w.prisma,
  });
  assert.deepEqual(vendorDocs, []);

  assert.deepEqual(
    await resolveRequirementsForPrincipal({ userId: w.admin.id, role: "ADMIN", prisma: w.prisma }),
    []
  );
});

test("gate: INFLUENCER_TERMS e exclus din PolicyGate (îl tratează modalul dedicat)", async () => {
  const w = world();
  await publish(w, "INFLUENCER_TERMS");
  await requestReacceptance({
    catalogId: "INFLUENCER_TERMS",
    audience: "INFLUENCER",
    version: "1.0.0",
    prisma: w.prisma,
  });

  const gate = await resolveRequirementsForPrincipal({ userId: w.i1.id, role: "INFLUENCER", prisma: w.prisma });
  assert.deepEqual(gate, []);

  const explicit = await resolveRequirementsForPrincipal({
    userId: w.i1.id,
    role: "INFLUENCER",
    includeInfluencerTerms: true,
    prisma: w.prisma,
  });
  assert.equal(explicit.length, 1);
  assert.equal(explicit[0].key, "INFLUENCER_TERMS");
});

test("gate: un vendor fără profil Vendor nu primește cerințe stocate per vendor", async () => {
  const w = world();
  await publish(w, "VENDOR_TERMS");
  await requestReacceptance({ catalogId: "VENDOR_TERMS", audience: "VENDOR", version: "1.0.0", prisma: w.prisma });

  const docs = await resolveRequirementsForPrincipal({
    userId: w.v1.id,
    role: "VENDOR",
    vendorId: null,
    prisma: w.prisma,
  });

  assert.deepEqual(docs, []);
});

/* ------------------------------ catalog ------------------------------ */

test("catalog: rânduri per (document, audience), cookies informativ, statusuri", async () => {
  const w = world();
  w.prisma.seed("cookieConsent", [
    { consentVersion: "1" },
    { consentVersion: "1" },
    { consentVersion: "2" },
  ]);

  const initial = await buildLegalCatalog({ prisma: w.prisma });

  const ids = initial.rows.map((r) => r.rowId);
  assert.ok(ids.includes("TOS#USER"));
  assert.ok(ids.includes("TOS#VENDOR"));
  assert.ok(ids.includes("TOS#INFLUENCER"));
  assert.ok(ids.includes("RETURNS_POLICY_ACK@USER#USER"));
  assert.ok(ids.includes("RETURNS_POLICY_ACK@VENDOR#VENDOR"));
  assert.ok(ids.includes("PRODUCTS_ADDENDUM#VENDOR"));
  assert.ok(ids.includes("INFLUENCER_TERMS#INFLUENCER"));

  const cookies = initial.rows.find((r) => r.catalogId === "COOKIES");
  assert.equal(cookies.status, "INFORMATIONAL");
  assert.equal(cookies.actions.canPublish, false);
  assert.equal(cookies.actions.canRequestReacceptance, false);
  assert.equal(cookies.stats.totalEvents, 3);

  const tosBefore = initial.rows.find((r) => r.rowId === "TOS#USER");
  assert.equal(tosBefore.status, "NOT_PUBLISHED");
  assert.equal(tosBefore.actions.canRequestReacceptance, false);

  await publish(w, "TOS");

  const published = await buildLegalCatalog({ prisma: w.prisma });
  const tosPublished = published.rows.find((r) => r.rowId === "TOS#USER");
  assert.equal(tosPublished.status, "UP_TO_DATE");
  assert.equal(tosPublished.published.version, "1.0.0");
  assert.equal(tosPublished.actions.canRequestReacceptance, true);
  assert.equal(tosPublished.targetCount, 2); // u1, u2 activi

  const { campaignId } = await requestReacceptance({
    catalogId: "TOS",
    audience: "USER",
    version: "1.0.0",
    deadlineAt: "2099-01-01T00:00:00.000Z",
    prisma: w.prisma,
  });

  w.prisma.seed("userConsent", [{ userId: w.u1.id, document: "TOS", version: "1.0.0" }]);

  const requested = await buildLegalCatalog({ prisma: w.prisma });
  const tosRequested = requested.rows.find((r) => r.rowId === "TOS#USER");
  assert.equal(tosRequested.status, "REACCEPTANCE_REQUESTED");
  assert.equal(tosRequested.acceptedCount, 1);
  assert.equal(tosRequested.mustReacceptCount, 1);

  // aceeași politică TOS, alt audience: fără cerere
  assert.equal(requested.rows.find((r) => r.rowId === "TOS#VENDOR").status, "UP_TO_DATE");

  const overdue = await buildLegalCatalog({ prisma: w.prisma, now: new Date("2100-01-01T00:00:00Z") });
  assert.equal(overdue.rows.find((r) => r.rowId === "TOS#USER").status, "REACCEPTANCE_OVERDUE");

  await closeReacceptance({ campaignId, prisma: w.prisma });

  const closed = await buildLegalCatalog({ prisma: w.prisma });
  assert.equal(closed.rows.find((r) => r.rowId === "TOS#USER").status, "UP_TO_DATE");
});

test("catalog: v2 existent doar ca fișier apare ca nerecunoscut în manifest, nu ca draft publicabil", async () => {
  const w = world();
  const catalog = await buildLegalCatalog({ prisma: w.prisma });
  const tos = catalog.rows.find((r) => r.rowId === "TOS#USER");

  assert.deepEqual(tos.draftVersions, []);
  assert.ok(Array.isArray(tos.unregisteredFiles));
});

/* ------------------------------ statistici ------------------------------ */

test("listAcceptances: acceptat / de acceptat pe versiune, pentru user și vendor", async () => {
  const w = world();

  w.prisma.seed("userConsent", [{ userId: w.u1.id, document: "TOS", version: "1.0.0", ip: "1.2.3.4" }]);

  const tos = getCatalogEntry("TOS");

  const accepted = await listAcceptances({
    entry: tos,
    audience: "USER",
    version: "1.0.0",
    status: "accepted",
    prisma: w.prisma,
  });
  assert.equal(accepted.total, 1);
  assert.equal(accepted.items[0].email, "u1@t.ro");
  assert.equal(accepted.items[0].ip, "1.2.3.4");

  const pending = await listAcceptances({
    entry: tos,
    audience: "USER",
    version: "1.0.0",
    status: "pending",
    prisma: w.prisma,
  });
  assert.deepEqual(pending.items.map((i) => i.email), ["u2@t.ro"]);

  w.prisma.seed("vendorAcceptance", [
    { vendorId: w.vendor1.id, document: "PRODUCTS_ADDENDUM", version: "1.0.0" },
  ]);

  const products = await listAcceptances({
    entry: getCatalogEntry("PRODUCTS_ADDENDUM"),
    audience: "VENDOR",
    version: "1.0.0",
    status: "all",
    prisma: w.prisma,
  });
  assert.equal(products.total, 2);
  assert.equal(products.items.filter((i) => i.accepted).length, 1);
  assert.equal(products.items.find((i) => i.accepted).name, "Atelier 1");
});

test("getPublishedInfo: rezervă din manifest până la publicare, apoi rândul activ din DB", async () => {
  const w = world();

  const before = await getPublishedInfo("TOS", w.prisma);
  assert.equal(before.source, "manifest");

  await publish(w, "TOS");

  const after = await getPublishedInfo("TOS", w.prisma);
  assert.equal(after.source, "policy");
  assert.equal(after.version, "1.0.0");
});

/* ------------------------------ email ------------------------------ */

async function requestWithEmail(w, extra = {}) {
  await publish(w, "TOS");

  const result = await requestReacceptance({
    catalogId: "TOS",
    audience: "USER",
    version: "1.0.0",
    inApp: { title: "Actualizare TOS", message: "Mesaj in-app" },
    email: { subject: "Subiect email", body: "<p>Salut</p><p>Am actualizat TOS.</p>" },
    prisma: w.prisma,
    ...extra,
  });

  return result;
}

test("email: cererea marchează emailul solicitat, contoarele pornesc de la 0", async () => {
  const w = world();
  const result = await requestWithEmail(w);

  assert.equal(result.emailRequested, true);

  const campaign = w.prisma.tables.policyGateCampaign.find((c) => c.id === result.campaignId);
  assert.equal(campaign.sendEmail, true);
  assert.equal(campaign.emailSubject, "Subiect email");
  assert.equal(campaign.emailQueued, 0);
  assert.equal(campaign.emailFailed, 0);
});

test("email: trimite câte unul per destinatar, în loturi, cu conținut text (fără HTML injectat)", async () => {
  const w = world();
  const { campaignId } = await requestWithEmail(w);

  const sent = [];
  const batches = [];
  let inflight = 0;
  let maxInflight = 0;

  const send = async (payload) => {
    inflight += 1;
    maxInflight = Math.max(maxInflight, inflight);
    await new Promise((r) => setTimeout(r, 5));
    inflight -= 1;
    sent.push(payload);
    batches.push(inflight);
  };

  const summary = await sendCampaignEmails({ campaignId, prisma: w.prisma, send, batchSize: 1 });

  assert.equal(summary.total, 2);
  assert.equal(summary.sent, 2);
  assert.equal(summary.failed, 0);
  assert.equal(maxInflight, 1);

  assert.deepEqual(sent.map((s) => s.to).sort(), ["u1@t.ro", "u2@t.ro"]);
  assert.match(sent[0].campaignKey, /^req_/);
  assert.equal(sent[0].subject, "Subiect email");
  assert.equal(sent[0].body.includes("<p>"), false);
  assert.match(sent[0].body, /Am actualizat TOS/);
  assert.equal(sent[0].documents[0].version, "1.0.0");
  assert.equal(sent[0].link, "/cont?policyGate=1&scope=USERS");

  const campaign = w.prisma.tables.policyGateCampaign.find((c) => c.id === campaignId);
  assert.equal(campaign.emailQueued, 2);
  assert.equal(campaign.emailFailed, 0);
});

test("email: dedupe pe EmailLog - a doua rulare nu retrimite celor deja trimiși; reia doar eșecurile", async () => {
  const w = world();
  const { campaignId, campaignKey } = await requestWithEmail(w);

  let calls = 0;
  const flaky = async (payload) => {
    calls += 1;
    if (payload.to === "u2@t.ro") throw new Error("smtp down");

    // simulează ce face mailerul real: EmailLog SENT
    w.prisma.seed("emailLog", [
      { toEmail: payload.to, template: `policy_update:${campaignKey}`, status: "SENT" },
    ]);
  };

  const first = await sendCampaignEmails({ campaignId, prisma: w.prisma, send: flaky });

  assert.equal(first.sent, 1);
  assert.equal(first.failed, 1);
  assert.equal(
    w.prisma.tables.policyGateCampaign.find((c) => c.id === campaignId).emailFailed,
    1
  );

  const retried = [];
  const second = await sendCampaignEmails({
    campaignId,
    prisma: w.prisma,
    send: async (p) => {
      retried.push(p.to);
      w.prisma.seed("emailLog", [
        { toEmail: p.to, template: `policy_update:${campaignKey}`, status: "SENT" },
      ]);
    },
  });

  assert.deepEqual(retried, ["u2@t.ro"]);
  assert.equal(second.alreadySent, 1);
  assert.equal(second.failed, 0);
  assert.equal(calls, 2);
  assert.equal(
    w.prisma.tables.policyGateCampaign.find((c) => c.id === campaignId).emailFailed,
    0
  );

  const third = await sendCampaignEmails({ campaignId, prisma: w.prisma, send: async () => assert.fail("nu trebuie retrimis") });
  assert.equal(third.attempted, 0);
});

test("email: campanie fără email solicitat sau inexistentă", async () => {
  const w = world();
  await publish(w, "TOS");

  const { campaignId } = await requestReacceptance({
    catalogId: "TOS",
    audience: "USER",
    version: "1.0.0",
    prisma: w.prisma,
  });

  const skipped = await sendCampaignEmails({ campaignId, prisma: w.prisma, send: async () => assert.fail() });
  assert.equal(skipped.skipped, true);

  await assert.rejects(
    sendCampaignEmails({ campaignId: "x", prisma: w.prisma, send: async () => {} }),
    (e) => e.status === 404
  );
});

test("email: vendorii primesc emailul la adresa vendorului sau a userului asociat", async () => {
  const w = world();
  await publish(w, "VENDOR_TERMS");

  const { campaignId } = await requestReacceptance({
    catalogId: "VENDOR_TERMS",
    audience: "VENDOR",
    version: "1.0.0",
    email: { subject: "Acord actualizat", body: "Text" },
    prisma: w.prisma,
  });

  const to = [];
  const links = [];
  await sendCampaignEmails({
    campaignId,
    prisma: w.prisma,
    send: async (p) => {
      to.push(p.to);
      links.push(p.link);
    },
  });

  assert.deepEqual(to.sort(), ["atelier1@t.ro", "v2@t.ro"]);
  assert.equal(links[0], "/desktop?policyGate=1&scope=VENDORS");
});

test("htmlToPlainText: scoate tag-urile și păstrează paragrafele", () => {
  assert.equal(htmlToPlainText("<p>A &amp; B</p><p>C<br>D</p>"), "A & B\n\nC\nD");
  assert.equal(htmlToPlainText("<script>alert(1)</script>x"), "alert(1)x");
});

/* --------------------- blocări dure ale vendorului --------------------- */

test("evaluateVendorDocument: publicarea singură nu blochează; cererea (după termen) da", async () => {
  const w = world();
  const { evaluateVendorDocument } = await import("./reacceptanceService.js");
  const check = (policyVersion = "2.0.0", now) =>
    evaluateVendorDocument({
      vendorId: w.vendor1.id,
      key: "SHIPPING_ADDENDUM",
      policyVersion,
      prisma: w.prisma,
      now,
    });

  // nu a acceptat niciodată => blocat (comportament existent)
  assert.deepEqual(
    { ...(await check()), requiredVersion: undefined },
    { satisfied: false, reason: "never_accepted", requiredVersion: undefined }
  );

  // a acceptat o versiune veche, s-a publicat 2.0.0 (fără cerere) => NU e blocat
  w.prisma.seed("vendorAcceptance", [
    { vendorId: w.vendor1.id, document: "SHIPPING_ADDENDUM", version: "0.9.0" },
  ]);
  assert.equal((await check()).satisfied, true);
  assert.equal((await check()).reason, "accepted_previous_version");

  // cerere deschisă pentru 1.0.0, fără termen => blocat imediat
  await publish(w, "SHIPPING_ADDENDUM");
  await requestReacceptance({
    catalogId: "SHIPPING_ADDENDUM",
    audience: "VENDOR",
    version: "1.0.0",
    prisma: w.prisma,
  });

  const blocked = await check("1.0.0");
  assert.equal(blocked.satisfied, false);
  assert.equal(blocked.reason, "reacceptance_required");
  assert.equal(blocked.requiredVersion, "1.0.0");

  // după acceptarea versiunii cerute => deblocat
  w.prisma.seed("vendorAcceptance", [
    { vendorId: w.vendor1.id, document: "SHIPPING_ADDENDUM", version: "1.0.0" },
  ]);
  assert.equal((await check("1.0.0")).satisfied, true);

  // celălalt vendor, cu termen în viitor: perioadă de grație
  const other = await evaluateVendorDocument({
    vendorId: w.vendor2.id,
    key: "SHIPPING_ADDENDUM",
    policyVersion: "1.0.0",
    prisma: w.prisma,
  });
  assert.equal(other.satisfied, false); // niciodată acceptat + cerere fără termen
});

test("evaluateVendorDocument: termen în viitor => grație, după termen => blocat", async () => {
  const w = world();
  const { evaluateVendorDocument } = await import("./reacceptanceService.js");

  w.prisma.seed("vendorAcceptance", [
    { vendorId: w.vendor1.id, document: "SHIPPING_ADDENDUM", version: "0.9.0" },
  ]);

  await publish(w, "SHIPPING_ADDENDUM");
  await requestReacceptance({
    catalogId: "SHIPPING_ADDENDUM",
    audience: "VENDOR",
    version: "1.0.0",
    deadlineAt: "2099-01-01T00:00:00.000Z",
    prisma: w.prisma,
  });

  const args = { vendorId: w.vendor1.id, key: "SHIPPING_ADDENDUM", policyVersion: "1.0.0", prisma: w.prisma };

  const before = await evaluateVendorDocument(args);
  assert.equal(before.satisfied, true);
  assert.equal(before.reason, "reacceptance_grace");

  const after = await evaluateVendorDocument({ ...args, now: new Date("2100-01-01T00:00:00Z") });
  assert.equal(after.satisfied, false);
  assert.equal(after.reason, "reacceptance_required");
});

/* ------------------- înregistrare: versiune decisă de server ------------------- */

test("resolveRegistrationConsent: TOS/Privacy iau versiunea publicată, marketingul rămâne al clientului", async () => {
  const w = world();
  const { resolveRegistrationConsent } = await import("./legalPublishedService.js");

  await publish(w, "TOS");

  const tos = await resolveRegistrationConsent("TOS", { version: "0.0.1", checksum: "fals" }, w.prisma);
  assert.equal(tos.version, "1.0.0");
  assert.notEqual(tos.checksum, "fals");

  // Privacy nepublicat în DB: rezerva din manifest, tot decisă de server
  const privacy = await resolveRegistrationConsent("PRIVACY_ACK", { version: "0.0.1" }, w.prisma);
  assert.equal(privacy.version, "1.0.0");

  const marketing = await resolveRegistrationConsent("MARKETING_EMAIL_OPTIN", { version: "7", checksum: "m" }, w.prisma);
  assert.deepEqual(marketing, { version: "7", checksum: "m" });
});
