// backend/src/services/artfestFairActivationInviteService.js
//
// Invitația la Târgul Artfest pentru vânzătorii cu cont, dar cu magazinul NEACTIVAT.
// Pornită EXCLUSIV manual din Admin; doar email (fără notificare în aplicație).
//
// „Magazin neactivat” (din codul existent, nemodificat):
//   - contul de vânzător se creează cu Vendor.isActive = false (authRoutes, asVendor);
//   - activarea = POST /api/vendors/me/services/:id/activate: serviciul devine
//     ACTIVE și Vendor.isActive = true;
//   - pauza magazinului pune serviciul pe INACTIVE (dar Vendor.isActive rămâne true);
//   - Adminul poate pune Vendor.isActive = false unui magazin deja activat.
//   => neactivat = Vendor.isActive = false ȘI niciun serviciu ACTIVE / INACTIVE
//      (nu a fost activat niciodată; exclude magazinele dezactivate de Admin).
//
// Excluși (cu motiv, pentru raportul din Admin): cont șters / suspendat / blocat,
// email neconfirmat, vendor anonimizat sau cu încetarea colaborării, fără email,
// deja înscris la târg, dezabonat, FĂRĂ ACORD pentru comunicări comerciale.
//
// Temei: emailul e comunicare comercială (invitație + promovarea târgului), iar
// vendorul neactivat nu a cumpărat nimic de la Artfest (excepția „client existent”
// nu e evidentă) => se trimite DOAR celor cu acord explicit: User.marketingOptIn
// (bifa opțională de la înregistrare, cu dovadă în UserConsent MARKETING_EMAIL_OPTIN,
// sau preferințele de marketing; devine false la dezabonare / ștergere).
//
// Dedupe: ArtfestBroadcastDelivery cu o cheie de campanie separată - un rând per
// vendor, revendicare atomică a emailului (aceleași funcții ca invitația principală),
// EmailLog SENT pe template => fără retrimitere. SENT / SENDING / UNKNOWN nu se
// retrimit; FAILED se poate reîncerca explicit.

import { prisma } from "../db.js";
import {
  artfestFairActivationInviteTemplate,
  artfestFairActivationUnsubscribeUrl,
  buildArtfestFairActivationInviteEmail,
  sendArtfestFairActivationInviteEmail as defaultSendEmail,
} from "../lib/mailer.js";
import {
  ARTFEST_FAIR_ACTIVATION_INVITE_CAMPAIGN_KEY,
  ARTFEST_FAIR_KEY,
  ARTFEST_HELP_PHONE_DISPLAY,
  ARTFEST_HELP_PHONE_TEL,
} from "../config/artfestFair.js";
import {
  claimDeliveryRow,
  deliverEmail,
  errorText,
  markStaleSendingUnknown,
  sleep,
} from "./artfestFairInviteService.js";
import { FairError } from "./artfestFairService.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_EMAIL_DELAY_MS = Number(process.env.ARTFEST_FAIR_INVITE_EMAIL_DELAY_MS) || 300;
export const MAX_ACTIVATION_INVITE_SELECTION = 1000;

// serviciu în aceste stări = magazinul a fost activat cel puțin o dată
const ACTIVATED_SERVICE_STATUSES = ["ACTIVE", "INACTIVE"];

export const EXCLUSION_REASONS = Object.freeze({
  anonymized: "Cont de vânzător șters (anonimizat)",
  terminated: "Colaborare încetată sau în preaviz",
  userMissing: "Fără cont de utilizator",
  userInactive: "Cont șters sau suspendat",
  userLocked: "Cont blocat",
  emailUnverified: "Email neconfirmat",
  storeActivatedBefore: "Magazin activat anterior (dezactivat sau pe pauză)",
  noEmail: "Fără adresă de email validă",
  unsubscribed: "Dezabonat de la emailurile promoționale",
  noMarketingConsent: "Fără acord pentru comunicări comerciale (exclus până la clarificarea temeiului)",
  alreadyRegistered: "Are deja o înscriere la târg",
});

