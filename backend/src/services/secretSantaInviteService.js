// backend/src/services/secretSantaInviteService.js
//
// Invitația Secret Santa prin email către vânzătorii eligibili. Pornită EXCLUSIV
// manual din Admin (cu confirmare), în fundal - cererea HTTP nu așteaptă trimiterea.
//
// Eligibil = poate participa (aceleași condiții ca înscrierea, vezi
// secretSantaService.loadEligibleVendor: rol VENDOR, cont ACTIVE, vendor activ,
// neanonimizat, cu cel puțin un magazin) ȘI poate primi comunicări (aceleași
// reguli ca invitația la Târg, services/artfestFairActivationInviteService.js):
// cont neblocat, email confirmat, fără încetarea colaborării, nedezabonat
// (NewsletterSubscriber UNSUBSCRIBED / UserMarketingPrefs.emailEnabled=false) și
// cu acord pentru noutăți (User.marketingOptIn). Excluși și cei deja înscriși în
// ediția curentă. O adresă de email primește cel mult o invitație.
//
// Evidență + fără duplicate: ArtfestBroadcastDelivery (un rând per vendor pe cheia
// campaniei), revendicare atomică a emailului și plasa EmailLog SENT - aceleași
// funcții ca invitațiile Târgului. SENT / SENDING / UNKNOWN nu se retrimit; FAILED
// se reîncearcă doar la o nouă pornire explicită.
//
// Nu modifică ediția, înscrierile sau extragerea.

import { prisma } from "../db.js";
import {
  buildSecretSantaInviteEmail,
  secretSantaInviteTemplate,
  sendSecretSantaInviteEmail as defaultSendEmail,
} from "../lib/mailer.js";
import { buildApiUnsubscribeUrl } from "../lib/unsubscribeUrl.js";
import { SECRET_SANTA_VENDOR_INVITE } from "../config/secretSanta.js";
import { claimDeliveryRow, deliverEmail, errorText, markStaleSendingUnknown, sleep } from "./artfestFairInviteService.js";
import { SecretSantaError, isRegistrationOpen, resolveEdition } from "./secretSantaService.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// pauză între emailuri (limitele furnizorului); bucla e asincronă => serverul rămâne liber
const DEFAULT_EMAIL_DELAY_MS = Number(process.env.SECRET_SANTA_INVITE_EMAIL_DELAY_MS) || 600;

export const INVITE_EXCLUSION_REASONS = Object.freeze({
  anonymized: "Cont de vânzător șters (anonimizat)",
  terminated: "Colaborare încetată sau în preaviz",
  userMissing: "Fără cont de utilizator",
  notVendor: "Contul nu mai are rol de vânzător",
  userInactive: "Cont șters sau suspendat",
  userLocked: "Cont blocat",
  storeInactive: "Vânzător dezactivat",
  noStore: "Fără magazin",
  emailUnverified: "Email neconfirmat",
  noEmail: "Fără adresă de email validă",
  unsubscribed: "Dezabonat de la emailurile promoționale",
  noMarketingConsent: "Fără acord pentru noutăți și oferte",
  alreadyRegistered: "Deja înscris la Secret Santa",
  duplicateEmail: "Adresă de email folosită deja de alt vânzător (o singură invitație)",
});

export function normalizeInviteEmail(value) {
  const email = String(value ?? "").trim().toLowerCase();
  return email && email.length <= 320 && EMAIL_RE.test(email) ? email : null;
}

/* ===================== destinatari ===================== */

