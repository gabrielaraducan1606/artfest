// backend/src/services/influencerComplianceGate.js

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { marked } from "marked";
import yaml from "yaml";

import { prisma as defaultPrisma } from "../db.js";
import * as notifications from "./notifications.js";
// namespace (ca returnRequestService.js): funcțiile se rezolvă la apel, deci
// testele care simulează mailer-ul doar parțial pot importa serviciul
import * as mailer from "../lib/mailer.js";
import { PAYOUT_INVOICE_MISSING_MESSAGE } from "./influencerPayoutService.js";

/*
 * Gate de conformitate pentru influenceri - aplicat MANUAL de admin unor
 * influenceri selectați (ex. MINOR_PARENTAL_CONSENT). Nu se activează
 * automat (nici după vârstă).
 *
 * Starea = ultimul gate al influencerului (istoric complet în
 * InfluencerComplianceGate, răspunsul în InfluencerComplianceResponse):
 *   - fără gate              -> NOT_REQUIRED, nimic blocat;
 *   - PENDING                -> acces permis, acțiuni comerciale/financiare
 *                               blocate (428), payout blocat;
 *   - COMPLETED              -> deblocat;
 *   - CANCELLED / REJECTED / EXPIRED -> rămân blocate; deblocarea se face
 *                               DOAR printr-un gate nou ajuns COMPLETED.
 * Atribuirea codurilor/linkurilor existente și acumularea earning-urilor
 * NU sunt atinse - doar payout-ul și acțiunile comerciale noi.
 *
 * Feature flag (backend): INFLUENCER_COMPLIANCE_GATE_ENABLED = "1"/"true".
 * Oprit (implicit, inclusiv în producție) -> NIMIC nu e blocat, adminul nu
 * poate trimite gate-uri, nu pleacă emailuri, iar statusul nu interoghează
 * DB-ul. Rămâne oprit până la aprobarea documentelor legale aplicabile.
 */

export const COMPLIANCE_GATE_TYPE = "MINOR_PARENTAL_CONSENT";
export const COMPLIANCE_DOCUMENT_KEY = "influencer_minor_consent";
export const COMPLIANCE_GATE_TTL_DAYS = 30;
export const COMPLIANCE_PAYOUT_BLOCKED_MESSAGE = "Plăți blocate până la finalizarea conformității.";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEGAL_DIR = path.resolve(__dirname, "../../legal");
// DRAFT: nu e în legal/manifest.yml (nepublicat) - vezi frontmatter-ul fișierului
const DOCUMENT_PATH = path.join(LEGAL_DIR, "drafts", COMPLIANCE_DOCUMENT_KEY, "v1.md");
const VARS_PATH = path.join(LEGAL_DIR, "vars", "v1.yml");

export const GUARDIAN_RELATIONSHIPS = Object.freeze(["PARENT", "LEGAL_GUARDIAN"]);

// cele 5 declarații + confirmarea calității de părinte/tutore (toate obligatorii)
export const REQUIRED_DECLARATIONS = Object.freeze([
  "guardianConfirmed",
  "readDocuments",
  "consentParticipation",
  "consentDataProcessing",
  "infoAccurate",
  "withdrawalInfo",
]);

export class ComplianceGateError extends Error {
  constructor(code, message, httpStatus = 400, extra = {}) {
    super(message);
    this.name = "ComplianceGateError";
    this.code = code;
    this.httpStatus = httpStatus;
    Object.assign(this, extra);
  }
}

export function isComplianceGateEnabled(env = process.env) {
  const raw = String(env?.INFLUENCER_COMPLIANCE_GATE_ENABLED ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

function assertEnabled(env) {
  if (!isComplianceGateEnabled(env)) {
    throw new ComplianceGateError(
      "compliance_gate_disabled",
      "Gate-ul de conformitate nu este încă activ.",
      409
    );
  }
}

/* ============================================================
   Documentul (draft versionat) - text exact + SHA-256
============================================================ */

function renderVars(value, vars) {
  return String(value ?? "").replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, key) => {
    let current = vars;
    for (const part of key.split(".")) {
      if (current && Object.prototype.hasOwnProperty.call(current, part)) current = current[part];
      else return "";
    }
    return current == null ? "" : String(current);
  });
}

let documentCache = null;

