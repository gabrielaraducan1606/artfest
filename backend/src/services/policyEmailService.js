// src/services/policyEmailService.js
//
// Trimiterea REALĂ a emailului de reacceptare (tranzacțional / legal, nu
// marketing) pe mailer-ul existent (lib/mailer.js -> sendPolicyUpdateEmail,
// EmailLog). Destinatarii sunt cei cărora li s-a creat notificarea
// campaniei (meta.campaignKey), deci cei care NU au acceptat încă
// versiunea la momentul cererii.
//
// - Trimiterea rulează în loturi (concurență limitată), în procesul curent.
// - Contoarele existente ale campaniei: emailQueued = destinatari cu email
//   eligibili; emailFailed = eșecurile din ultima rulare.
// - Idempotent/reluabil: cine are deja un EmailLog SENT pentru campanie NU
//   primește al doilea email; "resend" reia doar eșecurile.

import { prisma as defaultPrisma } from "../db.js";
import { sendPolicyUpdateEmail as defaultSend } from "../lib/mailer.js";
import { defaultPublicUrlForType } from "../lib/legal.js";
import {
  PUBLISH_AUDIENCE_TOKEN,
  findEntryByKeyAndAudience,
  parseRequirement,
} from "./legalRegistry.js";

export function templateForCampaign(campaignKey) {
  return `policy_update:${campaignKey}`;
}

/*
 * Corpul emailului scris în Admin poate fi HTML (cum era formularul vechi):
 * îl convertim în text simplu, ca să nu injectăm HTML nesanitizat.
 */
export function htmlToPlainText(input) {
  return String(input || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function requirementOfCampaign(campaign) {
  for (const raw of campaign.documents || []) {
    const parsed = parseRequirement(raw);

    if (parsed && parsed.audience !== PUBLISH_AUDIENCE_TOKEN) return parsed;
  }

  return null;
}

async function loadRecipients({ campaign, prisma }) {
  const notifications = await prisma.notification.findMany({
    where: { meta: { path: ["campaignKey"], equals: campaign.campaignKey } },
    select: { userId: true, vendorId: true },
  });

  const userIds = [...new Set(notifications.map((n) => n.userId).filter(Boolean))];
  const vendorIds = [...new Set(notifications.map((n) => n.vendorId).filter(Boolean))];

  const [users, vendors] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, name: true, firstName: true },
        })
      : [],
    vendorIds.length
      ? prisma.vendor.findMany({
          where: { id: { in: vendorIds } },
          select: {
            id: true,
            email: true,
            displayName: true,
            userId: true,
            user: { select: { email: true } },
          },
        })
      : [],
  ]);

  const recipients = [];

  for (const user of users) {
    recipients.push({
      userId: user.id,
      email: user.email || null,
      name: user.firstName || user.name || "",
    });
  }

  for (const vendor of vendors) {
    recipients.push({
      userId: vendor.userId || null,
      email: vendor.email || vendor.user?.email || null,
      name: vendor.displayName || "",
    });
  }

  return recipients;
}

async function mapLimit(items, limit, worker) {
  const results = [];

  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    results.push(...(await Promise.allSettled(batch.map(worker))));
  }

  return results;
}

export async function sendCampaignEmails({
  campaignId,
  prisma = defaultPrisma,
  send = defaultSend,
  batchSize = 10,
}) {
  const campaign = await prisma.policyGateCampaign.findUnique({
    where: { id: String(campaignId) },
  });

  if (!campaign) {
    const error = new Error("campaign_not_found");
    error.status = 404;
    error.code = "campaign_not_found";
    throw error;
  }

  if (!campaign.sendEmail) {
    return { skipped: true, reason: "email_not_requested", total: 0, sent: 0, failed: 0 };
  }

  const requirement = requirementOfCampaign(campaign);
  const entry = requirement
    ? findEntryByKeyAndAudience(requirement.key, requirement.audience)
    : null;

  const documents = requirement
    ? [
        {
          title: entry?.label || requirement.key,
          version: requirement.version,
          url: entry ? defaultPublicUrlForType(entry.manifestType) : null,
          deadlineAt: requirement.deadlineAt,
        },
      ]
    : [];

  const link =
    requirement?.audience === "INFLUENCER"
      ? "/influencer"
      : entry?.storage === "VENDOR"
      ? "/desktop?policyGate=1&scope=VENDORS"
      : "/cont?policyGate=1&scope=USERS";

  const template = templateForCampaign(campaign.campaignKey);

  const alreadySent = new Set(
    (
      await prisma.emailLog.findMany({
        where: { template, status: "SENT" },
        select: { toEmail: true },
      })
    ).map((row) => String(row.toEmail).toLowerCase())
  );

  const all = await loadRecipients({ campaign, prisma });
  const withEmail = all.filter((r) => r.email);
  const noEmail = all.length - withEmail.length;

  const toSend = withEmail.filter(
    (r) => !alreadySent.has(String(r.email).toLowerCase())
  );

  const subject = campaign.emailSubject || campaign.title;
  const body = htmlToPlainText(campaign.emailBody || campaign.message);

  const results = await mapLimit(toSend, batchSize, (recipient) =>
    send({
      to: recipient.email,
      name: recipient.name,
      subject,
      body,
      documents,
      link,
      campaignKey: campaign.campaignKey,
      userId: recipient.userId,
    })
  );

  const failed = results.filter((r) => r.status === "rejected").length;
  const sent = results.length - failed;

  await prisma.policyGateCampaign.update({
    where: { id: campaign.id },
    data: { emailQueued: withEmail.length, emailFailed: failed },
  });

  return {
    skipped: false,
    total: withEmail.length,
    attempted: toSend.length,
    sent,
    failed,
    alreadySent: withEmail.length - toSend.length,
    noEmail,
  };
}

/*
 * Pornește trimiterea. Fără `wait`, rulează în fundal (nu blochează
 * răspunsul adminului); erorile se loghează, iar starea rămâne vizibilă în
 * contoarele campaniei și se poate relua prin "resend-email".
 */
export function dispatchCampaignEmails({ wait = false, ...options }) {
  const run = sendCampaignEmails(options).catch((error) => {
    console.error("[policy email] campaign send failed:", options.campaignId, error);

    if (wait) throw error;

    return { error: error?.code || "send_failed" };
  });

  return wait ? run : undefined;
}