export async function classifyInviteRecipients(db = prisma) {
  const edition = await resolveEdition(db);
  const vendors = await db.vendor.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      userId: true,
      displayName: true,
      isActive: true,
      anonymizedAt: true,
      terminationNoticeAt: true,
      terminationFinalizedAt: true,
      services: { select: { id: true }, take: 1 },
      user: {
        select: { id: true, email: true, firstName: true, role: true, status: true, locked: true, emailVerifiedAt: true, marketingOptIn: true },
      },
    },
  });
  const userIds = vendors.map((v) => v.userId).filter(Boolean);
  const emails = [...new Set(vendors.map((v) => normalizeInviteEmail(v.user?.email)).filter(Boolean))];

  const [unsubscribed, prefsOff, registered] = await Promise.all([
    emails.length
      ? db.newsletterSubscriber.findMany({ where: { email: { in: emails }, status: "UNSUBSCRIBED" }, select: { email: true } })
      : [],
    userIds.length
      ? db.userMarketingPrefs.findMany({ where: { userId: { in: userIds }, emailEnabled: false }, select: { userId: true } })
      : [],
    edition ? db.secretSantaParticipant.findMany({ where: { editionId: edition.id }, select: { vendorId: true } }) : [],
  ]);
  const unsubscribedEmails = new Set(unsubscribed.map((r) => String(r.email).toLowerCase()));
  const prefsOffUsers = new Set(prefsOff.map((r) => r.userId));
  const registeredVendors = new Set(registered.map((r) => r.vendorId));

  const seenEmails = new Set();
  const eligible = [];
  const excluded = [];
  for (const vendor of vendors) {
    const user = vendor.user;
    const email = normalizeInviteEmail(user?.email);
    let reason = null;
    if (vendor.anonymizedAt) reason = "anonymized";
    else if (vendor.terminationNoticeAt || vendor.terminationFinalizedAt) reason = "terminated";
    else if (!user) reason = "userMissing";
    else if (user.role !== "VENDOR") reason = "notVendor";
    else if (user.status !== "ACTIVE") reason = "userInactive";
    else if (user.locked) reason = "userLocked";
    else if (!vendor.isActive) reason = "storeInactive";
    else if (!vendor.services.length) reason = "noStore";
    else if (!user.emailVerifiedAt) reason = "emailUnverified";
    else if (!email) reason = "noEmail";
    else if (unsubscribedEmails.has(email) || prefsOffUsers.has(user.id)) reason = "unsubscribed";
    else if (user.marketingOptIn !== true) reason = "noMarketingConsent";
    else if (registeredVendors.has(vendor.id)) reason = "alreadyRegistered";
    else if (seenEmails.has(email)) reason = "duplicateEmail";

    const base = { vendorId: vendor.id, userId: vendor.userId || null, vendorName: vendor.displayName || "", firstName: user?.firstName || null, email };
    if (reason) excluded.push({ ...base, reason });
    else {
      seenEmails.add(email);
      eligible.push(base);
    }
  }
  return { edition, eligible, excluded };
}

function deliveryState(delivery) {
  const status = delivery?.emailStatus || "PENDING";
  if (status === "SENT") return "alreadySent";
  if (status === "SENDING" || status === "UNKNOWN") return "unknown";
  if (status === "FAILED") return "failedRetry";
  return "toSend";
}

// condiția de trimitere: o ediție publică cu înscrierile deschise (altfel invitația ar fi înșelătoare)
export function sendBlockReason(edition, now = new Date()) {
  if (!edition) return "Nu există o ediție Secret Santa publicată.";
  if (edition.status === "DRAWN") return "Extragerea a fost deja realizată.";
  if (!isRegistrationOpen(edition, now)) return "Înscrierile ediției curente nu sunt deschise.";
  return null;
}

/* ===================== previzualizare + rezultate ===================== */

export function renderInvitePreview({ firstName = "Ana", vendorName = "" } = {}) {
  const email = buildSecretSantaInviteEmail({
    ...SECRET_SANTA_VENDOR_INVITE,
    firstName,
    vendorName,
    // linkul real e semnat per destinatar la trimitere
    unsubscribeUrl: "#dezabonare",
  });
  return { subject: email.subject, preheader: email.preheader, html: email.html, text: email.text, ctaUrl: email.ctaUrl };
}