function normalizeEmail(value) {
  const email = String(value ?? "").trim().toLowerCase();
  return email && EMAIL_RE.test(email) ? email : null;
}

// pagina corectă de activare: magazin început (ciornă) -> detalii; altfel alegerea magazinului
export function activationCtaPath(hasDraftService) {
  return hasDraftService ? "/onboarding/details" : "/onboarding";
}

/*
 * Clasifică TOȚI vendorii cu Vendor.isActive = false: eligibili + excluși (cu motiv).
 * Interogări simple + filtrare în cod (motivele de excludere sunt vizibile în Admin).
 */
export async function classifyUnactivatedVendors(db = prisma) {
  const vendors = await db.vendor.findMany({
    where: { isActive: false },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      userId: true,
      displayName: true,
      email: true,
      createdAt: true,
      anonymizedAt: true,
      terminationNoticeAt: true,
      terminationFinalizedAt: true,
      user: { select: { id: true, email: true, firstName: true, status: true, locked: true, emailVerifiedAt: true, marketingOptIn: true } },
    },
  });
  const vendorIds = vendors.map((v) => v.id);
  const userIds = vendors.map((v) => v.userId).filter(Boolean);

  const [services, fair] = await Promise.all([
    vendorIds.length
      ? db.vendorService.findMany({ where: { vendorId: { in: vendorIds } }, select: { vendorId: true, status: true } })
      : [],
    db.artfestFair.findUnique({ where: { key: ARTFEST_FAIR_KEY }, select: { id: true } }),
  ]);
  const registrations =
    fair && vendorIds.length
      ? await db.artfestFairRegistration.findMany({
          where: { fairId: fair.id, vendorId: { in: vendorIds } },
          select: { vendorId: true },
        })
      : [];

  const emails = new Set();
  const rows = vendors.map((vendor) => {
    const email = normalizeEmail(vendor.email) || normalizeEmail(vendor.user?.email);
    if (email) emails.add(email);
    return { vendor, email };
  });

  // preferințe de comunicare: dezabonați (newsletter) sau emailuri dezactivate în preferințe
  const [unsubscribed, prefsOff] = await Promise.all([
    emails.size
      ? db.newsletterSubscriber.findMany({
          where: { email: { in: [...emails] }, status: "UNSUBSCRIBED" },
          select: { email: true },
        })
      : [],
    userIds.length
      ? db.userMarketingPrefs.findMany({ where: { userId: { in: userIds }, emailEnabled: false }, select: { userId: true } })
      : [],
  ]);
  const unsubscribedEmails = new Set(unsubscribed.map((r) => String(r.email).toLowerCase()));
  const prefsOffUsers = new Set(prefsOff.map((r) => r.userId));

  const servicesByVendor = new Map();
  for (const s of services) {
    if (!servicesByVendor.has(s.vendorId)) servicesByVendor.set(s.vendorId, []);
    servicesByVendor.get(s.vendorId).push(s.status);
  }
  const registered = new Set(registrations.map((r) => r.vendorId));

  const eligible = [];
  const excluded = [];
  for (const { vendor, email } of rows) {
    const statuses = servicesByVendor.get(vendor.id) || [];
    const user = vendor.user;
    let reason = null;
    if (vendor.anonymizedAt) reason = "anonymized";
    else if (vendor.terminationNoticeAt || vendor.terminationFinalizedAt) reason = "terminated";
    else if (!user) reason = "userMissing";
    else if (user.status !== "ACTIVE") reason = "userInactive";
    else if (user.locked) reason = "userLocked";
    else if (!user.emailVerifiedAt) reason = "emailUnverified";
    else if (statuses.some((s) => ACTIVATED_SERVICE_STATUSES.includes(s))) reason = "storeActivatedBefore";
    else if (!email) reason = "noEmail";
    else if (unsubscribedEmails.has(email) || prefsOffUsers.has(vendor.userId)) reason = "unsubscribed";
    else if (user.marketingOptIn !== true) reason = "noMarketingConsent";
    else if (registered.has(vendor.id)) reason = "alreadyRegistered";

    const base = {
      vendorId: vendor.id,
      userId: vendor.userId || null,
      vendorName: vendor.displayName || "",
      firstName: user?.firstName || null,
      email,
      createdAt: vendor.createdAt,
    };
    if (reason) excluded.push({ ...base, reason });
    else {
      const hasDraft = statuses.includes("DRAFT");
      eligible.push({ ...base, hasDraftService: hasDraft, ctaPath: activationCtaPath(hasDraft) });
    }
  }
  return { eligible, excluded };
}

