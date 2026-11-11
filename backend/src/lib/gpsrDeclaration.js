// backend/src/lib/gpsrDeclaration.js
//
// Declarația GPSR a vânzătorului, PER PRODUS (ProductGpsrDeclaration):
// evidență append-only, generată DOAR pe server (vânzător și utilizator din
// sesiune, versiunea curentă a informării, ora serverului). Nu stocăm adrese:
// doar amprente (sha256) ale datelor producătorului și ale celor de siguranță,
// ca să știm când e nevoie de reconfirmare.
//
// Stări (calculate, nu stocate):
//   VALID       - „Confirmare înregistrată” (versiune + amprente = datele curente)
//   RECONFIRM   - „Reconfirmare necesară” (versiune nouă / producător / siguranță schimbate)
//   MISSING     - „Confirmare lipsă” (produs creat după intrarea în vigoare)
//   UNRECORDED  - „Confirmare neînregistrată” (produs vechi, fără dovadă - NU e marcat confirmat)
//   INCOMPLETE  - „Informații incomplete” (date GPSR obligatorii lipsă)
// Nicio stare nu înseamnă „certificat” sau „conform legal”.

import crypto from "node:crypto";

import { isGpsrComplete } from "./gpsrCompliance.js";
import { CURRENT_GPSR_NOTICE, CURRENT_GPSR_NOTICE_VERSION, GPSR_NOTICE_VERSIONS } from "./gpsrNoticeVersions.js";

export const GPSR_DECLARATION_KIND = "PUBLISH_CONFIRMATION";

export const GPSR_DECLARATION_STATUS = Object.freeze({
  VALID: "VALID",
  RECONFIRM: "RECONFIRM",
  MISSING: "MISSING",
  UNRECORDED: "UNRECORDED",
  INCOMPLETE: "INCOMPLETE",
});

export const GPSR_DECLARATION_STATUS_LABELS = Object.freeze({
  VALID: "Confirmare înregistrată",
  RECONFIRM: "Reconfirmare necesară",
  MISSING: "Confirmare lipsă",
  UNRECORDED: "Confirmare neînregistrată",
  INCOMPLETE: "Informații incomplete",
});

export const GPSR_RECONFIRM_REASON_LABELS = Object.freeze({
  notice_version: "a apărut o versiune nouă a informării GPSR",
  manufacturer: "s-au schimbat datele producătorului",
  safety: "s-au schimbat informațiile de siguranță",
});

export const GPSR_DECLARATION_SOURCES = new Set(["smart_listing", "product_modal", "catalog", "other"]);

/*
 * De când e obligatorie declarația pentru aprobare / publicare automată.
 * Produsele create ÎNAINTE rămân neatinse („Confirmare neînregistrată”).
 * Se setează la deploy: GPSR_DECLARATION_REQUIRED_FROM=<ISO>.
 */
export const DEFAULT_GPSR_DECLARATION_REQUIRED_FROM = "2026-11-12T00:00:00.000Z";

export function declarationRequiredFrom(env = process.env) {
  const raw = env?.GPSR_DECLARATION_REQUIRED_FROM || DEFAULT_GPSR_DECLARATION_REQUIRED_FROM;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? new Date(DEFAULT_GPSR_DECLARATION_REQUIRED_FROM) : date;
}

/** Produsul intră sub regula nouă (creat după data de intrare în vigoare)? */
export function isGpsrDeclarationRequired(product, env = process.env) {
  if (!product?.createdAt) return true; // produs nou, încă nesalvat
  return new Date(product.createdAt).getTime() >= declarationRequiredFrom(env).getTime();
}