export async function previewInvite({ db = prisma, campaignKey = SECRET_SANTA_VENDOR_INVITE.campaignKey, now = new Date() } = {}) {
  const [{ edition, eligible, excluded }, deliveries] = await Promise.all([
    classifyInviteRecipients(db),
    db.artfestBroadcastDelivery.findMany({
      where: { campaignKey },
      select: { vendorId: true, emailTo: true, emailStatus: true, emailSentAt: true, emailError: true, updatedAt: true },
    }),
  ]);
  const byVendor = new Map(deliveries.map((d) => [d.vendorId, d]));

  const counts = { toSend: 0, alreadySent: 0, unknown: 0, failedRetry: 0 };
  for (const r of eligible) counts[deliveryState(byVendor.get(r.vendorId))] += 1;

  // rezultatele salvate ale campaniei (toate rândurile, inclusiv cei deveniți între timp neeligibili)
  const sentDates = deliveries.filter((d) => d.emailStatus === "SENT" && d.emailSentAt).map((d) => new Date(d.emailSentAt).getTime());
  const failures = deliveries.filter((d) => d.emailStatus === "FAILED" || d.emailStatus === "UNKNOWN");
  const excludedByReason = {};
  for (const e of excluded) excludedByReason[e.reason] = (excludedByReason[e.reason] || 0) + 1;
  const blockReason = sendBlockReason(edition, now);

  return {
    campaignKey,
    edition: edition ? { key: edition.key, title: edition.title, status: edition.status, registrationOpen: isRegistrationOpen(edition, now) } : null,
    canSend: !blockReason,
    blockReason,
    eligible: eligible.length,
    counts,
    willSend: counts.toSend + counts.failedRetry,
    results: {
      sent: deliveries.filter((d) => d.emailStatus === "SENT").length,
      failed: deliveries.filter((d) => d.emailStatus === "FAILED").length,
      unknown: deliveries.filter((d) => d.emailStatus === "UNKNOWN" || d.emailStatus === "SENDING").length,
      firstSentAt: sentDates.length ? new Date(Math.min(...sentDates)).toISOString() : null,
      lastSentAt: sentDates.length ? new Date(Math.max(...sentDates)).toISOString() : null,
      failures: failures.slice(0, 50).map((d) => ({ email: d.emailTo, status: d.emailStatus, error: d.emailError || null, at: d.updatedAt })),
    },
    excluded: Object.entries(excludedByReason).map(([reason, count]) => ({ reason, label: INVITE_EXCLUSION_REASONS[reason] || reason, count })),
    unsubscribeAvailable: Boolean(buildApiUnsubscribeUrl("verificare@artfest.ro")),
  };
}

/* ===================== email de test (o singură adresă, Admin) ===================== */

export async function sendTestInvite({ to, firstName = null, send = defaultSendEmail, campaignKey = SECRET_SANTA_VENDOR_INVITE.campaignKey } = {}) {
  const email = normalizeInviteEmail(to);
  if (!email) throw new SecretSantaError(400, "invalid_fields", "Scrie o adresă de email validă.", { fields: { email: "Adresă de email invalidă." } });
  try {
    await send({ ...SECRET_SANTA_VENDOR_INVITE, to: email, firstName, campaignKey, test: true });
  } catch (error) {
    if (String(error?.message) === "unsubscribe_link_unavailable") {
      throw new SecretSantaError(409, "unsubscribe_unavailable", "Linkul de dezabonare nu poate fi generat (UNSUBSCRIBE_SECRET / adresa site-ului). Emailul nu a fost trimis.");
    }
    console.error("[secretSantaInvite] test", errorText(error));
    throw new SecretSantaError(502, "send_failed", `Emailul de test nu a putut fi trimis: ${errorText(error)}`);
  }
  return { ok: true, to: email };
}

/* ===================== trimiterea către vânzători ===================== */