async function loadDeliveries(db, campaignKey) {
  const rows = await db.artfestBroadcastDelivery.findMany({
    where: { campaignKey },
    select: { vendorId: true, emailStatus: true, emailSentAt: true, emailError: true, emailAttempts: true },
  });
  return new Map(rows.map((r) => [r.vendorId, r]));
}

function deliveryState(delivery) {
  const status = delivery?.emailStatus || "PENDING";
  if (status === "SENT") return "alreadySent";
  if (status === "SENDING" || status === "UNKNOWN") return "unknown";
  if (status === "FAILED") return "failedRetry";
  return "toSend";
}

/* ===================== Previzualizare ===================== */

export async function previewActivationInvite({ db = prisma, campaignKey = ARTFEST_FAIR_ACTIVATION_INVITE_CAMPAIGN_KEY } = {}) {
  const [{ eligible, excluded }, deliveries] = await Promise.all([classifyUnactivatedVendors(db), loadDeliveries(db, campaignKey)]);

  const recipients = eligible.map((r) => {
    const delivery = deliveries.get(r.vendorId);
    return {
      vendorId: r.vendorId,
      vendorName: r.vendorName,
      firstName: r.firstName,
      email: r.email,
      createdAt: r.createdAt,
      ctaPath: r.ctaPath,
      state: deliveryState(delivery),
      sentAt: delivery?.emailSentAt || null,
      lastError: delivery?.emailStatus === "FAILED" ? delivery.emailError || null : null,
    };
  });

  const counts = { toSend: 0, alreadySent: 0, unknown: 0, failedRetry: 0 };
  for (const r of recipients) counts[r.state] += 1;
  const excludedByReason = {};
  for (const e of excluded) excludedByReason[e.reason] = (excludedByReason[e.reason] || 0) + 1;

  return {
    campaignKey,
    eligible: recipients.length,
    counts,
    recipients,
    excluded: Object.entries(excludedByReason).map(([reason, count]) => ({ reason, label: EXCLUSION_REASONS[reason] || reason, count })),
    unsubscribeAvailable: Boolean(artfestFairActivationUnsubscribeUrl("verificare@artfest.ro")),
  };
}

export function renderActivationInvitePreview({ vendorName = "Atelier Exemplu", firstName = "Ana", ctaPath = "/onboarding" } = {}) {
  const email = buildArtfestFairActivationInviteEmail({
    vendorName,
    firstName,
    ctaPath,
    helpPhoneDisplay: ARTFEST_HELP_PHONE_DISPLAY,
    helpPhoneTel: ARTFEST_HELP_PHONE_TEL,
    // în previzualizare: link demonstrativ (cel real e semnat per destinatar la trimitere)
    unsubscribeUrl: "#dezabonare",
  });
  return { subject: email.subject, preheader: email.preheader, html: email.html, text: email.text };
}

/* ===================== Trimitere ===================== */

