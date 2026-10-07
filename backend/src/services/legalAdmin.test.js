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
import { getPublishedInfo, resolveRegistrationConsent } from "./legalPublishedService.js";
import {
  findUpcomingLegalDoc,
  legalVersionVisibility,
  loadLegalDoc,
  resolveManifestVersionParam,
} from "../lib/legal.js";
import { upcomingSummary } from "../api/legal.js";
import {
  daysUntilEffective,
  legalNoticeReport,
  previewLegalNotice,
  resendFailedLegalNotice,
  sendLegalNotice,
  summaryForAudience,
  toneAudience,
} from "./legalNoticeService.js";
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
    publishLegalDocumentVersion({ catalogId: "TOS", version: "9.9.9", prisma: w.prisma }),
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
  // v2 (versiune viitoare) există în manifest -> „draft disponibil”, v1 rămâne publicată
  assert.equal(tosPublished.status, "DRAFT_AVAILABLE");
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
  assert.equal(requested.rows.find((r) => r.rowId === "TOS#VENDOR").status, "DRAFT_AVAILABLE");

  const overdue = await buildLegalCatalog({ prisma: w.prisma, now: new Date("2100-01-01T00:00:00Z") });
  assert.equal(overdue.rows.find((r) => r.rowId === "TOS#USER").status, "REACCEPTANCE_OVERDUE");

  await closeReacceptance({ campaignId, prisma: w.prisma });

  const closed = await buildLegalCatalog({ prisma: w.prisma });
  assert.equal(closed.rows.find((r) => r.rowId === "TOS#USER").status, "DRAFT_AVAILABLE");
});

