// src/services/reacceptanceService.js
//
// "CERE REACCEPTAREA": acțiunea de admin, SEPARATĂ de publicare, care
// selectează document + versiune + audience și poate deschide gate-ul
// pentru utilizatorii existenți.
//
// Fără schimbări Prisma - infrastructura existentă:
//   PolicyGateCampaign  = cererea (campaignKey "req_..."), documents[]
//                         codificat "KEY@AUDIENCE@VERSION[@deadline]";
//                         și jurnalul publicărilor (campaignKey "pub_...",
//                         requiresAction=false, audience "PUBLISH");
//   Notification        = livrarea in-app (dedupeKey unic per campanie +
//                         destinatar);
//   UserConsent / VendorAcceptance = acceptările (istoric neșters).
//
// O CERERE DESCHISĂ pentru (document, audience) = cea mai recentă campanie
// "req_" pentru acea pereche, dacă are requiresAction=true. O campanie
// închisă sau înlocuită de una mai nouă nu mai obligă pe nimeni.
// Gate-ul NU depinde de notificări: le deduce din cereri + acceptări.

import crypto from "crypto";
import { prisma as defaultPrisma } from "../db.js";
import {
  AUDIENCE_ROLES,
  PUBLISH_AUDIENCE_TOKEN,
  PUBLISH_CAMPAIGN_PREFIX,
  REQUEST_CAMPAIGN_PREFIX,
  audienceForRole,
  encodeRequirement,
  findEntryByKeyAndAudience,
  getCatalogEntry,
  parseRequirement,
} from "./legalRegistry.js";
import { getPublishedInfo } from "./legalPublishedService.js";

function fail(status, code, message) {
  const error = new Error(message || code);
  error.status = status;
  error.code = code;
  return error;
}

/* ----------------------------------------------------
   Cereri deschise
----------------------------------------------------- */