export async function runActivationInvite({
  db = prisma,
  send = defaultSendEmail,
  vendorIds,
  campaignKey = ARTFEST_FAIR_ACTIVATION_INVITE_CAMPAIGN_KEY,
  emailDelayMs = DEFAULT_EMAIL_DELAY_MS,
  now = new Date(),
  onProgress = null,
} = {}) {
  const wanted = new Set((Array.isArray(vendorIds) ? vendorIds : []).map((v) => String(v)));
  const result = {
    campaignKey,
    selected: wanted.size,
    processed: 0,
    emailsSent: 0,
    emailsAlreadySent: 0,
    emailsFailed: 0,
    emailsUnknown: 0,
    emailsNoAddress: 0,
    notEligible: 0,
    staleMarkedUnknown: 0,
    items: [],
  };

  result.staleMarkedUnknown = await markStaleSendingUnknown(db, campaignKey, now);

  // eligibilitatea se recalculează pe server: selecția din Admin doar restrânge lista
  const { eligible } = await classifyUnactivatedVendors(db);
  const targets = eligible.filter((r) => wanted.has(r.vendorId));
  result.notEligible = wanted.size - targets.length;
  const template = artfestFairActivationInviteTemplate(campaignKey);

  for (const vendor of targets) {
    const sendOne = (payload) =>
      send({
        ...payload,
        ctaPath: vendor.ctaPath,
        helpPhoneDisplay: ARTFEST_HELP_PHONE_DISPLAY,
        helpPhoneTel: ARTFEST_HELP_PHONE_TEL,
      });

    let outcome;
    let error = null;
    try {
      const delivery = await claimDeliveryRow(db, campaignKey, vendor);
      outcome = await deliverEmail(db, delivery, vendor, campaignKey, now, sendOne, { template });
      if (outcome === "failed") {
        error = (await db.artfestBroadcastDelivery.findUnique({ where: { id: delivery.id }, select: { emailError: true } }))?.emailError || null;
      }
    } catch (e) {
      console.error("[artfestFairActivationInvite] vendor", vendor.vendorId, errorText(e));
      outcome = "failed";
      error = errorText(e);
    }

    if (outcome === "sent") result.emailsSent += 1;
    else if (outcome === "already") result.emailsAlreadySent += 1;
    else if (outcome === "unknown") result.emailsUnknown += 1;
    else if (outcome === "noEmail") result.emailsNoAddress += 1;
    else result.emailsFailed += 1;

    result.items.push({ vendorId: vendor.vendorId, vendorName: vendor.vendorName, email: vendor.email, outcome, error });
    result.processed += 1;
    if (onProgress) onProgress({ ...result, items: [...result.items] });
    if (outcome === "sent") await sleep(emailDelayMs);
  }

  return result;
}

/* ===================== Rulare din Admin (în fundal, un singur lock) ===================== */

let current = null;
let last = null;

export function getActivationInviteStatus() {
  return {
    running: Boolean(current),
    current: current ? { ...current } : null,
    last: last ? { ...last } : null,
  };
}

export function startActivationInvite({ adminId = null, vendorIds, ...options } = {}) {
  const ids = [...new Set((Array.isArray(vendorIds) ? vendorIds : []).map((v) => String(v || "").trim()).filter(Boolean))];
  if (!ids.length) throw new FairError(400, "no_recipients_selected", "Alege cel puțin un destinatar.");
  if (ids.length > MAX_ACTIVATION_INVITE_SELECTION) {
    throw new FairError(400, "too_many_recipients", `Poți trimite cel mult ${MAX_ACTIVATION_INVITE_SELECTION} invitații odată.`);
  }
  if (current) return { started: false, reason: "already_running", status: getActivationInviteStatus() };

  current = { startedAt: new Date().toISOString(), startedBy: adminId, selected: ids.length, progress: null };

  const run = runActivationInvite({
    ...options,
    vendorIds: ids,
    onProgress: (progress) => {
      if (current) current.progress = progress;
    },
  })
    .then((result) => {
      last = { ...current, finishedAt: new Date().toISOString(), result, error: null };
      const { items, ...summary } = result;
      console.log("[artfestFairActivationInvite] finalizat", JSON.stringify(summary));
    })
    .catch((error) => {
      last = { ...current, finishedAt: new Date().toISOString(), result: current?.progress || null, error: errorText(error) };
      console.error("[artfestFairActivationInvite] eroare", errorText(error));
    })
    .finally(() => {
      current = null;
    });

  return { started: true, status: getActivationInviteStatus(), done: run };
}
