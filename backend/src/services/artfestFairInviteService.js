// backend/src/services/artfestFairInviteService.js
//
// Invitația la Târgul de Crăciun Artfest către toți vendorii activi.
//
// Pornită EXCLUSIV manual, din Admin (POST /api/admin/artfest-fair/invite/send).
// NU e legată de startup, deploy, cron sau vreun job recurent.
//
// Idempotent - un rând ArtfestBroadcastDelivery per (campaignKey, vendorId),
// cu stări SEPARATE pentru notificare și email:
//   - notificarea: Notification.dedupeKey @unique => a doua inserare e
//     imposibilă; dacă există deja, doar o legăm de rândul de livrare;
//   - emailul: se „revendică” atomic (PENDING/FAILED -> SENDING, updateMany
//     condiționat) și pleacă DOAR dacă revendicarea a reușit;
//       SENT     -> nu se mai retrimite;
//       FAILED   -> reîncercat la rularea următoare;
//       SENDING  -> rămas dintr-o rulare întreruptă => marcat UNKNOWN;
//       UNKNOWN  -> NU se retrimite automat (poate a plecat deja).
//   - plasă suplimentară: un EmailLog SENT pe template-ul campaniei pentru
//     aceeași adresă => marcat SENT fără retrimitere.
//
// Invitația e comunicare operațională / de parteneriat: NU depinde de
// opțiunile de marketing ale vendorului.

import { prisma } from "../db.js";
import {
  artfestFairInviteTemplate,
  sendArtfestFairInviteEmail as defaultSendEmail,
} from "../lib/mailer.js";
import {
  ARTFEST_FAIR_KEY,
  ARTFEST_FAIR_INVITE_CAMPAIGN_KEY,
  ARTFEST_FAIR_INVITE_NOTIFICATION,
  ARTFEST_FAIR_VENDOR_PATH,
} from "../config/artfestFair.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// un SENDING mai vechi de atât provine dintr-o rulare întreruptă
export const STALE_SENDING_MS = 15 * 60 * 1000;

// pauză între emailuri (limita de rată a providerului)
const DEFAULT_EMAIL_DELAY_MS = Number(process.env.ARTFEST_FAIR_INVITE_EMAIL_DELAY_MS) || 300;

export function inviteDedupeKey(vendorId, campaignKey = ARTFEST_FAIR_INVITE_CAMPAIGN_KEY) {
  return `artfest_fair_invite:${campaignKey}:${vendorId}`;
}

/*
 * Vendor eligibil: magazin activ, cont ACTIVE și neblocat, neanonimizat,
 * fără încetare a colaborării în curs sau finalizată.
 */
export function eligibleVendorWhere() {
  return {
    isActive: true,
    anonymizedAt: null,
    terminationNoticeAt: null,
    terminationFinalizedAt: null,
    user: { is: { status: "ACTIVE", locked: false } },
  };
}

function normalizeEmail(value) {
  const email = String(value ?? "").trim().toLowerCase();
  return email && EMAIL_RE.test(email) ? email : null;
}

export async function loadEligibleVendors(db = prisma) {
  const vendors = await db.vendor.findMany({
    where: eligibleVendorWhere(),
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      userId: true,
      displayName: true,
      email: true,
      user: { select: { email: true, firstName: true } },
    },
  });

  return vendors.map((vendor) => ({
    vendorId: vendor.id,
    userId: vendor.userId || null,
    vendorName: vendor.displayName || "",
    firstName: vendor.user?.firstName || null,
    // email din vendor.email, cu fallback pe emailul contului
    email: normalizeEmail(vendor.email) || normalizeEmail(vendor.user?.email),
  }));
}

async function loadDeliveries(db, campaignKey) {
  const rows = await db.artfestBroadcastDelivery.findMany({
    where: { campaignKey },
    select: {
      id: true,
      vendorId: true,
      notificationStatus: true,
      emailStatus: true,
      emailAttempts: true,
      notificationId: true,
      updatedAt: true,
    },
  });
  return new Map(rows.map((row) => [row.vendorId, row]));
}

/* ===================== Previzualizare ===================== */