export async function loadRequestCampaigns({ prisma = defaultPrisma, limit = 1000 } = {}) {
  return prisma.policyGateCampaign.findMany({
    where: { campaignKey: { startsWith: REQUEST_CAMPAIGN_PREFIX } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/*
 * Cea mai recentă cerere (deschisă SAU închisă) pentru fiecare pereche
 * document|audience. `campaigns` trebuie sortate descrescător după createdAt.
 */
export function latestRequirementsFromCampaigns(campaigns) {
  const latest = new Map();

  for (const campaign of campaigns) {
    for (const raw of campaign.documents || []) {
      const parsed = parseRequirement(raw);

      if (!parsed || parsed.audience === PUBLISH_AUDIENCE_TOKEN) continue;

      const id = `${parsed.key}|${parsed.audience}`;

      if (latest.has(id)) continue;

      latest.set(id, {
        id,
        key: parsed.key,
        audience: parsed.audience,
        version: parsed.version,
        deadlineAt: parsed.deadlineAt,
        campaignId: campaign.id,
        campaignKey: campaign.campaignKey,
        createdAt: campaign.createdAt,
        requiresAction: campaign.requiresAction === true,
        title: campaign.title,
        scope: campaign.scope,
      });
    }
  }

  return [...latest.values()];
}

export async function getOpenRequirements({ prisma = defaultPrisma } = {}) {
  const campaigns = await loadRequestCampaigns({ prisma });

  return latestRequirementsFromCampaigns(campaigns).filter(
    (requirement) => requirement.requiresAction
  );
}

export async function getOpenRequirement({ key, audience, prisma = defaultPrisma }) {
  const wantedKey = String(key || "").toUpperCase();
  const requirements = await getOpenRequirements({ prisma });

  return (
    requirements.find(
      (requirement) =>
        requirement.key === wantedKey && requirement.audience === audience
    ) || null
  );
}

/* ----------------------------------------------------
   Ce are de acceptat un utilizator / vendor
----------------------------------------------------- */

async function policyRowFor(entry, version, prisma) {
  const model = entry.storage === "USER" ? prisma.userPolicy : prisma.vendorPolicy;

  return model.findUnique({
    where: {
      document_version: { document: entry.policyDocument, version: String(version) },
    },
  });
}

/*
 * Documentele cerute (cereri deschise) pentru un cont, cu starea acceptării.
 * `role` decide audience-ul (USER/VENDOR/INFLUENCER); un ADMIN nu are
 * cerințe. Documentele stocate per vendor cer `vendorId`.
 * INFLUENCER_TERMS e exclus implicit (îl tratează InfluencerTermsGateModal).
 */
export async function resolveRequirementsForPrincipal({
  userId,
  role,
  vendorId = null,
  prisma = defaultPrisma,
  requirements = null,
  includeInfluencerTerms = false,
}) {
  const audience = audienceForRole(role);

  if (!audience || !userId) return [];

  const open = requirements || (await getOpenRequirements({ prisma }));
  const result = [];

  for (const requirement of open) {
    if (requirement.audience !== audience) continue;

    const entry = findEntryByKeyAndAudience(requirement.key, requirement.audience);

    if (!entry || !entry.contractual) continue;

    if (entry.gateHandledBy === "influencer_modal" && !includeInfluencerTerms) {
      continue;
    }

    let accepted = null;

    if (entry.storage === "USER") {
      accepted = await prisma.userConsent.findUnique({
        where: {
          userId_document_version: {
            userId,
            document: entry.policyDocument,
            version: requirement.version,
          },
        },
        select: { givenAt: true },
      });
    } else {
      if (!vendorId) continue;

      accepted = await prisma.vendorAcceptance.findUnique({
        where: {
          vendorId_document_version: {
            vendorId,
            document: entry.policyDocument,
            version: requirement.version,
          },
        },
        select: { acceptedAt: true },
      });
    }

    const policy = await policyRowFor(entry, requirement.version, prisma);

    result.push({
      key: entry.key,
      catalogId: entry.catalogId,
      document: entry.policyDocument,
      storage: entry.storage,
      scope: entry.storage === "USER" ? "USERS" : "VENDORS",
      audience: requirement.audience,
      title: policy?.title || entry.label,
      version: requirement.version,
      checksum: policy?.checksum || null,
      url: policy?.url || null,
      required: policy ? policy.isRequired === true : true,
      alreadyAccepted: Boolean(accepted),
      publishedAt: policy?.publishedAt || null,
      deadlineAt: requirement.deadlineAt,
      campaignId: requirement.campaignId,
      campaignKey: requirement.campaignKey,
      requestedAt: requirement.createdAt,
    });
  }

  return result;
}

/*
 * Verificare pentru rutele care blochează efectiv o acțiune a vendorului
 * (ex. programarea curierului cere Anexa de expediere): publicarea unei
 * versiuni noi NU blochează vendorii care au acceptat deja o versiune
 * anterioară. Blochează doar:
 *   - vendorul care nu a acceptat NICIODATĂ documentul;
 *   - vendorul vizat de o CERERE deschisă de reacceptare, pentru versiunea
 *     cerută, după termenul-limită (fără termen: imediat).
 */
export async function evaluateVendorDocument({
  vendorId,
  key,
  policyVersion,
  prisma = defaultPrisma,
  now = new Date(),
}) {
  const document = String(key).toUpperCase();

  const acceptedActive = policyVersion
    ? await prisma.vendorAcceptance.findUnique({
        where: {
          vendorId_document_version: {
            vendorId,
            document,
            version: String(policyVersion),
          },
        },
        select: { acceptedAt: true },
      })
    : null;

  if (acceptedActive) return { satisfied: true, reason: "accepted_current" };

  const requirement = await getOpenRequirement({ key: document, audience: "VENDOR", prisma });

  if (requirement) {
    const acceptedRequired = await prisma.vendorAcceptance.findUnique({
      where: {
        vendorId_document_version: {
          vendorId,
          document,
          version: requirement.version,
        },
      },
      select: { acceptedAt: true },
    });

    if (acceptedRequired) return { satisfied: true, reason: "accepted_required" };

    const deadline = requirement.deadlineAt ? new Date(requirement.deadlineAt) : null;

    if (!deadline || deadline <= now) {
      return {
        satisfied: false,
        reason: "reacceptance_required",
        requiredVersion: requirement.version,
        deadlineAt: requirement.deadlineAt,
      };
    }

    return { satisfied: true, reason: "reacceptance_grace", deadlineAt: requirement.deadlineAt };
  }

  const acceptedAny = await prisma.vendorAcceptance.findFirst({
    where: { vendorId, document },
    select: { version: true },
  });

  if (acceptedAny) return { satisfied: true, reason: "accepted_previous_version" };

  return {
    satisfied: false,
    reason: "never_accepted",
    requiredVersion: policyVersion ? String(policyVersion) : null,
  };
}

export function pendingOf(documents) {
  return documents.filter(
    (document) => document.required && !document.alreadyAccepted
  );
}

/* ----------------------------------------------------
   Publicare - jurnal de audit (fără notificări)
----------------------------------------------------- */

export function newCampaignKey(prefix) {
  return `${prefix}${crypto.randomUUID()}`;
}

/*
 * Un rând PolicyGateCampaign cu prefix "pub_": înregistrează cine a publicat
 * ce versiune și când. NU obligă pe nimeni (requiresAction=false, fără
 * notificări) și e ignorat de gate.
 */
export async function recordPublishEvent({
  db,
  entry,
  version,
  previousVersion = null,
  actorId = null,
}) {
  return db.policyGateCampaign.create({
    data: {
      scope: entry.storage === "USER" ? "USERS" : "VENDORS",
      requiresAction: false,
      title: `Publicare ${entry.label} ${version}`,
      message: previousVersion
        ? `Versiune publicată: ${version} (anterior: ${previousVersion}).`
        : `Versiune publicată: ${version}.`,
      documents: [
        encodeRequirement({
          key: entry.key,
          audience: PUBLISH_AUDIENCE_TOKEN,
          version,
        }),
      ],
      createdById: actorId,
      campaignKey: newCampaignKey(PUBLISH_CAMPAIGN_PREFIX),
    },
  });
}

/* ----------------------------------------------------
   Cere reacceptarea
----------------------------------------------------- */

function notificationLink(entry, audience) {
  if (audience === "INFLUENCER") return "/influencer?policyGate=1";
  if (entry.storage === "VENDOR") return "/desktop?policyGate=1&scope=VENDORS";

  return "/cont?policyGate=1&scope=USERS";
}

async function findPendingRecipients({ entry, audience, version, prisma }) {
  if (entry.storage === "USER") {
    const users = await prisma.user.findMany({
      where: {
        role: { in: AUDIENCE_ROLES[audience] },
        status: "ACTIVE",
        UserConsent: { none: { document: entry.policyDocument, version } },
      },
      select: { id: true, email: true },
    });

    return users.map((user) => ({ userId: user.id, vendorId: null, email: user.email }));
  }

  const vendors = await prisma.vendor.findMany({
    where: {
      user: { is: { status: "ACTIVE" } },
      VendorAcceptance: { none: { document: entry.policyDocument, version } },
    },
    select: { id: true, userId: true, email: true, user: { select: { email: true } } },
  });

  return vendors.map((vendor) => ({
    userId: vendor.userId || null,
    vendorId: vendor.id,
    email: vendor.email || vendor.user?.email || null,
  }));
}

export async function requestReacceptance({
  catalogId,
  audience,
  version,
  requiresAction = true,
  deadlineAt = null,
  inApp = {},
  email = null,
  actorId = null,
  prisma = defaultPrisma,
}) {
  const entry = getCatalogEntry(catalogId);

  if (!entry || !entry.contractual) {
    throw fail(400, "document_not_reacceptable", "Documentul nu poate face obiectul reacceptării contractuale.");
  }

  const normalizedAudience = String(audience || "").toUpperCase();

  if (!entry.audiences.includes(normalizedAudience)) {
    throw fail(400, "audience_not_applicable", "Audience-ul nu se aplică acestui document.");
  }

  const wantedVersion = String(version || "").trim();

  const published = await getPublishedInfo(catalogId, prisma);

  if (
    !published ||
    published.source !== "policy" ||
    String(published.version) !== wantedVersion
  ) {
    throw fail(
      409,
      "version_not_published",
      "Versiunea trebuie publicată înainte de a cere reacceptarea."
    );
  }

  let deadline = null;

  if (deadlineAt) {
    deadline = new Date(deadlineAt);

    if (Number.isNaN(deadline.getTime())) {
      throw fail(400, "invalid_deadline", "Termenul-limită este invalid.");
    }
  }

  const title = String(inApp?.title || "Actualizare documente legale").trim();
  const message = String(
    inApp?.message ||
      `Am actualizat ${entry.label}. Te rugăm să consulți și să accepți noua versiune.`
  ).trim();

  if (!title || !message) {
    throw fail(400, "notification_content_required", "Titlul și mesajul sunt obligatorii.");
  }

  const sendEmail = Boolean(email && email.enabled !== false && (email.subject || email.body));

  const recipients = await findPendingRecipients({
    entry,
    audience: normalizedAudience,
    version: wantedVersion,
    prisma,
  });

  const allCampaigns = await loadRequestCampaigns({ prisma });
  const previousKeys = allCampaigns
    .filter((campaign) =>
      (campaign.documents || []).some((raw) => {
        const parsed = parseRequirement(raw);
        return (
          parsed && parsed.key === entry.key && parsed.audience === normalizedAudience
        );
      })
    )
    .map((campaign) => campaign.campaignKey);

  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const campaign = await tx.policyGateCampaign.create({
      data: {
        scope: entry.storage === "USER" ? "USERS" : "VENDORS",
        requiresAction: requiresAction === true,
        title,
        message,
        sendEmail,
        emailSubject: sendEmail ? String(email.subject || title).trim() : null,
        emailBody: sendEmail ? String(email.body || message) : null,
        documents: [
          encodeRequirement({
            key: entry.key,
            audience: normalizedAudience,
            version: wantedVersion,
            deadlineAt: deadline,
          }),
        ],
        createdById: actorId,
        campaignKey: newCampaignKey(REQUEST_CAMPAIGN_PREFIX),
      },
    });

    const rows = recipients.map((recipient) => ({
      userId: entry.storage === "USER" ? recipient.userId : null,
      vendorId: entry.storage === "VENDOR" ? recipient.vendorId : null,
      type: "system",
      title,
      body: message,
      link: notificationLink(entry, normalizedAudience),
      dedupeKey: `policy:${campaign.campaignKey}:${recipient.userId || recipient.vendorId}`,
      meta: {
        kind: "POLICY_UPDATE",
        scope: campaign.scope,
        audience: normalizedAudience,
        documents: [entry.key],
        requirements: [
          {
            key: entry.key,
            audience: normalizedAudience,
            version: wantedVersion,
            deadlineAt: deadline ? deadline.toISOString() : null,
          },
        ],
        requiresAction: requiresAction === true,
        campaignId: campaign.id,
        campaignKey: campaign.campaignKey,
        email: sendEmail,
        createdAt: now.toISOString(),
      },
    }));

    let created = { count: 0 };

    if (rows.length) {
      created = await tx.notification.createMany({ data: rows, skipDuplicates: true });
    }

    // cererile anterioare pentru aceeași pereche sunt înlocuite
    for (const previousKey of previousKeys) {
      await tx.notification.updateMany({
        where: {
          archived: false,
          meta: { path: ["campaignKey"], equals: previousKey },
        },
        data: { archived: true, readAt: now },
      });
    }

    const updated = await tx.policyGateCampaign.update({
      where: { id: campaign.id },
      data: {
        targetCount: recipients.length,
        createdCount: created.count,
        emailQueued: sendEmail ? 0 : null,
        emailFailed: sendEmail ? 0 : null,
      },
    });

    return { campaign: updated, createdCount: created.count };
  });

  return {
    ok: true,
    campaignId: result.campaign.id,
    campaignKey: result.campaign.campaignKey,
    requirement: {
      key: entry.key,
      catalogId: entry.catalogId,
      audience: normalizedAudience,
      version: wantedVersion,
      deadlineAt: deadline,
      requiresAction: requiresAction === true,
    },
    targetCount: recipients.length,
    createdCount: result.createdCount,
    emailRequested: sendEmail,
    recipients,
  };
}

/* ----------------------------------------------------
   Închide (retrage) o cerere deschisă
----------------------------------------------------- */

export async function closeReacceptance({ campaignId, prisma = defaultPrisma }) {
  const campaign = await prisma.policyGateCampaign.findUnique({
    where: { id: String(campaignId) },
  });

  if (!campaign || !String(campaign.campaignKey).startsWith(REQUEST_CAMPAIGN_PREFIX)) {
    throw fail(404, "campaign_not_found", "Cererea nu a fost găsită.");
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.policyGateCampaign.update({
      where: { id: campaign.id },
      data: { requiresAction: false },
    });

    await tx.notification.updateMany({
      where: {
        archived: false,
        meta: { path: ["campaignKey"], equals: campaign.campaignKey },
      },
      data: { archived: true, readAt: now },
    });
  });

  return { ok: true, campaignId: campaign.id };
}

/* ----------------------------------------------------
   Istoric (cereri + publicări) pentru un rând de catalog
----------------------------------------------------- */

export async function listCampaignHistory({ entry, prisma = defaultPrisma, limit = 200 }) {
  const campaigns = await prisma.policyGateCampaign.findMany({
    where: {
      OR: [
        { campaignKey: { startsWith: REQUEST_CAMPAIGN_PREFIX } },
        { campaignKey: { startsWith: PUBLISH_CAMPAIGN_PREFIX } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: limit * 3,
  });

  const items = [];

  for (const campaign of campaigns) {
    for (const raw of campaign.documents || []) {
      const parsed = parseRequirement(raw);

      if (!parsed || parsed.key !== entry.key) continue;

      const isPublish = parsed.audience === PUBLISH_AUDIENCE_TOKEN;

      // Returns are două rânduri: cererile se potrivesc doar audience-ului lor
      if (!isPublish && !entry.audiences.includes(parsed.audience)) continue;

      // publicările se potrivesc după stocare (USERS/VENDORS)
      if (isPublish && campaign.scope !== (entry.storage === "USER" ? "USERS" : "VENDORS")) {
        continue;
      }

      items.push({
        type: isPublish ? "PUBLISH" : "REQUEST",
        campaignId: campaign.id,
        campaignKey: campaign.campaignKey,
        audience: isPublish ? null : parsed.audience,
        version: parsed.version,
        deadlineAt: parsed.deadlineAt,
        requiresAction: campaign.requiresAction,
        title: campaign.title,
        createdAt: campaign.createdAt,
        createdById: campaign.createdById,
        targetCount: campaign.targetCount,
        createdCount: campaign.createdCount,
        emailQueued: campaign.emailQueued,
        emailFailed: campaign.emailFailed,
      });
    }
  }

  return items.slice(0, limit);
}