export async function runInvite({
  db = prisma,
  send = defaultSendEmail,
  campaignKey = SECRET_SANTA_VENDOR_INVITE.campaignKey,
  emailDelayMs = DEFAULT_EMAIL_DELAY_MS,
  now = new Date(),
  onProgress = null,
} = {}) {
  const result = { campaignKey, total: 0, processed: 0, sent: 0, alreadySent: 0, failed: 0, unknown: 0, noAddress: 0, staleMarkedUnknown: 0, failures: [] };
  result.staleMarkedUnknown = await markStaleSendingUnknown(db, campaignKey, now);

  // eligibilitatea se recalculează la pornire (nu se folosește o listă trimisă de browser)
  const { edition, eligible } = await classifyInviteRecipients(db);
  const block = sendBlockReason(edition, now);
  if (block) throw new SecretSantaError(409, "invite_not_available", block);
  result.total = eligible.length;
  const template = secretSantaInviteTemplate(campaignKey);
  const sendOne = (payload) => send({ ...SECRET_SANTA_VENDOR_INVITE, ...payload, campaignKey });

  for (const vendor of eligible) {
    let outcome;
    let error = null;
    try {
      const delivery = await claimDeliveryRow(db, campaignKey, vendor);
      outcome = await deliverEmail(db, delivery, vendor, campaignKey, now, sendOne, { template });
      if (outcome === "failed") {
        error = (await db.artfestBroadcastDelivery.findUnique({ where: { id: delivery.id }, select: { emailError: true } }))?.emailError || null;
      }
    } catch (e) {
      console.error("[secretSantaInvite] vendor", vendor.vendorId, errorText(e));
      outcome = "failed";
      error = errorText(e);
    }
    if (outcome === "sent") result.sent += 1;
    else if (outcome === "already") result.alreadySent += 1;
    else if (outcome === "unknown") result.unknown += 1;
    else if (outcome === "noEmail") result.noAddress += 1;
    else {
      result.failed += 1;
      if (result.failures.length < 50) result.failures.push({ email: vendor.email, error });
    }
    result.processed += 1;
    if (onProgress) onProgress({ ...result, failures: [...result.failures] });
    if (outcome === "sent") await sleep(emailDelayMs);
  }
  return result;
}

/* ===================== pornire din Admin (în fundal, un singur lock) ===================== */

let current = null;
let last = null;

export function getInviteRunStatus() {
  return { running: Boolean(current), current: current ? { ...current } : null, last: last ? { ...last } : null };
}

// doar pentru teste
export function resetInviteRunState() {
  current = null;
  last = null;
}

/*
 * confirm=true + expectedCount = numărul afișat adminului în fereastra de confirmare;
 * dacă lista s-a schimbat între timp => 409 și adminul vede numărul nou.
 */
export async function startInvite({ db = prisma, adminId = null, confirm, expectedCount, now = new Date(), ...options } = {}) {
  if (confirm !== true) throw new SecretSantaError(400, "confirmation_required", "Confirmă trimiterea invitațiilor.");
  if (current) return { started: false, reason: "already_running", status: getInviteRunStatus() };

  const preview = await previewInvite({ db, campaignKey: options.campaignKey, now });
  if (!preview.canSend) throw new SecretSantaError(409, "invite_not_available", preview.blockReason);
  if (!preview.unsubscribeAvailable) {
    throw new SecretSantaError(409, "unsubscribe_unavailable", "Linkul de dezabonare nu poate fi generat (UNSUBSCRIBE_SECRET / adresa site-ului). Nu se trimite nimic.");
  }
  if (Number(expectedCount) !== preview.willSend) {
    throw new SecretSantaError(409, "count_changed", `Numărul destinatarilor s-a schimbat (acum ${preview.willSend}). Verifică din nou și confirmă.`, {
      fields: { willSend: preview.willSend },
    });
  }
  if (!preview.willSend) throw new SecretSantaError(409, "nothing_to_send", "Nu există destinatari noi pentru invitație.");

  current = { startedAt: new Date().toISOString(), startedBy: adminId, total: preview.willSend, progress: null };
  const done = runInvite({
    db,
    now,
    ...options,
    onProgress: (progress) => {
      if (current) current.progress = progress;
    },
  })
    .then((result) => {
      last = { ...current, finishedAt: new Date().toISOString(), result, error: null };
      const { failures, ...summary } = result;
      console.log("[secretSantaInvite] finalizat", JSON.stringify({ ...summary, failures: failures.length }));
    })
    .catch((error) => {
      last = { ...current, finishedAt: new Date().toISOString(), result: current?.progress || null, error: errorText(error) };
      console.error("[secretSantaInvite] eroare", errorText(error));
    })
    .finally(() => {
      current = null;
    });
  return { started: true, status: getInviteRunStatus(), done };
}
