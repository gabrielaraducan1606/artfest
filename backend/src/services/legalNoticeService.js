// src/services/legalNoticeService.js
//
// Două acțiuni de Admin, SEPARATE de publicare și de reacceptare:
//
//   PREAVIZ (kind "notice")  - înainte de intrarea în vigoare: informează
//     despre versiunile VIITOARE (status "upcoming" în manifest, date complete,
//     effectiveAt setat). NU activează nimic, NU cere acceptare.
//   ACTUALIZARE (kind "update") - după ce versiunea nouă e ÎN VIGOARE: anunță
//     intrarea în vigoare; menționează acceptarea DOAR dacă există o cerere de
//     reacceptare deschisă (Admin -> "Cere reacceptarea") pentru acea versiune.
//
// Fără tabele noi:
//   PolicyGateCampaign = campania (campaignKey "ntc_..." / "upd_..." - prefixe
//     pe care mecanismul de reacceptare NU le citește; documents[] codificat
//     "TYPE@NOTICE|UPDATE@VERSION[@effectiveAt]", ignorat de parseRequirement);
//   EmailLog = cine a primit ce (template "legal_notice:<campaignKey>",
//     SENT / FAILED + eroare + sentAt).
//
// Anti-duplicate:
//   - campaignKey e DETERMINIST pe pachetul de documente/versiuni și unic în
//     DB -> al doilea click pe "Trimite" e refuzat (409), nu retrimite;
//   - la (re)trimitere, cine are deja EmailLog SENT pentru campanie e sărit;
//   - "Retrimite eșuate" atinge DOAR adresele cu FAILED și fără SENT;
//   - o singură rulare per campanie odată (lock în proces).
//
// Un singur email AGREGAT per destinatar, cu documentele rolului său.

import crypto from "node:crypto";

import { prisma as defaultPrisma } from "../db.js";
import {
  buildLegalNoticeEmail,
  legalNoticeTemplate,
  sendLegalNoticeEmail as defaultSend,
} from "../lib/mailer.js";
import {
  findUpcomingLegalDoc,
  loadLegalDocByPolicyVersion,
} from "../lib/legal.js";
import { AUDIENCES, LEGAL_DOCUMENTS } from "./legalRegistry.js";
import { getPublishedInfo, loadPublishedLegalDoc } from "./legalPublishedService.js";
import { getOpenRequirements } from "./reacceptanceService.js";

export const NOTICE_CAMPAIGN_PREFIX = "ntc_";
export const UPDATE_CAMPAIGN_PREFIX = "upd_";
export const MIN_NOTICE_DAYS = 15;

const KIND_PREFIX = { notice: NOTICE_CAMPAIGN_PREFIX, update: UPDATE_CAMPAIGN_PREFIX };
const KIND_TOKEN = { notice: "NOTICE", update: "UPDATE" };

const ROLE_AUDIENCE = { USER: "USER", VENDOR: "VENDOR", INFLUENCER: "INFLUENCER" };

// zona din cont unde se acceptă (doar email de actualizare cu reacceptare)
const ACCEPT_LINKS = {
  USER: "/cont?policyGate=1&scope=USERS",
  VENDOR: "/desktop?policyGate=1&scope=VENDORS",
  INFLUENCER: "/influencer",
};

const running = new Set();

function fail(status, code, message, extra = {}) {
  const error = new Error(message || code);
  error.status = status;
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function normalizeKind(kind) {
  const value = String(kind || "notice").toLowerCase();
  if (!KIND_PREFIX[value]) throw fail(400, "invalid_kind", "Tip de notificare invalid.");
  return value;
}

/* ----------------------------------------------------
   Documente și audiențe
----------------------------------------------------- */

function manifestTypes() {
  return [...new Set(LEGAL_DOCUMENTS.map((entry) => entry.manifestType))];
}

/*
 * Audiențele unui document din manifest = reuniunea rândurilor din registry.
 * Cookies e informativ (fără audiență contractuală): apare ca rând informativ
 * în emailul agregat al oricărui rol, fără email separat.
 */
export function audiencesForType(type) {
  const entries = LEGAL_DOCUMENTS.filter((entry) => entry.manifestType === type);
  const set = new Set(entries.flatMap((entry) => entry.audiences || []));

  if (entries.some((entry) => entry.informational)) {
    for (const audience of AUDIENCES) set.add(audience);
  }

  return [...set];
}

function bucharestDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest" }).format(date);
}