test("catalog: v2 e înregistrată ca versiune VIITOARE (preaviz), cu date complete și effectiveAt", async () => {
  const w = world();
  const catalog = await buildLegalCatalog({ prisma: w.prisma });
  const tos = catalog.rows.find((r) => r.rowId === "TOS#USER");

  assert.equal(tos.draftVersions.length, 1);
  const v2 = tos.draftVersions[0];
  assert.equal(v2.manifestVersion, 2);
  assert.equal(v2.policyVersion, "2.0.0");
  assert.equal(v2.upcoming, true);
  assert.deepEqual(v2.missingVars, []);
  assert.equal(v2.effectiveAt, "2026-10-23");
  assert.equal(v2.validFrom, "2026-10-23");
  // fără dată de notificare / rezumat până le stabilește operatorul
  assert.equal(v2.noticeAt, null);
  assert.equal(v2.versionHtmlUrl, "/legal/tos/v/2.0.0.html");
  assert.deepEqual(tos.unregisteredFiles, []);
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

/* ------------- v2 = versiune VIITOARE (preaviz), v1 rămâne în vigoare ------------- */

const V2_TYPES = [
  "tos",
  "privacy",
  "cookies",
  "vendor_terms",
  "shipping_addendum",
  "returns_policy_ack",
  "products_addendum",
];

test("preaviz: v1 rămâne versiunea curentă în manifest pentru toate documentele", () => {
  for (const type of [...V2_TYPES, "influencer_terms"]) {
    const current = loadLegalDoc(type);
    assert.equal(current.manifestVersion, 1, type);
    assert.equal(current.policyVersion, "1.0.0", type);
    assert.deepEqual(current.missingVars, [], `${type} v1 nu are câmpuri goale`);
  }
});

test("preaviz: documentele v2 au antet coerent 2.0.0, effectiveAt 2026-10-23, fără DRAFT și fără câmpuri goale", () => {
  for (const type of V2_TYPES) {
    const doc = loadLegalDoc(type, { version: 2 });
    assert.equal(doc.policyVersion, "2.0.0", type);
    assert.equal(doc.manifestStatus, "upcoming", type);
    assert.equal(doc.valid_from, "2026-10-23", type);
    assert.equal(doc.effectiveAt, "2026-10-23", type);
    assert.deepEqual(doc.missingVars, [], `${type}: fără variabile lipsă`);
    assert.ok(
      !/\bDRAFT\b|statut de draft|\[EMAIL_RETUR\]|\bTODO\b|\bPLACEHOLDER\b/.test(doc.content),
      `${type}: fără placeholder-e`
    );
    assert.ok(!/\{\{/.test(doc.content), `${type}: fără variabile nerandate`);
    for (const key of doc.missingVars) {
      assert.ok(
        ["company.phone", "company.registration_number"].includes(key),
        `${type}: variabilă lipsă neașteptată ${key}`
      );
    }
  }
});

test("preaviz: vizibilitate publică - CURRENT/ARCHIVED/UPCOMING publice, DRAFT și NOT_READY nu", () => {
  const v2 = loadLegalDoc("tos", { version: 2 });

  // date complete -> UPCOMING, publică pentru consultare (NU în vigoare)
  assert.deepEqual(legalVersionVisibility(v2, 1), { status: "UPCOMING", isPublic: true });
  assert.equal(findUpcomingLegalDoc("tos", 1).policyVersion, "2.0.0");
  assert.deepEqual(upcomingSummary(findUpcomingLegalDoc("tos", 1)), {
    version: "2.0.0",
    title: "Termeni și Condiții — Artfest",
    htmlUrl: "/legal/tos/v/2.0.0.html",
    effectiveAt: "2026-10-23",
    noticeAt: null,
    changeSummary: null,
  });

  // cu date lipsă ar fi NOT_READY - nepublică (fără câmpuri goale)
  assert.deepEqual(legalVersionVisibility({ ...v2, missingVars: ["company.phone"] }, 1), {
    status: "NOT_READY",
    isPublic: false,
    missingVars: ["company.phone"],
  });
  const ready = v2;

  // fără marcaj "upcoming" peste versiunea curentă = draft intern
  assert.deepEqual(legalVersionVisibility({ ...ready, manifestStatus: null }, 1), {
    status: "DRAFT",
    isPublic: false,
  });

  const v1 = loadLegalDoc("tos", { version: 1 });
  assert.equal(legalVersionVisibility(v1, 1).status, "CURRENT");
  assert.deepEqual(legalVersionVisibility(v1, 2), { status: "ARCHIVED", isPublic: true });
});

test("preaviz: URL pe versiune acceptă 2.0.0 și 2; versiunile inexistente -> null", () => {
  assert.equal(resolveManifestVersionParam("tos", "2.0.0"), 2);
  assert.equal(resolveManifestVersionParam("tos", "2"), 2);
  assert.equal(resolveManifestVersionParam("tos", "1.0.0"), 1);
  assert.equal(resolveManifestVersionParam("tos", "9.9.9"), null);
  assert.equal(resolveManifestVersionParam("tos", "../x"), null);
  assert.equal(loadLegalDoc("tos", { version: 2 }).versionHtmlUrl, "/legal/tos/v/2.0.0.html");
  assert.equal(upcomingSummary(null), null);
});

test("preaviz: v2 NU devine curentă, NU creează cerințe și NU e acceptată de conturile noi (USER/VENDOR/INFLUENCER)", async () => {
  const w = world();

  // versiunea publicată rămâne v1 (rândul activ / rezerva din manifest)
  for (const catalogId of ["TOS", "PRIVACY", "VENDOR_TERMS", "INFLUENCER_TERMS"]) {
    assert.equal((await getPublishedInfo(catalogId, w.prisma)).version, "1.0.0", catalogId);
  }

  // conturile noi acceptă v1, nu v2
  for (const document of ["TOS", "PRIVACY_ACK", "INFLUENCER_TERMS"]) {
    const consent = await resolveRegistrationConsent(document, { version: "2.0.0" }, w.prisma);
    assert.equal(consent.version, "1.0.0", document);
  }

  // reacceptarea NU se poate cere pentru v2 (nu e activă)
  await publish(w, "TOS");
  await assert.rejects(
    requestReacceptance({ catalogId: "TOS", audience: "USER", version: "2.0.0", prisma: w.prisma }),
    (e) => e.code === "version_not_published"
  );

  // existența v2 nu creează nicio cerință pentru niciun rol
  assert.deepEqual(await getOpenRequirements({ prisma: w.prisma }), []);
  for (const [user, role, vendorId] of [
    [w.u1, "USER", null],
    [w.v1, "VENDOR", w.vendor1.id],
    [w.i1, "INFLUENCER", null],
  ]) {
    const docs = await resolveRequirementsForPrincipal({
      userId: user.id,
      role,
      vendorId,
      includeInfluencerTerms: true,
      prisma: w.prisma,
    });
    assert.deepEqual(docs, [], role);
  }
});

/* ------------- PREAVIZ / NOTIFICARE DE ACTUALIZARE (legalNoticeService) ------------- */

// 7 oct 2026 -> 16 zile până la 23 oct 2026 (>= 15)
const NOTICE_NOW = new Date("2026-10-07T09:00:00Z");

// „mailer” fals: scrie EmailLog exact ca sendMailLogged (SENT / FAILED) - fără email real
function fakeNoticeSend(w, { failFor = new Set() } = {}) {
  const calls = [];

  const send = async (payload) => {
    calls.push(payload);
    const template = `legal_notice:${payload.campaignKey}`;

    if (failFor.has(payload.to)) {
      w.prisma.seed("emailLog", [
        { toEmail: payload.to, template, status: "FAILED", error: "smtp_down", subject: "x", senderKey: "noreply" },
      ]);
      throw new Error("smtp_down");
    }

    w.prisma.seed("emailLog", [
      { toEmail: payload.to, template, status: "SENT", sentAt: new Date(), subject: "x", senderKey: "noreply" },
    ]);
  };

  return { send, calls };
}

test("preaviz: preview fără trimitere - pachet agregat, audiențe, zile rămase, fără campanie", async () => {
  const w = world();
  const preview = await previewLegalNotice({ kind: "notice", prisma: w.prisma, now: NOTICE_NOW });

  assert.equal(preview.available, true);
  assert.equal(preview.effectiveAt, "2026-10-23");
  assert.equal(preview.daysUntilEffective, 16);
  assert.equal(preview.noticePeriodOk, true);
  assert.equal(preview.subject, "Actualizare documente Artfest – intrare în vigoare la 23 octombrie 2026");

  const audiences = Object.fromEntries(preview.documents.map((d) => [d.key, d.audiences.sort().join(",")]));
  assert.equal(audiences.tos, "INFLUENCER,USER,VENDOR");
  assert.equal(audiences.vendor_terms, "VENDOR");
  assert.equal(audiences.shipping_addendum, "VENDOR");
  assert.equal(audiences.products_addendum, "VENDOR");
  assert.equal(audiences.returns_policy_ack, "USER,VENDOR");

  // u1, u2 (USER), v1, v2 (VENDOR), i1 - u3 dezactivat și adminul exclus
  assert.deepEqual(preview.recipients.byRole, { USER: 2, VENDOR: 2, INFLUENCER: 1 });

  const vendorSample = preview.samples.find((s) => s.role === "VENDOR");
  const userSample = preview.samples.find((s) => s.role === "USER");
  assert.ok(vendorSample.documents.length > userSample.documents.length);
  assert.ok(!userSample.documents.some((t) => /Vânzători/.test(t)), "userii nu primesc acordul vânzătorilor");
  assert.match(vendorSample.text, /versiunea actualizată \(2\.0\.0\)/);
  assert.match(vendorSample.text, /\/legal\/vendor_terms\/v\/2\.0\.0\.html/);
  assert.doesNotMatch(vendorSample.text, /trebuie să accepți|acceptare/i);

  // preview-ul nu creează nimic
  assert.equal(w.prisma.tables.policyGateCampaign.length, 0);
  assert.equal(w.prisma.tables.emailLog.length, 0);
});

test("preaviz: trimitere -> un email agregat per persoană; v2 rămâne INACTIVĂ; fără cereri de reacceptare", async () => {
  const w = world();
  const { send, calls } = fakeNoticeSend(w);

  await assert.rejects(
    sendLegalNotice({ kind: "notice", prisma: w.prisma, send, now: NOTICE_NOW }),
    (e) => e.code === "confirmation_required"
  );
  assert.equal(calls.length, 0);

  const result = await sendLegalNotice({
    kind: "notice",
    confirm: true,
    actorId: w.admin.id,
    prisma: w.prisma,
    send,
    now: NOTICE_NOW,
  });

  assert.equal(result.recipients, 5);
  assert.equal(result.sent, 5);
  assert.equal(result.activated, false);
  assert.equal(result.reacceptanceRequested, false);
  assert.equal(new Set(calls.map((c) => c.to)).size, 5, "un singur email per persoană");
  assert.ok(calls.every((c) => c.kind === "notice"));
  assert.equal(calls.find((c) => c.to === "v1@t.ro").documents.length, 7);
  assert.equal(calls.find((c) => c.to === "i1@t.ro").documents.length, 3);

  // v2 NU e activă și nu există cerințe
  assert.equal((await getPublishedInfo("TOS", w.prisma)).version, "1.0.0");
  assert.equal(w.prisma.tables.userPolicy.length, 0);
  assert.equal(w.prisma.tables.vendorPolicy.length, 0);
  assert.deepEqual(await getOpenRequirements({ prisma: w.prisma }), []);

  const report = await legalNoticeReport({ campaignId: result.campaignId, prisma: w.prisma });
  assert.equal(report.kind, "notice");
  assert.equal(report.delivered, 5);
  assert.equal(report.failed, 0);
  assert.equal(report.createdByEmail, "adm@t.ro");
  assert.ok(report.documents.some((d) => d.key === "tos" && d.version === "2.0.0"));
});

test("preaviz: anti-duplicate - al doilea click e refuzat, iar preview-ul arată „deja trimis”", async () => {
  const w = world();
  const { send, calls } = fakeNoticeSend(w);

  await sendLegalNotice({ kind: "notice", confirm: true, prisma: w.prisma, send, now: NOTICE_NOW });
  const before = calls.length;

  await assert.rejects(
    sendLegalNotice({ kind: "notice", confirm: true, prisma: w.prisma, send, now: NOTICE_NOW }),
    (e) => e.status === 409
  );
  assert.equal(calls.length, before, "niciun email în plus");

  const preview = await previewLegalNotice({ kind: "notice", prisma: w.prisma, now: NOTICE_NOW });
  assert.equal(preview.available, false);
  assert.match(preview.blockers.join(" "), /deja trimis/);
  assert.ok(preview.alreadyCovered.length >= 7);
});

test("preaviz: eșecurile parțiale se reiau DOAR pentru cei eșuați", async () => {
  const w = world();
  const failing = fakeNoticeSend(w, { failFor: new Set(["u2@t.ro", "v2@t.ro"]) });

  const result = await sendLegalNotice({
    kind: "notice",
    confirm: true,
    prisma: w.prisma,
    send: failing.send,
    now: NOTICE_NOW,
  });
  assert.equal(result.sent, 3);
  assert.equal(result.failed, 2);

  let report = await legalNoticeReport({ campaignId: result.campaignId, prisma: w.prisma });
  assert.deepEqual(report.failedRecipients.map((r) => r.email).sort(), ["u2@t.ro", "v2@t.ro"]);
  assert.equal(report.failedRecipients[0].error, "smtp_down");

  const ok = fakeNoticeSend(w);
  const retry = await resendFailedLegalNotice({ campaignId: result.campaignId, prisma: w.prisma, send: ok.send });

  assert.equal(retry.sent, 2);
  assert.deepEqual(ok.calls.map((c) => c.to).sort(), ["u2@t.ro", "v2@t.ro"]);

  report = await legalNoticeReport({ campaignId: result.campaignId, prisma: w.prisma });
  assert.equal(report.delivered, 5);
  assert.equal(report.failed, 0);

  // nimic de reluat -> niciun email
  const again = fakeNoticeSend(w);
  const noop = await resendFailedLegalNotice({ campaignId: result.campaignId, prisma: w.prisma, send: again.send });
  assert.equal(noop.attempted, 0);
  assert.equal(again.calls.length, 0);
});

test("preaviz: sub 15 zile e blocat; doar o excepție legală confirmată explicit permite trimiterea", async () => {
  const w = world();
  const { send, calls } = fakeNoticeSend(w);
  const late = new Date("2026-10-09T09:00:00Z"); // 14 zile

  const preview = await previewLegalNotice({ kind: "notice", prisma: w.prisma, now: late });
  assert.equal(preview.daysUntilEffective, 14);
  assert.equal(preview.noticePeriodOk, false);

  await assert.rejects(
    sendLegalNotice({ kind: "notice", confirm: true, prisma: w.prisma, send, now: late }),
    (e) => e.status === 422 && e.code === "notice_period_too_short" && e.daysUntilEffective === 14
  );
  await assert.rejects(
    sendLegalNotice({ kind: "notice", confirm: true, exception: { confirmed: true, reason: "" }, prisma: w.prisma, send, now: late }),
    (e) => e.code === "notice_period_too_short"
  );
  assert.equal(calls.length, 0);

  const result = await sendLegalNotice({
    kind: "notice",
    confirm: true,
    exception: { confirmed: true, reason: "obligație legală nouă" },
    prisma: w.prisma,
    send,
    now: late,
  });
  assert.equal(result.sent, 5);
  const report = await legalNoticeReport({ campaignId: result.campaignId, prisma: w.prisma });
  assert.match(report.exception, /EXCEPȚIE termen preaviz \(14 zile\): obligație legală nouă/);

  // 8 oct = exact 15 zile -> permis
  assert.equal(daysUntilEffective("2026-10-23", new Date("2026-10-08T12:00:00Z")), 15);
});

test("actualizare: disponibilă DOAR după activare; acceptarea apare doar cu cerere de reacceptare deschisă", async () => {
  const w = world();

  // înainte de activare: nu există nimic de anunțat
  const before = await previewLegalNotice({ kind: "update", prisma: w.prisma });
  assert.equal(before.available, false);
  await assert.rejects(
    sendLegalNotice({ kind: "update", confirm: true, prisma: w.prisma, send: fakeNoticeSend(w).send }),
    (e) => e.code === "notice_not_available"
  );

  // activare = acțiune SEPARATĂ (manifest current rămâne 1; aici simulăm rândul activ v2)
  const realCurrent = { ...loadLegalDoc("tos", { version: 2 }) };
  assert.equal(realCurrent.policyVersion, "2.0.0");
  await publishLegalDocumentVersion({ catalogId: "TOS", version: "2.0.0", prisma: w.prisma });
  assert.equal((await getPublishedInfo("TOS", w.prisma)).version, "2.0.0");

  const afterPublish = await previewLegalNotice({ kind: "update", prisma: w.prisma });
  assert.equal(afterPublish.available, true);
  assert.deepEqual(afterPublish.documents.map((d) => d.key), ["tos"]);
  assert.deepEqual(afterPublish.subjects, {
    USER: "Documentele Artfest actualizate au intrat în vigoare",
    VENDOR: "Noii Termeni pentru vânzători au intrat în vigoare",
    INFLUENCER: "Documentele actualizate pentru colaborarea cu Artfest au intrat în vigoare",
  });
  const noRequest = afterPublish.samples.find((s) => s.role === "USER");
  assert.doesNotMatch(noRequest.text, /va trebui să accepți|necesită acceptarea/);

  // reacceptarea e o acțiune separată; abia atunci emailul o menționează
  await requestReacceptance({ catalogId: "TOS", audience: "USER", version: "2.0.0", prisma: w.prisma });
  const withRequest = await previewLegalNotice({ kind: "update", prisma: w.prisma });
  assert.match(withRequest.samples.find((s) => s.role === "USER").text, /va trebui să accepți versiunea nouă/);
  assert.doesNotMatch(withRequest.samples.find((s) => s.role === "VENDOR").text, /va trebui să accepți/);

  const { send, calls } = fakeNoticeSend(w);
  const result = await sendLegalNotice({ kind: "update", confirm: true, prisma: w.prisma, send });
  assert.equal(result.kind, "update");
  assert.ok(calls.length > 0 && calls.every((c) => c.kind === "update"));
  assert.equal(calls.find((c) => c.to === "u1@t.ro").documents[0].reacceptanceRequired, true);
  assert.equal(calls.find((c) => c.to === "v1@t.ro").documents[0].reacceptanceRequired, false);

  // notificarea nu modifică cererile existente și nu creează altele
  const open = await getOpenRequirements({ prisma: w.prisma });
  assert.deepEqual(open.map((r) => `${r.key}|${r.audience}|${r.version}`), ["TOS|USER|2.0.0"]);
});

/* ------------- preaviz pe AUDIENȚĂ: conținut, documente, subiect, un email per adresă ------------- */

const ROLE_DOCS = {
  USER: ["cookies", "privacy", "returns_policy_ack", "tos"],
  VENDOR: ["cookies", "privacy", "products_addendum", "returns_policy_ack", "shipping_addendum", "tos", "vendor_terms"],
  INFLUENCER: ["cookies", "privacy", "tos"],
};

test("preaviz pe rol: fiecare audiență primește DOAR documentele ei și subiectul ei", async () => {
  const w = world();
  const preview = await previewLegalNotice({ kind: "notice", prisma: w.prisma, now: NOTICE_NOW });

  assert.deepEqual(preview.subjects, {
    USER: "Actualizare documente Artfest – intrare în vigoare la 23 octombrie 2026",
    VENDOR: "Actualizare Termeni și condiții pentru vânzători – 23 octombrie 2026",
    INFLUENCER: "Actualizare documente aplicabile colaborării Artfest – 23 octombrie 2026",
  });

  for (const sample of preview.samples) {
    assert.deepEqual(
      sample.documentDetails.map((d) => d.key).sort(),
      ROLE_DOCS[sample.role],
      sample.role
    );
    assert.ok(sample.documentDetails.every((d) => d.effectiveAt === "2026-10-23"));
  }

  const user = preview.samples.find((s) => s.role === "USER");
  const influencer = preview.samples.find((s) => s.role === "INFLUENCER");
  const vendor = preview.samples.find((s) => s.role === "VENDOR");

  // clientul / influencerul nu văd documente sau termeni comerciali de vânzător
  for (const sample of [user, influencer]) {
    assert.doesNotMatch(sample.text, /Vânzători|vânzător|Stripe Connect|comision|livrare — Artfest|Anexa Produse/i);
  }
  assert.doesNotMatch(influencer.text, /Politica de retur/);

  // vânzătorul: CTA spre acordul vânzătorilor, ton comercial
  assert.match(vendor.text, /Vezi versiunea actualizată: .*\/legal\/vendor_terms\/v\/2\.0\.0\.html/);
  assert.match(vendor.text, /regulile comerciale și operaționale/);
  assert.match(user.text, /Vezi versiunea actualizată: .*\/legal\/tos\/v\/2\.0\.0\.html/);

  // destinatari pe categorie
  assert.equal(user.recipients, 2);
  assert.equal(vendor.recipients, 2);
  assert.equal(influencer.recipients, 1);
});

test("preaviz: aceeași adresă cu mai multe conturi (client + vânzător) primește UN singur email, cu tonul de vânzător", async () => {
  const w = world();
  // altă scriere a aceleiași adrese (unicitatea din DB e sensibilă la majuscule)
  w.prisma.seed("user", [{ email: "V1@T.RO", role: "USER" }]);

  const { send, calls } = fakeNoticeSend(w);
  const result = await sendLegalNotice({ kind: "notice", confirm: true, prisma: w.prisma, send, now: NOTICE_NOW });

  const toV1 = calls.filter((c) => c.to.toLowerCase() === "v1@t.ro");
  assert.equal(toV1.length, 1, "un singur email pentru adresă");
  assert.equal(toV1[0].audience, "VENDOR");
  assert.deepEqual(toV1[0].documents.map((d) => d.key).sort(), ROLE_DOCS.VENDOR);
  assert.equal(result.recipients, 5);
  assert.equal(new Set(calls.map((c) => c.to.toLowerCase())).size, calls.length, "nicio adresă de două ori");
});

test("preaviz: preview = conținutul trimis (același builder, aceleași documente, pe fiecare rol)", async () => {
  const { buildLegalNoticeEmail } = await import("../lib/mailer.js");
  const w = world();
  const preview = await previewLegalNotice({ kind: "notice", prisma: w.prisma, now: NOTICE_NOW });
  const { send, calls } = fakeNoticeSend(w);

  await sendLegalNotice({ kind: "notice", confirm: true, prisma: w.prisma, send, now: NOTICE_NOW });

  for (const [email, role] of [
    ["u1@t.ro", "USER"],
    ["v1@t.ro", "VENDOR"],
    ["i1@t.ro", "INFLUENCER"],
  ]) {
    const payload = calls.find((c) => c.to === email);
    const sample = preview.samples.find((s) => s.role === role);
    const sentMail = buildLegalNoticeEmail(payload); // exact ce face sendLegalNoticeEmail

    assert.equal(payload.audience, role);
    assert.equal(sentMail.subject, sample.subject, role);
    assert.equal(sentMail.html, sample.html, role);
    assert.equal(sentMail.text, sample.text, role);
  }
});

test("rezumat pe audiență: derivat DOAR din changeSummary-ul din manifest (marcaje [ROL] sau obiect)", () => {
  const tagged = "[ALL] Text pentru toți.\n[VENDOR] Colecțiile înlocuiesc campaniile.\n[USER,INFLUENCER] Atribuirea nu mai e salvată pe dispozitiv.";

  assert.equal(summaryForAudience(tagged, "VENDOR"), "Text pentru toți.\nColecțiile înlocuiesc campaniile.");
  assert.equal(summaryForAudience(tagged, "USER"), "Text pentru toți.\nAtribuirea nu mai e salvată pe dispozitiv.");
  assert.equal(summaryForAudience("[VENDOR] Doar vânzători.", "USER"), null);
  assert.equal(summaryForAudience("Text general.", "INFLUENCER"), "Text general.");
  assert.equal(summaryForAudience({ VENDOR: "V", ALL: "A" }, "VENDOR"), "V");
  assert.equal(summaryForAudience({ VENDOR: "V", ALL: "A" }, "USER"), "A");
  assert.equal(summaryForAudience(null, "USER"), null);
  assert.equal(toneAudience(["USER", "VENDOR"]), "VENDOR");
  assert.equal(toneAudience(["USER", "INFLUENCER"]), "INFLUENCER");
  assert.equal(toneAudience(["ADMIN"]), null);
});