export function loadMinorConsentDocument() {
  if (documentCache) return documentCache;
  const raw = fs.readFileSync(DOCUMENT_PATH, "utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const parsed = matter(raw);
  const vars = yaml.parse(fs.readFileSync(VARS_PATH, "utf8")) || {};
  const title = renderVars(parsed.data?.title, vars).trim();
  const content = renderVars(parsed.content, vars).trim();
  const version = String(parsed.data?.semver || parsed.data?.version || "1").trim();
  // același principiu ca lib/legal.js (renderedChecksum): textul final, cu vars
  const checksum = crypto
    .createHash("sha256")
    .update(JSON.stringify({ type: COMPLIANCE_DOCUMENT_KEY, title, version, content }), "utf8")
    .digest("hex");
  documentCache = {
    key: COMPLIANCE_DOCUMENT_KEY,
    version,
    title,
    status: String(parsed.data?.status || "draft"),
    html: marked.parse(content),
    checksum,
  };
  return documentCache;
}

/* ============================================================
   Stare (pură)
============================================================ */

export function effectiveGateStatus(gate, now = new Date()) {
  if (!gate) return "NOT_REQUIRED";
  if (gate.status === "PENDING" && gate.expiresAt && new Date(gate.expiresAt) <= now) return "EXPIRED";
  return gate.status;
}

export function publicGate(gate, now = new Date()) {
  if (!gate) return null;
  return {
    id: gate.id,
    type: gate.type,
    status: effectiveGateStatus(gate, now),
    sentAt: gate.sentAt || null,
    expiresAt: gate.expiresAt || null,
    completedAt: gate.completedAt || null,
    cancelledAt: gate.cancelledAt || null,
    rejectedAt: gate.rejectedAt || null,
    requiredDocumentVersion: gate.requiredDocumentVersion,
  };
}

export function computeComplianceState(latestGate, now = new Date()) {
  const status = effectiveGateStatus(latestGate, now);
  return {
    status,
    blocking: status !== "NOT_REQUIRED" && status !== "COMPLETED",
    canSubmit: status === "PENDING",
    gate: publicGate(latestGate, now),
  };
}

async function latestGateFor(db, influencerId) {
  return db.influencerComplianceGate.findFirst({
    where: { influencerId },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Starea pentru un influencer. Flag oprit -> NOT_REQUIRED fără interogare DB.
 */
export async function getInfluencerComplianceStatus(
  influencerId,
  { db = defaultPrisma, now = new Date(), env = process.env } = {}
) {
  if (!isComplianceGateEnabled(env) || !influencerId) {
    return { enabled: isComplianceGateEnabled(env), status: "NOT_REQUIRED", blocking: false, canSubmit: false, gate: null };
  }
  const latest = await latestGateFor(db, influencerId);
  return { enabled: true, ...computeComplianceState(latest, now) };
}

export function complianceBlockedBody(state) {
  return {
    error: "influencer_compliance_required",
    message:
      "Această acțiune este disponibilă după completarea acordului de conformitate (părinte / tutore legal).",
    compliance: { status: state.status, gateId: state.gate?.id || null, formUrl: "/influencer/conformitate" },
  };
}

/**
 * Payout (admin): blocat cât timp ultimul gate nu e COMPLETED.
 */
export async function assertPayoutAllowedForInfluencer(influencerId, opts = {}) {
  const state = await getInfluencerComplianceStatus(influencerId, opts);
  if (state.blocking) {
    throw new ComplianceGateError(
      "compliance_gate_payout_blocked",
      `${COMPLIANCE_PAYOUT_BLOCKED_MESSAGE} Doar un acord de conformitate COMPLETED deblochează plățile.`,
      409,
      { compliance: { status: state.status, gateId: state.gate?.id || null } }
    );
  }
}

/* ============================================================
   Admin
============================================================ */

async function lockInfluencer(tx, influencerId) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`influencer-compliance:${influencerId}`}))`;
}

async function loadInfluencer(db, influencerId) {
  const profile = await db.influencerProfile.findUnique({
    where: { id: String(influencerId || "") },
    select: {
      id: true,
      userId: true,
      displayName: true,
      user: { select: { id: true, email: true, firstName: true, lastName: true, name: true } },
    },
  });
  if (!profile) throw new ComplianceGateError("influencer_not_found", "Influencerul nu a fost găsit.", 404);
  return profile;
}

async function findOwnedGate(db, influencerId, gateId) {
  const gate = await db.influencerComplianceGate.findFirst({
    where: { id: String(gateId || ""), influencerId },
  });
  if (!gate) throw new ComplianceGateError("compliance_gate_not_found", "Gate-ul nu a fost găsit.", 404);
  return gate;
}

function defaultDeps(deps = {}) {
  return {
    db: deps.db || defaultPrisma,
    now: deps.now || (() => new Date()),
    env: deps.env || process.env,
    notify: deps.notify || ((...args) => notifications.createUserNotification(...args)),
    mail: {
      request: (args) => mailer.sendInfluencerComplianceRequestEmail(args),
      completed: (args) => mailer.sendInfluencerComplianceCompletedEmail(args),
      guardian: (args) => mailer.sendGuardianComplianceConfirmationEmail(args),
      payoutGuardian: (args) => mailer.sendGuardianPayoutProfileUpdatedEmail(args),
      ...(deps.mail || {}),
    },
  };
}

async function announceGate({ profile, gate, notify, mail }) {
  const userId = profile.userId;
  if (!userId) return;
  try {
    await notify(userId, {
      type: "system",
      title: "Este necesar acordul părintelui sau tutorelui",
      body: "Completează formularul de conformitate pentru a continua în programul Artfest.",
      link: "/influencer/conformitate",
      dedupeKey: `influencer_compliance:${gate.id}:sent`,
      meta: { kind: "influencer_compliance_request", gateId: gate.id },
    });
  } catch (e) {
    console.error("[compliance] notification failed:", e?.message || e);
  }
  try {
    if (profile.user?.email) {
      await mail.request({
        to: profile.user.email,
        firstName: profile.user.firstName || profile.user.name || null,
        expiresAt: gate.expiresAt,
        gateId: gate.id,
        userId,
      });
    }
  } catch (e) {
    console.error("[compliance] request email failed:", e?.message || e);
  }
}

function newGateData({ influencerId, adminId, now }) {
  const doc = loadMinorConsentDocument();
  return {
    influencerId,
    type: COMPLIANCE_GATE_TYPE,
    status: "PENDING",
    requiredDocumentKey: doc.key,
    requiredDocumentVersion: doc.version,
    sentAt: now,
    expiresAt: new Date(now.getTime() + COMPLIANCE_GATE_TTL_DAYS * 24 * 60 * 60 * 1000),
    createdByAdminId: adminId || null,
  };
}

export async function sendComplianceGate({ influencerId, adminId, birthDate = null }, deps = {}) {
  const { db, now, env, notify, mail } = defaultDeps(deps);
  assertEnabled(env);
  const profile = await loadInfluencer(db, influencerId);
  if (!profile.userId) {
    throw new ComplianceGateError("influencer_without_account", "Influencerul nu are un cont activ.", 409);
  }
  const at = now();
  await assertAgeAllowsGate(db, profile.id, birthDate, at);

  const gate = await db.$transaction(async (tx) => {
    await lockInfluencer(tx, profile.id);
    const latest = await latestGateFor(tx, profile.id);
    if (effectiveGateStatus(latest, at) === "PENDING") {
      throw new ComplianceGateError(
        "compliance_gate_pending",
        "Există deja un gate în așteptare. Folosește „Retrimite” sau „Anulează gate”.",
        409
      );
    }
    return tx.influencerComplianceGate.create({ data: newGateData({ influencerId: profile.id, adminId, now: at }) });
  });

  await announceGate({ profile, gate, notify, mail });
  return publicGate(gate, at);
}

export async function resendComplianceGate({ influencerId, gateId, adminId, birthDate = null }, deps = {}) {
  const { db, now, env, notify, mail } = defaultDeps(deps);
  assertEnabled(env);
  const profile = await loadInfluencer(db, influencerId);
  if (!profile.userId) {
    throw new ComplianceGateError("influencer_without_account", "Influencerul nu are un cont activ.", 409);
  }
  const at = now();
  await assertAgeAllowsGate(db, profile.id, birthDate, at);

  const gate = await db.$transaction(async (tx) => {
    await lockInfluencer(tx, profile.id);
    const old = await findOwnedGate(tx, profile.id, gateId);
    const latest = await latestGateFor(tx, profile.id);
    if (!latest || latest.id !== old.id) {
      throw new ComplianceGateError("compliance_gate_not_latest", "Poate fi retrimis doar ultimul gate.", 409);
    }

    const created = await tx.influencerComplianceGate.create({
      data: newGateData({ influencerId: profile.id, adminId, now: at }),
    });

    const oldStatus = effectiveGateStatus(old, at);
    await tx.influencerComplianceGate.update({
      where: { id: old.id },
      data: {
        replacedByGateId: created.id,
        ...(oldStatus === "PENDING"
          ? { status: "CANCELLED", cancelledAt: at, cancelledByAdminId: adminId || null }
          : old.status === "PENDING" && oldStatus === "EXPIRED"
          ? { status: "EXPIRED" }
          : {}),
      },
    });
    return created;
  });

  await announceGate({ profile, gate, notify, mail });
  return publicGate(gate, at);
}

export async function cancelComplianceGate({ influencerId, gateId, adminId }, deps = {}) {
  const { db, now, env } = defaultDeps(deps);
  assertEnabled(env);
  const at = now();
  const gate = await findOwnedGate(db, String(influencerId || ""), gateId);
  const res = await db.influencerComplianceGate.updateMany({
    where: { id: gate.id, status: "PENDING" },
    data: { status: "CANCELLED", cancelledAt: at, cancelledByAdminId: adminId || null },
  });
  if (res.count !== 1) {
    throw new ComplianceGateError("compliance_gate_not_pending", "Doar un gate în așteptare poate fi anulat.", 409);
  }
  return publicGate({ ...gate, status: "CANCELLED", cancelledAt: at }, at);
}

export async function rejectComplianceResponse({ influencerId, gateId, adminId, reason }, deps = {}) {
  const { db, now, env, notify } = defaultDeps(deps);
  assertEnabled(env);
  const cleanReason = String(reason ?? "").replace(/\s+/g, " ").trim();
  if (cleanReason.length < 3 || cleanReason.length > 500) {
    throw new ComplianceGateError("rejection_reason_invalid", "Scrie motivul respingerii (3–500 de caractere).", 400, {
      fields: ["reason"],
    });
  }
  const at = now();
  const profile = await loadInfluencer(db, influencerId);
  const gate = await findOwnedGate(db, profile.id, gateId);
  const res = await db.influencerComplianceGate.updateMany({
    where: { id: gate.id, status: "COMPLETED" },
    data: { status: "REJECTED", rejectedAt: at, rejectionReason: cleanReason, reviewedByAdminId: adminId || null },
  });
  if (res.count !== 1) {
    throw new ComplianceGateError("compliance_gate_not_completed", "Doar un răspuns completat poate fi respins.", 409);
  }
  if (profile.userId) {
    try {
      await notify(profile.userId, {
        type: "system",
        title: "Acordul de conformitate nu a fost acceptat",
        body: "Echipa Artfest a respins acordul trimis. Pentru detalii scrie-ne la support@artfest.ro.",
        link: "/influencer",
        dedupeKey: `influencer_compliance:${gate.id}:rejected`,
        meta: { kind: "influencer_compliance_rejected", gateId: gate.id },
      });
    } catch (e) {
      console.error("[compliance] rejection notification failed:", e?.message || e);
    }
  }
  return publicGate({ ...gate, status: "REJECTED", rejectedAt: at }, at);
}

/** Istoric pentru drawer-ul din Admin (fără datele de contact ale părintelui). */
export async function listComplianceGates(influencerId, deps = {}) {
  const { db, now, env } = defaultDeps(deps);
  // flag oprit: fără interogare DB (secțiunea arată doar „dezactivat”)
  if (!isComplianceGateEnabled(env)) {
    return { enabled: false, status: "NOT_REQUIRED", blocking: false, canSubmit: false, gate: null, history: [] };
  }
  const at = now();
  const gates = await db.influencerComplianceGate.findMany({
    where: { influencerId: String(influencerId || "") },
    orderBy: { createdAt: "desc" },
    // fără email / telefon / data nașterii - acelea doar în „Vezi răspunsul”
    include: {
      response: {
        select: {
          guardianName: true,
          guardianRelationship: true,
          acceptedAt: true,
          documentVersion: true,
          guardianEmailSentAt: true,
        },
      },
    },
  });
  const latest = gates[0] || null;
  return {
    enabled: isComplianceGateEnabled(env),
    ...computeComplianceState(latest, at),
    guardianPayoutNotifiedAt: await lastGuardianPayoutNotification(db, influencerId),
    history: gates.map((g) => ({
      ...publicGate(g, at),
      rejectionReason: g.rejectionReason || null,
      replacedByGateId: g.replacedByGateId || null,
      createdByAdminId: g.createdByAdminId || null,
      // acord parental: „completat de” = părintele/tutorele din răspuns (nu userul care a trimis)
      hasResponse: Boolean(g.response),
      completedBy: g.response?.guardianName || null,
      completedByRelationship: g.response?.guardianRelationship || null,
      acceptedAt: g.response?.acceptedAt || null,
      acceptedDocumentVersion: g.response?.documentVersion || null,
      guardianConfirmationSentAt: g.response?.guardianEmailSentAt || null,
    })),
  };
}

/* ============================================================
   Permisiunea de plată per payout (admin): factură + conformitate
============================================================ */

/**
 * Plata (marcare PAID) e permisă doar pentru un payout UNPAID cu factură
 * încărcată ȘI fără gate de conformitate blocant. Oglinda backendului:
 * markInfluencerPayoutAsPaid (409 payout_invoice_missing) +
 * assertPayoutAllowedForInfluencer (409 compliance_gate_payout_blocked).
 */
export function payoutPermission({ payout, compliance } = {}) {
  const invoiceUploaded = Boolean(payout?.invoiceId || payout?.invoice);
  if (payout?.status !== "UNPAID") {
    return { invoiceUploaded, payoutAllowed: false, payoutBlockedReasons: [], payoutBlockedMessages: [] };
  }
  const reasons = [];
  const messages = [];
  if (!invoiceUploaded) {
    reasons.push("invoice_missing");
    messages.push(PAYOUT_INVOICE_MISSING_MESSAGE);
  }
  if (compliance?.blocking) {
    reasons.push("compliance");
    messages.push(COMPLIANCE_PAYOUT_BLOCKED_MESSAGE);
  }
  return {
    invoiceUploaded,
    payoutAllowed: reasons.length === 0,
    payoutBlockedReasons: reasons,
    payoutBlockedMessages: messages,
  };
}

/* ============================================================
   Date de plată modificate -> părintele/tutorele e informat
============================================================ */

const PAYOUT_GUARDIAN_TEMPLATE = "influencer_payout_guardian";

// aceeași listă ca PATCH /payout-profile (influencerPayoutProfile.js)
export const PAYOUT_NOTIFY_FIELDS = Object.freeze([
  "beneficiaryType",
  "beneficiaryName",
  "iban",
  "bankName",
  "countryCode",
  "fiscalName",
  "taxId",
  "registrationNumber",
  "fiscalAddress",
  "city",
  "postalCode",
]);

const PAYOUT_DEFAULTS = { countryCode: "RO" };

/** Câmpurile de plată/fiscalizare schimbate efectiv (fără rând = valori implicite). */
export function changedPayoutFields(before, after) {
  const norm = (row, key) => {
    const v = row?.[key] ?? PAYOUT_DEFAULTS[key] ?? null;
    return v === "" ? null : v;
  };
  return PAYOUT_NOTIFY_FIELDS.filter((key) => norm(before, key) !== norm(after, key));
}

export function ibanLast4(iban) {
  const s = String(iban || "").replace(/\s+/g, "");
  return s.length >= 4 ? s.slice(-4) : null;
}

/**
 * Informează părintele/tutorele (doar informativ) când influencerul cu
 * acord MINOR_PARENTAL_CONSENT COMPLETED își completează / modifică datele
 * de plată. Apelată DUPĂ salvare; nu aruncă niciodată (salvarea rămâne).
 * Un singur email per salvare reală, indiferent câte câmpuri s-au schimbat.
 */
export async function notifyGuardianOfPayoutProfileChange({ influencerId, before, after, changedAt }, deps = {}) {
  const { db, now, env, mail } = defaultDeps(deps);
  try {
    if (!isComplianceGateEnabled(env) || !influencerId) return { sent: false, reason: "disabled" };
    const changed = changedPayoutFields(before, after);
    if (!changed.length) return { sent: false, reason: "no_change" };

    const latest = await latestGateFor(db, influencerId);
    if (!latest || latest.type !== COMPLIANCE_GATE_TYPE || latest.status !== "COMPLETED") {
      return { sent: false, reason: "no_completed_gate" };
    }
    const response = await db.influencerComplianceResponse.findUnique({ where: { gateId: latest.id } });
    if (!response?.guardianEmail) return { sent: false, reason: "no_guardian_email" };

    const at = changedAt ? new Date(changedAt) : now();
    await mail.payoutGuardian({
      to: response.guardianEmail,
      guardianName: response.guardianName,
      influencerName: response.influencerName,
      changedAt: at,
      // doar ultimele 4 caractere și doar dacă IBAN-ul s-a schimbat
      ibanLast4: changed.includes("iban") ? ibanLast4(after?.iban) : null,
      template: `${PAYOUT_GUARDIAN_TEMPLATE}:${influencerId}:${at.getTime()}`,
    });
    return { sent: true, fields: changed };
  } catch (e) {
    // EmailLog marchează FAILED (sendMailLogged); salvarea datelor nu e afectată
    console.error("[compliance] guardian payout email failed:", e?.message || e);
    return { sent: false, reason: "mail_failed" };
  }
}

async function lastGuardianPayoutNotification(db, influencerId) {
  try {
    const row = await db.emailLog?.findFirst({
      where: { template: { startsWith: `${PAYOUT_GUARDIAN_TEMPLATE}:${influencerId}:` }, status: "SENT" },
      orderBy: { createdAt: "desc" },
      select: { sentAt: true, createdAt: true },
    });
    return row ? row.sentAt || row.createdAt : null;
  } catch {
    return null;
  }
}

/** Răspunsul complet - DOAR pentru admin. */
export async function getComplianceResponse({ influencerId, gateId }, deps = {}) {
  const { db } = defaultDeps(deps);
  const gate = await findOwnedGate(db, String(influencerId || ""), gateId);
  const response = await db.influencerComplianceResponse.findUnique({ where: { gateId: gate.id } });
  if (!response) throw new ComplianceGateError("compliance_response_not_found", "Gate-ul nu are încă un răspuns.", 404);
  return {
    gateId: gate.id,
    influencerName: response.influencerName,
    influencerEmail: response.influencerEmail,
    influencerBirthDate: response.influencerBirthDate,
    declaredMinor: response.declaredMinor,
    guardianName: response.guardianName,
    guardianRelationship: response.guardianRelationship,
    guardianEmail: response.guardianEmail,
    guardianPhone: response.guardianPhone,
    declarations: response.declarations,
    documentKey: response.documentKey,
    documentVersion: response.documentVersion,
    documentChecksum: response.documentChecksum,
    acceptedAt: response.acceptedAt,
    guardianEmailSentAt: response.guardianEmailSentAt || null,
  };
}

/** Rezumat pentru lista din Admin (un singur query pentru toți). */
export async function complianceSummariesByInfluencer(influencerIds, deps = {}) {
  const { db, now, env } = defaultDeps(deps);
  const map = new Map();
  if (!isComplianceGateEnabled(env) || !influencerIds?.length) return map;
  const at = now();
  const gates = await db.influencerComplianceGate.findMany({
    where: { influencerId: { in: influencerIds } },
    orderBy: { createdAt: "desc" },
    select: { id: true, influencerId: true, type: true, status: true, sentAt: true, expiresAt: true, completedAt: true, cancelledAt: true, rejectedAt: true, requiredDocumentVersion: true },
  });
  for (const g of gates) {
    if (!map.has(g.influencerId)) map.set(g.influencerId, computeComplianceState(g, at));
  }
  return map;
}

/* ============================================================
   Influencer: formular
============================================================ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function todayInBucharest(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bucharest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [y, m, d] = parts.split("-").map(Number);
  return { y, m, d };
}

export function ageOn(birth, now) {
  const t = todayInBucharest(now);
  let age = t.y - birth.y;
  if (t.m < birth.m || (t.m === birth.m && t.d < birth.d)) age -= 1;
  return age;
}

/*
 * Politica Artfest: programul de influenceri e disponibil de la 16 ani
 * împliniți; 16-17 ani doar cu acord parental (gate COMPLETED); 18+ flux
 * normal. Sub 16 ani nu se poate participa (nici cu acord parental).
 */
export const INFLUENCER_MIN_AGE = 16;
export const INFLUENCER_ADULT_AGE = 18;
export const INFLUENCER_MIN_AGE_MESSAGE =
  "Programul de influenceri Artfest este disponibil persoanelor care au împlinit 16 ani.";
export const ADULT_CONSENT_NOT_REQUIRED_MESSAGE =
  "Data nașterii indică o persoană care a împlinit 18 ani - acordul parental nu mai este necesar. Scrie-ne la support@artfest.ro, iar echipa Artfest poate anula solicitarea.";

/**
 * Vârsta exactă după data nașterii (YYYY-MM-DD), ziua curentă în ora
 * României - ziua de naștere contează, nu doar anul.
 * -> { category: "INVALID" | "UNDER_MIN" | "MINOR_CONSENT" | "ADULT", age, date }
 */
export function classifyInfluencerAge(value, now = new Date()) {
  const raw = value instanceof Date ? value.toISOString().slice(0, 10) : String(value || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return { category: "INVALID", age: null, date: null };
  const birth = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  const date = new Date(Date.UTC(birth.y, birth.m - 1, birth.d));
  const valid =
    date.getUTCFullYear() === birth.y && date.getUTCMonth() === birth.m - 1 && date.getUTCDate() === birth.d;
  const age = valid ? ageOn(birth, now) : -1;
  if (!valid || age < 0) return { category: "INVALID", age: null, date: null };
  if (age < INFLUENCER_MIN_AGE) return { category: "UNDER_MIN", age, date };
  if (age >= INFLUENCER_ADULT_AGE) return { category: "ADULT", age, date };
  return { category: "MINOR_CONSENT", age, date };
}

/**
 * Admin (trimite / retrimite): dacă vârsta e cunoscută - din data introdusă
 * de admin sau din ultimul răspuns al influencerului - sub 16 ani se blochează.
 * Data nașterii nu e stocată în profil (doar în răspunsul la formular).
 */
async function assertAgeAllowsGate(db, influencerId, birthDate, at) {
  let source = birthDate || null;
  if (!source) {
    const last = await db.influencerComplianceResponse.findFirst({
      where: { influencerId },
      orderBy: { createdAt: "desc" },
    });
    source = last?.influencerBirthDate || null;
  }
  if (!source) return null;
  const age = classifyInfluencerAge(source, at);
  if (age.category === "INVALID") {
    throw new ComplianceGateError("influencer_birth_date_invalid", "Data nașterii nu este validă.", 400);
  }
  if (age.category === "UNDER_MIN") {
    throw new ComplianceGateError("influencer_underage", INFLUENCER_MIN_AGE_MESSAGE, 409, { ageCategory: "UNDER_MIN" });
  }
  return age;
}

export function normalizeComplianceEmail(value) {
  const s = String(value ?? "").trim().toLowerCase();
  return s.length > 320 ? "" : s;
}

function cleanText(value, max) {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? null : s;
}

/**
 * Validează formularul. Întoarce datele curate sau aruncă 400 cu `fields`.
 */
export function validateComplianceSubmission(body = {}, { now = new Date() } = {}) {
  const fields = [];
  const out = {};

  out.influencerName = cleanText(body.influencerName, 160);
  if (!out.influencerName || out.influencerName.length < 2) fields.push("influencerName");

  out.influencerEmail = (cleanText(body.influencerEmail, 320) || "").toLowerCase();
  if (!EMAIL_RE.test(out.influencerEmail)) fields.push("influencerEmail");

  // vârsta exactă (zi/lună/an, ora României): <16 refuz, 16-17 acord parental, 18+ nu e necesar
  const age = classifyInfluencerAge(body.influencerBirthDate, now);
  if (age.category === "INVALID") fields.push("influencerBirthDate");
  else if (age.category === "UNDER_MIN") fields.push("influencerBirthDate_underage");
  else if (age.category === "ADULT") fields.push("influencerBirthDate_adult");
  else out.influencerBirthDate = age.date;

  if (body.declaredMinor !== true) fields.push("declaredMinor");
  else out.declaredMinor = true; // coloana e NOT NULL - se salvează explicit

  out.guardianName = cleanText(body.guardianName, 160);
  if (!out.guardianName || out.guardianName.length < 3) fields.push("guardianName");

  out.guardianRelationship = String(body.guardianRelationship || "");
  if (!GUARDIAN_RELATIONSHIPS.includes(out.guardianRelationship)) fields.push("guardianRelationship");

  out.guardianEmail = normalizeComplianceEmail(body.guardianEmail);
  const guardianEmailConfirm = normalizeComplianceEmail(body.guardianEmailConfirm);
  if (!EMAIL_RE.test(out.guardianEmail)) fields.push("guardianEmail");
  else if (out.guardianEmail === out.influencerEmail) fields.push("guardianEmail_same");
  // confirmarea doar se compară, nu se salvează
  if (!guardianEmailConfirm || guardianEmailConfirm !== out.guardianEmail) {
    fields.push("guardianEmailConfirm_mismatch");
  }

  const phone = String(body.guardianPhone || "").replace(/[^\d+]/g, "");
  if (!/^\+?\d{9,15}$/.test(phone)) fields.push("guardianPhone");
  else out.guardianPhone = phone;

  const declarations = {};
  for (const key of REQUIRED_DECLARATIONS) {
    if (body.declarations?.[key] !== true) fields.push(`declarations.${key}`);
    else declarations[key] = true;
  }
  out.declarations = declarations;

  if (fields.length) {
    const underage = fields.includes("influencerBirthDate_underage");
    const adult = fields.includes("influencerBirthDate_adult");
    const sameEmail = fields.includes("guardianEmail_same");
    const emailMismatch = fields.includes("guardianEmailConfirm_mismatch");
    throw new ComplianceGateError(
      "compliance_submission_invalid",
      underage
        ? INFLUENCER_MIN_AGE_MESSAGE
        : adult
        ? ADULT_CONSENT_NOT_REQUIRED_MESSAGE
        : sameEmail
        ? "Emailul părintelui / tutorelui trebuie să fie diferit de emailul influencerului."
        : emailMismatch && fields.length === 1
        ? "Emailurile părintelui / tutorelui nu coincid."
        : "Formularul nu este complet sau conține date invalide.",
      400,
      {
        fields: fields.map((f) => f.replace(/_(underage|adult|same|mismatch)$/, "")),
        ...(underage ? { ageCategory: "UNDER_MIN" } : adult ? { ageCategory: "ADULT" } : {}),
      }
    );
  }

  return out;
}

async function loadInfluencerForUser(db, userId) {
  const profile = await db.influencerProfile.findUnique({
    where: { userId: String(userId || "") },
    select: {
      id: true,
      userId: true,
      displayName: true,
      user: { select: { id: true, email: true, firstName: true, lastName: true, name: true, role: true } },
    },
  });
  if (!profile || profile.user?.role !== "INFLUENCER") {
    throw new ComplianceGateError("influencer_required", "Doar influencerii au acces.", 403);
  }
  return profile;
}

function personName(u, fallback) {
  const full = [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim();
  return full || u?.name || fallback || "";
}

/** GET /api/influencer/compliance */
export async function getComplianceForUser(userId, deps = {}) {
  const { db, now, env } = defaultDeps(deps);
  if (!isComplianceGateEnabled(env)) {
    return { enabled: false, status: "NOT_REQUIRED", blocking: false, canSubmit: false, gate: null };
  }
  const profile = await loadInfluencerForUser(db, userId);
  const latest = await latestGateFor(db, profile.id);
  const state = computeComplianceState(latest, now());
  const doc = state.canSubmit ? loadMinorConsentDocument() : null;
  return {
    enabled: true,
    ...state,
    document: doc ? { key: doc.key, version: doc.version, title: doc.title, html: doc.html } : null,
    prefill: state.canSubmit
      ? { influencerName: personName(profile.user, profile.displayName), influencerEmail: profile.user?.email || "" }
      : null,
  };
}

/** POST /api/influencer/compliance/:gateId/submit */
export async function submitComplianceResponse(
  { userId, gateId, body, ipHash = null, userAgent = null },
  deps = {}
) {
  const { db, now, env, notify, mail } = defaultDeps(deps);
  assertEnabled(env);
  const at = now();
  const profile = await loadInfluencerForUser(db, userId);
  // alt influencer / gate străin -> 404 (nu dezvăluim existența)
  const gate = await findOwnedGate(db, profile.id, gateId);

  if (gate.status === "COMPLETED") {
    throw new ComplianceGateError("compliance_gate_already_completed", "Acordul a fost deja înregistrat.", 409);
  }
  const status = effectiveGateStatus(gate, at);
  if (status !== "PENDING") {
    if (status === "EXPIRED" && gate.status === "PENDING") {
      await db.influencerComplianceGate.updateMany({ where: { id: gate.id, status: "PENDING" }, data: { status: "EXPIRED" } });
    }
    throw new ComplianceGateError(
      "compliance_gate_closed",
      "Această solicitare nu mai este activă. Scrie-ne la support@artfest.ro pentru una nouă.",
      410,
      { compliance: { status } }
    );
  }

  const data = validateComplianceSubmission(body, { now: at });
  const doc = loadMinorConsentDocument();
  if (doc.version !== gate.requiredDocumentVersion) {
    throw new ComplianceGateError(
      "compliance_document_version_mismatch",
      "Documentul s-a actualizat între timp. Reîncarcă pagina.",
      409
    );
  }

  const response = await db.$transaction(async (tx) => {
    await lockInfluencer(tx, profile.id);
    // tranziție condiționată: un singur submit câștigă (dublu click / două taburi)
    const done = await tx.influencerComplianceGate.updateMany({
      where: { id: gate.id, status: "PENDING" },
      data: { status: "COMPLETED", completedAt: at },
    });
    if (done.count !== 1) {
      throw new ComplianceGateError("compliance_gate_already_completed", "Acordul a fost deja înregistrat.", 409);
    }
    return tx.influencerComplianceResponse.create({
      data: {
        gateId: gate.id,
        influencerId: profile.id,
        submittedByUserId: profile.userId,
        ...data,
        documentKey: doc.key,
        documentVersion: doc.version,
        documentChecksum: doc.checksum,
        acceptedAt: at,
        acceptedIpHash: ipHash ? String(ipHash).slice(0, 64) : null,
        acceptedUserAgent: userAgent ? String(userAgent).slice(0, 500) : null,
      },
    });
  });

  // confirmări (best-effort: acordul e deja înregistrat)
  try {
    await notify(profile.userId, {
      type: "system",
      title: "Acordul de conformitate a fost înregistrat",
      body: "Funcțiile contului de influencer sunt din nou disponibile.",
      link: "/influencer",
      dedupeKey: `influencer_compliance:${gate.id}:completed`,
      meta: { kind: "influencer_compliance_completed", gateId: gate.id },
    });
  } catch (e) {
    console.error("[compliance] completed notification failed:", e?.message || e);
  }
  try {
    if (profile.user?.email) {
      await mail.completed({
        to: profile.user.email,
        firstName: profile.user.firstName || profile.user.name || null,
        completedAt: at,
        gateId: gate.id,
        userId: profile.userId,
      });
    }
  } catch (e) {
    console.error("[compliance] completed email failed:", e?.message || e);
  }
  try {
    await mail.guardian({
      to: data.guardianEmail,
      guardianName: data.guardianName,
      influencerName: data.influencerName,
      completedAt: at,
      gateId: gate.id,
    });
    await db.influencerComplianceResponse.update({
      where: { id: response.id },
      data: { guardianEmailSentAt: now() },
    });
  } catch (e) {
    console.error("[compliance] guardian email failed:", e?.message || e);
  }

  return { ok: true, gate: publicGate({ ...gate, status: "COMPLETED", completedAt: at }, at) };
}