export async function previewInvite({ db = prisma, campaignKey = ARTFEST_FAIR_INVITE_CAMPAIGN_KEY } = {}) {
  const [vendors, deliveries] = await Promise.all([loadEligibleVendors(db), loadDeliveries(db, campaignKey)]);

  const summary = {
    campaignKey,
    eligibleVendors: vendors.length,
    notifications: { toSend: 0, alreadySent: 0 },
    emails: { toSend: 0, alreadySent: 0, unknown: 0, noEmail: 0, failedRetry: 0 },
  };

  for (const vendor of vendors) {
    const delivery = deliveries.get(vendor.vendorId);

    if (delivery?.notificationStatus === "SENT") summary.notifications.alreadySent += 1;
    else summary.notifications.toSend += 1;

    const emailStatus = delivery?.emailStatus || "PENDING";
    if (emailStatus === "SENT") summary.emails.alreadySent += 1;
    else if (emailStatus === "SENDING" || emailStatus === "UNKNOWN") summary.emails.unknown += 1;
    else if (!vendor.email) summary.emails.noEmail += 1;
    else {
      summary.emails.toSend += 1;
      if (emailStatus === "FAILED") summary.emails.failedRetry += 1;
    }
  }

  return summary;
}

/* ===================== Trimitere ===================== */

const sleep = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

function errorText(error) {
  return String(error?.message || error || "unknown_error").slice(0, 1000);
}

async function claimDeliveryRow(db, campaignKey, vendor) {
  const where = { campaignKey_vendorId: { campaignKey, vendorId: vendor.vendorId } };
  try {
    return await db.artfestBroadcastDelivery.upsert({
      where,
      create: {
        campaignKey,
        vendorId: vendor.vendorId,
        userId: vendor.userId,
        emailTo: vendor.email,
      },
      update: {},
    });
  } catch (error) {
    // creare simultană din altă instanță => rândul există deja
    if (error?.code === "P2002") return db.artfestBroadcastDelivery.findUnique({ where });
    throw error;
  }
}

async function deliverNotification(db, delivery, vendor, campaignKey, now) {
  if (delivery.notificationStatus === "SENT") return "already";

  const dedupeKey = inviteDedupeKey(vendor.vendorId, campaignKey);

  try {
    let notification = await db.notification.findUnique({ where: { dedupeKey }, select: { id: true } });
    let outcome = "already";

    if (!notification) {
      try {
        notification = await db.notification.create({
          data: {
            vendorId: vendor.vendorId,
            type: "system",
            title: ARTFEST_FAIR_INVITE_NOTIFICATION.title,
            body: ARTFEST_FAIR_INVITE_NOTIFICATION.body,
            link: ARTFEST_FAIR_VENDOR_PATH,
            dedupeKey,
            meta: {
              kind: "ARTFEST_FAIR_INVITE",
              fairKey: ARTFEST_FAIR_KEY,
              campaignKey,
              ctaLabel: ARTFEST_FAIR_INVITE_NOTIFICATION.ctaLabel,
            },
          },
          select: { id: true },
        });
        outcome = "sent";
      } catch (error) {
        if (error?.code !== "P2002") throw error;
        notification = await db.notification.findUnique({ where: { dedupeKey }, select: { id: true } });
      }
    }

    await db.artfestBroadcastDelivery.update({
      where: { id: delivery.id },
      data: {
        notificationStatus: "SENT",
        notificationId: notification?.id || null,
        notifiedAt: now,
        notificationError: null,
      },
    });

    return outcome;
  } catch (error) {
    await db.artfestBroadcastDelivery
      .update({
        where: { id: delivery.id },
        data: { notificationStatus: "FAILED", notificationError: errorText(error) },
      })
      .catch(() => null);
    return "failed";
  }
}

async function deliverEmail(db, delivery, vendor, campaignKey, now, send) {
  if (delivery.emailStatus === "SENT") return "already";
  if (delivery.emailStatus === "SENDING" || delivery.emailStatus === "UNKNOWN") return "unknown";
  if (!vendor.email) return "noEmail";

  const template = artfestFairInviteTemplate(campaignKey);

  // plasă: emailul a plecat deja (EmailLog SENT), dar rândul nu a fost marcat
  const logged = await db.emailLog.findFirst({
    where: { template, toEmail: vendor.email, status: "SENT" },
    select: { sentAt: true, createdAt: true },
  });

  if (logged) {
    await db.artfestBroadcastDelivery.update({
      where: { id: delivery.id },
      data: { emailStatus: "SENT", emailSentAt: logged.sentAt || logged.createdAt || now, emailError: null },
    });
    return "already";
  }

  // revendicare atomică: doar un singur proces trece de aici pentru acest vendor
  const claimed = await db.artfestBroadcastDelivery.updateMany({
    where: { id: delivery.id, emailStatus: { in: ["PENDING", "FAILED"] } },
    data: {
      emailStatus: "SENDING",
      emailTo: vendor.email,
      emailAttempts: (delivery.emailAttempts || 0) + 1,
      updatedAt: new Date(),
    },
  });

  if (claimed.count !== 1) return "unknown";

  try {
    await send({
      to: vendor.email,
      userId: vendor.userId,
      vendorName: vendor.vendorName,
      firstName: vendor.firstName,
      campaignKey,
    });
  } catch (error) {
    await db.artfestBroadcastDelivery.update({
      where: { id: delivery.id },
      data: { emailStatus: "FAILED", emailError: errorText(error) },
    });
    return "failed";
  }

  await db.artfestBroadcastDelivery.update({
    where: { id: delivery.id },
    data: { emailStatus: "SENT", emailSentAt: new Date(), emailError: null },
  });
  return "sent";
}