function sha256(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

function norm(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "1" : "0";
  return String(value).trim().replace(/\s+/g, " ").toLowerCase();
}

/** Amprenta textului exact al unei versiuni (informare + textul declarației). */
export function gpsrNoticeHash(version = CURRENT_GPSR_NOTICE) {
  if (!version) return null;
  return sha256(
    JSON.stringify({
      id: version.id,
      title: version.title,
      summary: version.summary,
      points: version.points,
      disclaimer: version.disclaimer,
      confirmationText: version.confirmationText,
    })
  );
}

/** Versiunile pentru Admin → Politici (doar consultare). */
export function listGpsrNoticeVersions() {
  return GPSR_NOTICE_VERSIONS.map((version) => ({
    id: version.id,
    publishedAt: version.publishedAt,
    current: version.id === CURRENT_GPSR_NOTICE_VERSION,
    hash: gpsrNoticeHash(version),
    title: version.title,
    summary: version.summary,
    points: version.points,
    disclaimer: version.disclaimer,
    confirmationText: version.confirmationText,
  }));
}

/*
 * Amprentele datelor relevante. Producătorul propriu = datele centrale ale
 * vânzătorului (Vendor.gpsrManufacturer*), altfel cele de pe produs.
 */
export function gpsrFingerprints(product = {}, vendor = null) {
  const own = product?.isOwnManufacturer;
  const manufacturer =
    own === true
      ? ["own", vendor?.gpsrManufacturerName, vendor?.gpsrManufacturerAddress, vendor?.gpsrManufacturerEmail]
      : own === false
        ? [
            "external",
            product.manufacturerName,
            product.manufacturerAddress,
            product.manufacturerEmail,
            product.manufacturerInEU,
            product.responsiblePersonName,
            product.responsiblePersonAddress,
            product.responsiblePersonEmail,
          ]
        : ["unknown"];
  return {
    manufacturerHash: sha256(manufacturer.map(norm).join("|")),
    safetyHash: sha256([product?.safetyWarnings, product?.isForChildren].map(norm).join("|")),
  };
}

/**
 * Starea declarației pentru un produs.
 * @param {{ product, vendor, declarations: Array, env? }} input declarațiile produsului (orice ordine)
 */
export function evaluateGpsrDeclaration({ product, vendor = null, declarations = [], env = process.env }) {
  const history = [...(declarations || [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const latest = history[0] || null;
  const required = isGpsrDeclarationRequired(product, env);
  const complete = isGpsrComplete(product, vendor);
  const current = gpsrFingerprints(product, vendor);

  const reasons = [];
  if (latest) {
    if (latest.noticeVersion !== CURRENT_GPSR_NOTICE_VERSION) reasons.push("notice_version");
    if (latest.manufacturerHash !== current.manufacturerHash) reasons.push("manufacturer");
    if (latest.safetyHash !== current.safetyHash) reasons.push("safety");
  }

  let status;
  if (!complete) status = GPSR_DECLARATION_STATUS.INCOMPLETE;
  else if (!latest) status = required ? GPSR_DECLARATION_STATUS.MISSING : GPSR_DECLARATION_STATUS.UNRECORDED;
  else status = reasons.length ? GPSR_DECLARATION_STATUS.RECONFIRM : GPSR_DECLARATION_STATUS.VALID;

  return {
    status,
    label: GPSR_DECLARATION_STATUS_LABELS[status],
    required,
    complete,
    valid: Boolean(latest) && reasons.length === 0,
    reasons,
    reasonLabels: reasons.map((r) => GPSR_RECONFIRM_REASON_LABELS[r]),
    latest,
    history,
    currentNoticeVersion: CURRENT_GPSR_NOTICE_VERSION,
  };
}

/** Există o declarație care acoperă EXACT datele și versiunea curente? */
export function hasCurrentGpsrDeclaration({ product, vendor, declarations }) {
  const fp = gpsrFingerprints(product, vendor);
  return (declarations || []).some(
    (d) =>
      d.noticeVersion === CURRENT_GPSR_NOTICE_VERSION &&
      d.manufacturerHash === fp.manufacturerHash &&
      d.safetyHash === fp.safetyHash
  );
}

/**
 * Poate fi aprobat / făcut public produsul din punctul de vedere al declarației?
 * Produsele vechi (create înainte de intrarea în vigoare) nu sunt blocate.
 */
export async function gpsrDeclarationAllowsPublication(db, { product, vendor, env = process.env }) {
  if (!isGpsrDeclarationRequired(product, env)) return true;
  const declarations = await db.productGpsrDeclaration.findMany({
    where: { productId: product.id, noticeVersion: CURRENT_GPSR_NOTICE_VERSION },
    select: { noticeVersion: true, manufacturerHash: true, safetyHash: true },
  });
  return hasCurrentGpsrDeclaration({ product, vendor, declarations });
}

function isUniqueConflict(error) {
  return error?.code === "P2002";
}

/**
 * Înregistrează declarația (append-only, idempotentă: aceeași versiune +
 * aceleași date = același rând, fără duplicate la dublu-click / retry).
 * vendorId și userId vin EXCLUSIV de la apelant (sesiunea), nu din body.
 */
export async function recordGpsrDeclaration(db, { product, vendor, userId, source = "other" }) {
  if (!product?.id || !vendor?.id || !userId) throw new Error("gpsr_declaration_context_missing");
  const fp = gpsrFingerprints(product, vendor);
  const data = {
    productId: product.id,
    vendorId: vendor.id,
    userId: String(userId),
    kind: GPSR_DECLARATION_KIND,
    noticeVersion: CURRENT_GPSR_NOTICE_VERSION,
    textHash: gpsrNoticeHash(CURRENT_GPSR_NOTICE),
    manufacturerHash: fp.manufacturerHash,
    safetyHash: fp.safetyHash,
    source: GPSR_DECLARATION_SOURCES.has(source) ? source : "other",
  };
  try {
    return { declaration: await db.productGpsrDeclaration.create({ data }), created: true };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const existing = await db.productGpsrDeclaration.findFirst({
      where: {
        productId: data.productId,
        noticeVersion: data.noticeVersion,
        manufacturerHash: data.manufacturerHash,
        safetyHash: data.safetyHash,
      },
    });
    return { declaration: existing, created: false };
  }
}

/**
 * Ce trimite clientul: DOAR `gpsrConfirmation: { accepted: true, noticeVersion }`.
 * Orice vendorId / userId / acceptedAt din body e ignorat. O versiune diferită
 * de cea curentă = 409 (pagina e veche; vânzătorul trebuie să vadă textul nou).
 */
export function parseGpsrConfirmation(body = {}) {
  const raw = body?.gpsrConfirmation;
  if (raw === undefined || raw === null || raw === false) return { provided: false };
  if (typeof raw !== "object" || raw.accepted !== true) return { provided: false, invalid: true };
  if (raw.noticeVersion !== CURRENT_GPSR_NOTICE_VERSION) {
    return { provided: false, invalid: true, staleVersion: true };
  }
  const source = typeof raw.source === "string" ? raw.source : "other";
  return { provided: true, source };
}

export const GPSR_CONFIRMATION_REQUIRED_RESPONSE = Object.freeze({
  error: "gpsr_confirmation_required",
  message:
    "Pentru publicare, confirmă informațiile privind siguranța produselor (GPSR) și corectitudinea datelor despre producător și produs.",
});

export function gpsrConfirmationErrorBody(parsed, extra = {}) {
  if (parsed?.staleVersion) {
    return {
      error: "gpsr_notice_outdated",
      message: "Informarea GPSR a fost actualizată. Reîncarcă pagina, citește versiunea nouă și confirmă din nou.",
      currentNoticeVersion: CURRENT_GPSR_NOTICE_VERSION,
      ...extra,
    };
  }
  return { ...GPSR_CONFIRMATION_REQUIRED_RESPONSE, currentNoticeVersion: CURRENT_GPSR_NOTICE_VERSION, ...extra };
}