/** Zile calendaristice (ora României) de azi până la effectiveAt. */
export function daysUntilEffective(effectiveAt, now = new Date()) {
  if (!effectiveAt) return null;

  const raw = String(effectiveAt);
  const target = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : bucharestDay(raw);
  const today = bucharestDay(now);

  if (!target || !today) return null;

  return Math.round((Date.parse(`${target}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}

function noticeDocFrom(type, upcoming, current) {
  return {
    key: type,
    title: upcoming.title,
    version: String(upcoming.policyVersion),
    currentVersion: current ? String(current.policyVersion) : null,
    url: upcoming.versionHtmlUrl,
    currentUrl: `/legal/${type}.html`,
    effectiveAt: upcoming.effectiveAt || null,
    changeSummary: upcoming.changeSummary || null,
    audiences: audiencesForType(type),
  };
}

/* Versiunile VIITOARE (publice pentru consultare) pentru preaviz. */
async function upcomingNoticeDocuments(prisma) {
  const docs = [];

  for (const type of manifestTypes()) {
    const current = await loadPublishedLegalDoc(type, prisma);
    const upcoming = findUpcomingLegalDoc(type, current.manifestVersion);

    if (upcoming) docs.push(noticeDocFrom(type, upcoming, current));
  }

  return docs;
}

/*
 * Versiunile ÎN VIGOARE care au înlocuit o versiune anterioară (manifest > 1).
 * Pentru documentele contractuale versiunea trebuie să fie ACTIVĂ în DB
 * (publicată), nu doar „current” în manifest.
 */
async function activeUpdatedDocuments(prisma) {
  const docs = [];

  for (const type of manifestTypes()) {
    const current = await loadPublishedLegalDoc(type, prisma);
    if (!(Number(current.manifestVersion) > 1)) continue;

    const contractual = LEGAL_DOCUMENTS.filter((e) => e.manifestType === type && e.contractual);
    if (contractual.length) {
      const infos = await Promise.all(contractual.map((e) => getPublishedInfo(e.catalogId, prisma)));
      const activeInDb = infos.some(
        (info) => info?.source === "policy" && String(info.version) === String(current.policyVersion)
      );
      if (!activeInDb) continue;
    }

    docs.push({
      key: type,
      title: current.title,
      version: String(current.policyVersion),
      currentVersion: null,
      url: `/legal/${type}.html`,
      currentUrl: null,
      effectiveAt: current.effectiveAt || current.valid_from || null,
      changeSummary: current.changeSummary || null,
      audiences: audiencesForType(type),
    });
  }

  return docs;
}

function encodeDoc(kind, doc) {
  const parts = [doc.key.toUpperCase(), KIND_TOKEN[kind], doc.version];
  if (kind === "notice" && doc.effectiveAt) parts.push(String(doc.effectiveAt));
  return parts.join("@");
}

function decodeDoc(raw) {
  const [type, token, version, effectiveAt] = String(raw || "").split("@");
  if (!type || !version || !["NOTICE", "UPDATE"].includes(token)) return null;
  return { key: type.toLowerCase(), kind: token === "NOTICE" ? "notice" : "update", version, effectiveAt: effectiveAt || null };
}

export function campaignKeyFor(kind, documents) {
  const signature = documents
    .map((doc) => `${doc.key}@${doc.version}`)
    .sort()
    .join("|");
  const hash = crypto.createHash("sha256").update(`${kind}|${signature}`).digest("hex").slice(0, 16);
  return `${KIND_PREFIX[kind]}${hash}`;
}

async function campaignsOfKind(kind, prisma) {
  return prisma.policyGateCampaign.findMany({
    where: { campaignKey: { startsWith: KIND_PREFIX[kind] } },
    orderBy: { createdAt: "desc" },
  });
}

/* documente deja acoperite de o campanie de acest tip (type@version) */
function coveredSet(campaigns) {
  const covered = new Map();

  for (const campaign of campaigns) {
    for (const raw of campaign.documents || []) {
      const doc = decodeDoc(raw);
      const id = doc && `${doc.key}@${doc.version}`;
      if (id && !covered.has(id)) covered.set(id, campaign);
    }
  }

  return covered;
}

/* ----------------------------------------------------
   Destinatari (un email agregat per persoană)
----------------------------------------------------- */

async function reacceptanceIndex(kind, prisma) {
  if (kind !== "update") return new Set();

  const open = await getOpenRequirements({ prisma });
  return new Set(open.map((r) => `${r.key}|${r.audience}|${r.version}`));
}

function entryKeyForType(type) {
  return LEGAL_DOCUMENTS.find((e) => e.manifestType === type)?.key || type.toUpperCase();
}

function docsForRole(kind, documents, role, requirements) {
  const audience = ROLE_AUDIENCE[role];
  if (!audience) return [];

  return documents
    .filter((doc) => doc.audiences.includes(audience))
    .map((doc) => ({
      ...doc,
      reacceptanceRequired:
        kind === "update" && requirements.has(`${entryKeyForType(doc.key)}|${audience}|${doc.version}`),
    }));
}

async function planRecipients({ kind, documents, prisma, onlyEmails = null }) {
  const requirements = await reacceptanceIndex(kind, prisma);

  const users = await prisma.user.findMany({
    where: { role: { in: Object.keys(ROLE_AUDIENCE) }, status: "ACTIVE" },
    select: { id: true, email: true, name: true, firstName: true, role: true },
  });

  const byEmail = new Map();
  let withoutEmail = 0;

  for (const user of users) {
    const docs = docsForRole(kind, documents, user.role, requirements);
    if (!docs.length) continue;

    const email = String(user.email || "").trim();
    if (!email) {
      withoutEmail += 1;
      continue;
    }

    const id = email.toLowerCase();
    if (onlyEmails && !onlyEmails.has(id)) continue;
    if (byEmail.has(id)) continue;

    byEmail.set(id, {
      userId: user.id,
      email,
      name: user.firstName || user.name || "",
      role: user.role,
      documents: docs,
      acceptLink: ACCEPT_LINKS[user.role] || "",
    });
  }

  const recipients = [...byEmail.values()];
  const byRole = {};
  for (const r of recipients) byRole[r.role] = (byRole[r.role] || 0) + 1;

  return { recipients, byRole, withoutEmail };
}

/* ----------------------------------------------------
   Raport (din EmailLog)
----------------------------------------------------- */

export async function legalNoticeReport({ campaignId, prisma = defaultPrisma }) {
  const campaign = await prisma.policyGateCampaign.findUnique({ where: { id: String(campaignId) } });

  if (
    !campaign ||
    ![NOTICE_CAMPAIGN_PREFIX, UPDATE_CAMPAIGN_PREFIX].some((p) => String(campaign.campaignKey).startsWith(p))
  ) {
    throw fail(404, "notice_not_found", "Campania nu există.");
  }

  const logs = await prisma.emailLog.findMany({
    where: { template: legalNoticeTemplate(campaign.campaignKey) },
    select: { toEmail: true, status: true, error: true, sentAt: true, createdAt: true },
  });

  const perEmail = new Map();
  for (const log of logs) {
    const id = String(log.toEmail).toLowerCase();
    const row = perEmail.get(id) || { email: log.toEmail, sent: false, lastError: null, lastAt: null };
    if (log.status === "SENT") row.sent = true;
    if (log.status === "FAILED") row.lastError = log.error || "send_failed";
    const at = log.sentAt || log.createdAt;
    if (at && (!row.lastAt || new Date(at) > new Date(row.lastAt))) row.lastAt = at;
    perEmail.set(id, row);
  }

  const rows = [...perEmail.values()];
  const failedRecipients = rows
    .filter((r) => !r.sent && r.lastError)
    .map((r) => ({ email: r.email, error: r.lastError, at: r.lastAt }));

  const creator = campaign.createdById
    ? await prisma.user.findUnique({ where: { id: campaign.createdById }, select: { email: true } })
    : null;

  const kind = String(campaign.campaignKey).startsWith(NOTICE_CAMPAIGN_PREFIX) ? "notice" : "update";

  return {
    campaignId: campaign.id,
    campaignKey: campaign.campaignKey,
    kind,
    createdAt: campaign.createdAt,
    createdById: campaign.createdById || null,
    createdByEmail: creator?.email || null,
    subject: campaign.emailSubject || campaign.title,
    documents: (campaign.documents || []).map(decodeDoc).filter(Boolean),
    recipients: campaign.targetCount ?? 0,
    delivered: rows.filter((r) => r.sent).length,
    failed: failedRecipients.length,
    failedRecipients,
    exception: campaign.message?.startsWith("EXCEPȚIE") ? campaign.message : null,
  };
}

/* ----------------------------------------------------
   Preview (fără trimitere)
----------------------------------------------------- */

export async function previewLegalNotice({ kind: rawKind, prisma = defaultPrisma, now = new Date() }) {
  const kind = normalizeKind(rawKind);
  const blockers = [];

  const candidates =
    kind === "notice" ? await upcomingNoticeDocuments(prisma) : await activeUpdatedDocuments(prisma);

  const covered = coveredSet(await campaignsOfKind(kind, prisma));
  let documents = candidates.filter((doc) => !covered.has(`${doc.key}@${doc.version}`));
  const alreadyCovered = candidates
    .filter((doc) => covered.has(`${doc.key}@${doc.version}`))
    .map((doc) => ({ key: doc.key, version: doc.version, campaignId: covered.get(`${doc.key}@${doc.version}`).id }));

  let effectiveAt = null;

  if (kind === "notice") {
    const missingDate = documents.filter((doc) => !doc.effectiveAt);
    if (missingDate.length) {
      blockers.push(`Lipsește data intrării în vigoare (effectiveAt): ${missingDate.map((d) => d.key).join(", ")}.`);
    }

    // un preaviz = un pachet cu aceeași dată de intrare în vigoare (cea mai apropiată)
    const dates = [...new Set(documents.map((doc) => doc.effectiveAt).filter(Boolean))].sort();
    effectiveAt = dates[0] || null;
    documents = documents.filter((doc) => doc.effectiveAt && doc.effectiveAt === effectiveAt);
  } else {
    effectiveAt = documents.map((d) => d.effectiveAt).filter(Boolean).sort()[0] || null;
  }

  if (!documents.length) {
    blockers.push(
      kind === "notice"
        ? alreadyCovered.length
          ? "Preavizul pentru versiunile viitoare a fost deja trimis."
          : "Nu există versiuni viitoare publicabile (status upcoming, date complete)."
        : alreadyCovered.length
          ? "Notificarea de actualizare a fost deja trimisă pentru versiunile în vigoare."
          : "Nu există versiuni noi în vigoare (publicate) pentru care să se trimită notificarea."
    );
  }

  const daysUntil = kind === "notice" ? daysUntilEffective(effectiveAt, now) : null;
  const noticePeriodOk = kind !== "notice" || (daysUntil != null && daysUntil >= MIN_NOTICE_DAYS);

  const plan = documents.length
    ? await planRecipients({ kind, documents, prisma })
    : { recipients: [], byRole: {}, withoutEmail: 0 };

  // un exemplu de email per rol (preview real, fără trimitere)
  const samples = [];
  for (const role of Object.keys(ROLE_AUDIENCE)) {
    const docs = docsForRole(kind, documents, role, await reacceptanceIndex(kind, prisma));
    if (!docs.length) continue;
    const email = buildLegalNoticeEmail({ kind, documents: docs, acceptLink: ACCEPT_LINKS[role] });
    samples.push({ role, documents: docs.map((d) => d.title), ...email });
  }

  return {
    kind,
    available: documents.length > 0 && !blockers.length,
    blockers,
    campaignKey: documents.length ? campaignKeyFor(kind, documents) : null,
    effectiveAt,
    daysUntilEffective: daysUntil,
    minNoticeDays: MIN_NOTICE_DAYS,
    noticePeriodOk,
    documents: documents.map(({ audiences, ...doc }) => ({ ...doc, audiences })),
    alreadyCovered,
    recipients: {
      total: plan.recipients.length,
      byRole: plan.byRole,
      withoutEmail: plan.withoutEmail,
    },
    subject: samples.find((s) => s.role === "USER")?.subject || samples[0]?.subject || null,
    samples,
  };
}

/* ----------------------------------------------------
   Livrare (idempotentă)
----------------------------------------------------- */

async function mapLimit(items, limit, worker) {
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    results.push(...(await Promise.allSettled(batch.map(worker))));
  }
  return results;
}

/* documentele campaniei, reconstruite din manifest (pentru retrimitere) */
async function documentsOfCampaign(kind, campaign, prisma) {
  const docs = [];

  for (const decoded of (campaign.documents || []).map(decodeDoc).filter(Boolean)) {
    const doc = loadLegalDocByPolicyVersion(decoded.key, decoded.version);
    if (!doc) continue;

    if (kind === "notice") {
      const current = await loadPublishedLegalDoc(decoded.key, prisma);
      docs.push(noticeDocFrom(decoded.key, doc, current));
    } else {
      docs.push({
        key: decoded.key,
        title: doc.title,
        version: String(doc.policyVersion),
        currentVersion: null,
        url: `/legal/${decoded.key}.html`,
        currentUrl: null,
        effectiveAt: doc.effectiveAt || doc.valid_from || null,
        changeSummary: doc.changeSummary || null,
        audiences: audiencesForType(decoded.key),
      });
    }
  }

  return docs;
}

async function deliver({ campaign, kind, recipients, prisma, send, batchSize }) {
  if (running.has(campaign.id)) {
    throw fail(409, "notice_send_in_progress", "Trimiterea pentru această campanie este deja în curs.");
  }

  running.add(campaign.id);

  try {
    const template = legalNoticeTemplate(campaign.campaignKey);
    const alreadySent = new Set(
      (
        await prisma.emailLog.findMany({
          where: { template, status: "SENT" },
          select: { toEmail: true },
        })
      ).map((row) => String(row.toEmail).toLowerCase())
    );

    const toSend = recipients.filter((r) => !alreadySent.has(r.email.toLowerCase()));

    const results = await mapLimit(toSend, batchSize, (r) =>
      send({
        to: r.email,
        name: r.name,
        kind,
        documents: r.documents,
        acceptLink: r.acceptLink,
        campaignKey: campaign.campaignKey,
        userId: r.userId,
      })
    );

    const failed = results.filter((r) => r.status === "rejected").length;

    await prisma.policyGateCampaign.update({
      where: { id: campaign.id },
      data: { emailQueued: recipients.length, emailFailed: failed },
    });

    return {
      attempted: toSend.length,
      sent: toSend.length - failed,
      failed,
      alreadySent: recipients.length - toSend.length,
    };
  } finally {
    running.delete(campaign.id);
  }
}

/**
 * „Trimite preaviz” / „Trimite notificare de actualizare” - DOAR la cererea
 * explicită a adminului (confirm: true). Nu activează documente și nu creează
 * cereri de reacceptare.
 *
 * exception: { confirmed: true, reason } - doar pentru preaviz sub 15 zile,
 * când operatorul invocă explicit o excepție legală (nu se presupune).
 */
export async function sendLegalNotice({
  kind: rawKind,
  confirm = false,
  exception = null,
  actorId = null,
  prisma = defaultPrisma,
  send = defaultSend,
  now = new Date(),
  batchSize = 10,
}) {
  const kind = normalizeKind(rawKind);

  if (confirm !== true) {
    throw fail(400, "confirmation_required", "Confirmă trimiterea din dialog.");
  }

  const preview = await previewLegalNotice({ kind, prisma, now });

  if (!preview.available) {
    throw fail(409, "notice_not_available", preview.blockers.join(" "), { blockers: preview.blockers });
  }

  const exceptionReason = String(exception?.reason || "").trim();
  if (!preview.noticePeriodOk && !(exception?.confirmed === true && exceptionReason)) {
    throw fail(
      422,
      "notice_period_too_short",
      `Au rămas ${preview.daysUntilEffective ?? "?"} zile până la intrarea în vigoare (minimum ${MIN_NOTICE_DAYS}). Trimiterea e blocată, cu excepția unui caz legal exceptat, confirmat explicit.`,
      { daysUntilEffective: preview.daysUntilEffective }
    );
  }

  const documents = preview.documents;
  const plan = await planRecipients({ kind, documents, prisma });
  const effectiveLabel = preview.effectiveAt || "";

  let campaign;
  try {
    campaign = await prisma.policyGateCampaign.create({
      data: {
        campaignKey: preview.campaignKey,
        scope: "USERS",
        requiresAction: false,
        title:
          kind === "notice"
            ? `Preaviz documente legale (intrare în vigoare ${effectiveLabel})`
            : "Notificare: documente legale actualizate în vigoare",
        message:
          !preview.noticePeriodOk && exceptionReason
            ? `EXCEPȚIE termen preaviz (${preview.daysUntilEffective} zile): ${exceptionReason}`
            : `Trimis din Admin pentru ${documents.map((d) => `${d.key} ${d.version}`).join(", ")}`,
        sendEmail: true,
        emailSubject: preview.subject,
        documents: documents.map((doc) => encodeDoc(kind, doc)),
        targetCount: plan.recipients.length,
        createdCount: plan.recipients.length,
        createdById: actorId,
      },
    });
  } catch (error) {
    if (error?.code === "P2002") {
      throw fail(409, "notice_already_sent", "Această notificare a fost deja trimisă. Folosește „Retrimite eșuate”.");
    }
    throw error;
  }

  const delivery = await deliver({ campaign, kind, recipients: plan.recipients, prisma, send, batchSize });

  return {
    ok: true,
    kind,
    campaignId: campaign.id,
    campaignKey: campaign.campaignKey,
    recipients: plan.recipients.length,
    ...delivery,
    // explicit: preavizul / notificarea nu activează și nu cer acceptare
    activated: false,
    reacceptanceRequested: false,
  };
}

/** „Retrimite eșuate”: doar adresele cu FAILED și fără SENT pentru campanie. */
export async function resendFailedLegalNotice({
  campaignId,
  prisma = defaultPrisma,
  send = defaultSend,
  batchSize = 10,
}) {
  const report = await legalNoticeReport({ campaignId, prisma });

  if (!report.failedRecipients.length) {
    return { ok: true, campaignId: report.campaignId, attempted: 0, sent: 0, failed: 0, alreadySent: report.delivered };
  }

  const campaign = await prisma.policyGateCampaign.findUnique({ where: { id: report.campaignId } });
  const documents = await documentsOfCampaign(report.kind, campaign, prisma);
  const onlyEmails = new Set(report.failedRecipients.map((r) => String(r.email).toLowerCase()));
  const plan = await planRecipients({ kind: report.kind, documents, prisma, onlyEmails });

  const delivery = await deliver({
    campaign,
    kind: report.kind,
    recipients: plan.recipients,
    prisma,
    send,
    batchSize,
  });

  return { ok: true, campaignId: campaign.id, ...delivery };
}

/** Starea pentru Admin: preview-urile + ultimele campanii, per document. */
export async function legalNoticeOverview({ prisma = defaultPrisma, now = new Date() } = {}) {
  const result = { byDocument: {} };

  for (const kind of ["notice", "update"]) {
    const preview = await previewLegalNotice({ kind, prisma, now });
    const campaigns = await campaignsOfKind(kind, prisma);
    const reports = [];

    for (const campaign of campaigns.slice(0, 20)) {
      reports.push(await legalNoticeReport({ campaignId: campaign.id, prisma }));
    }

    for (const report of reports) {
      for (const doc of report.documents) {
        const slot = (result.byDocument[doc.key] ||= {});
        if (!slot[kind]) {
          slot[kind] = {
            campaignId: report.campaignId,
            version: doc.version,
            sentAt: report.createdAt,
            recipients: report.recipients,
            delivered: report.delivered,
            failed: report.failed,
            createdByEmail: report.createdByEmail,
          };
        }
      }
    }

    for (const doc of preview.documents) {
      const slot = (result.byDocument[doc.key] ||= {});
      slot[`${kind}Pending`] = { version: doc.version, effectiveAt: doc.effectiveAt };
    }

    const { samples, ...summary } = preview;
    result[kind] = { ...summary, sampleCount: samples.length, campaigns: reports };
  }

  return result;
}