// SENDING rămas dintr-o rulare întreruptă => UNKNOWN (nu se retrimite automat)
async function markStaleSendingUnknown(db, campaignKey, now) {
  const result = await db.artfestBroadcastDelivery.updateMany({
    where: {
      campaignKey,
      emailStatus: "SENDING",
      updatedAt: { lt: new Date(now.getTime() - STALE_SENDING_MS) },
    },
    data: { emailStatus: "UNKNOWN", emailError: "interrupted_send" },
  });
  return result.count || 0;
}

export async function runInvite({
  db = prisma,
  send = defaultSendEmail,
  campaignKey = ARTFEST_FAIR_INVITE_CAMPAIGN_KEY,
  emailDelayMs = DEFAULT_EMAIL_DELAY_MS,
  now = new Date(),
  onProgress = null,
} = {}) {
  const result = {
    campaignKey,
    eligibleVendors: 0,
    processed: 0,
    notificationsSent: 0,
    notificationsAlreadySent: 0,
    notificationsFailed: 0,
    emailsSent: 0,
    emailsAlreadySent: 0,
    emailsFailed: 0,
    emailsUnknown: 0,
    emailsNoAddress: 0,
    skippedVendors: 0,
    errors: 0,
    staleMarkedUnknown: 0,
  };

  result.staleMarkedUnknown = await markStaleSendingUnknown(db, campaignKey, now);

  const vendors = await loadEligibleVendors(db);
  result.eligibleVendors = vendors.length;

  for (const vendor of vendors) {
    let notificationOutcome;
    let emailOutcome;

    try {
      const delivery = await claimDeliveryRow(db, campaignKey, vendor);
      notificationOutcome = await deliverNotification(db, delivery, vendor, campaignKey, now);
      emailOutcome = await deliverEmail(db, delivery, vendor, campaignKey, now, send);
    } catch (error) {
      console.error("[artfestFairInvite] vendor", vendor.vendorId, errorText(error));
      notificationOutcome ??= "failed";
      emailOutcome ??= "failed";
    }

    if (notificationOutcome === "sent") result.notificationsSent += 1;
    else if (notificationOutcome === "already") result.notificationsAlreadySent += 1;
    else result.notificationsFailed += 1;

    if (emailOutcome === "sent") result.emailsSent += 1;
    else if (emailOutcome === "already") result.emailsAlreadySent += 1;
    else if (emailOutcome === "unknown") result.emailsUnknown += 1;
    else if (emailOutcome === "noEmail") result.emailsNoAddress += 1;
    else result.emailsFailed += 1;

    if (notificationOutcome === "failed" || emailOutcome === "failed") result.errors += 1;
    else if (notificationOutcome !== "sent" && emailOutcome !== "sent") result.skippedVendors += 1;

    result.processed += 1;
    if (onProgress) onProgress({ ...result });

    if (emailOutcome === "sent") await sleep(emailDelayMs);
  }

  return result;
}

/* ===================== Rulare din Admin (în fundal) ===================== */

/*
 * Trimiterea poate dura (pauză între emailuri), deci POST-ul din Admin
 * pornește rularea și răspunde imediat; UI-ul citește progresul din
 * getInviteStatus(). O singură rulare odată în proces (lock); dedupe-ul
 * din DB acoperă și mai multe instanțe.
 */
let current = null;
let last = null;

export function getInviteStatus() {
  return {
    running: Boolean(current),
    current: current ? { ...current } : null,
    last: last ? { ...last } : null,
  };
}

export function startInvite({ adminId = null, ...options } = {}) {
  if (current) return { started: false, reason: "already_running", status: getInviteStatus() };

  current = { startedAt: new Date().toISOString(), startedBy: adminId, progress: null };

  const run = runInvite({
    ...options,
    onProgress: (progress) => {
      if (current) current.progress = progress;
    },
  })
    .then((result) => {
      last = { ...current, finishedAt: new Date().toISOString(), result, error: null };
      console.log("[artfestFairInvite] finalizat", JSON.stringify(result));
    })
    .catch((error) => {
      last = { ...current, finishedAt: new Date().toISOString(), result: current?.progress || null, error: errorText(error) };
      console.error("[artfestFairInvite] eroare", errorText(error));
    })
    .finally(() => {
      current = null;
    });

  return { started: true, status: getInviteStatus(), done: run };
}
