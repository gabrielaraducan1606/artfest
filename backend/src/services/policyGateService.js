// src/services/policyGateService.js
//
// Starea gate-ului de politici pentru un cont (utilizator / vendor /
// influencer) și acceptarea documentelor cerute.
//
// Sursa adevărului = CERERILE deschise de reacceptare (services/
// reacceptanceService.js) + acceptările existente (UserConsent /
// VendorAcceptance). Gate-ul NU mai depinde de "ultima notificare".
//
// Compatibilitate cu campaniile legacy: notificările POLICY_UPDATE care nu au
// `meta.requirements` (create înainte de acest mecanism) continuă să
// funcționeze prin logica veche (policyService.buildPolicyGateDocuments),
// exact ca înainte, cu o singură excepție: COOKIES nu mai generează gate
// contractual (rămâne doar istoric).
//
// Un gate poate conține MAI MULTE documente cerute simultan (ex. TOS +
// Privacy + Returns).

import { prisma as defaultPrisma } from "../db.js";
import {
  acceptPolicyDocuments,
  buildPolicyGateDocuments,
} from "./policyService.js";
import {
  getOpenRequirements,
  pendingOf,
  resolveRequirementsForPrincipal,
} from "./reacceptanceService.js";
import { audienceForRole } from "./legalRegistry.js";

const LEGACY_LOOKBACK = 25;

function fail(status, code, extra = {}) {
  const error = new Error(code);
  error.status = status;
  error.code = code;
  Object.assign(error, extra);
  return error;
}

export function normalizeGateScope(value) {
  const scope = String(value || "").trim().toUpperCase();

  return ["USERS", "VENDORS"].includes(scope) ? scope : null;
}

function withoutCookies(keys) {
  return keys.filter((key) => key !== "COOKIES");
}

async function policyNotifications({ scope, userId, vendorId, prisma }) {
  return prisma.notification.findMany({
    where: {
      archived: false,
      ...(scope === "USERS" ? { userId } : { vendorId }),
      meta: { path: ["kind"], equals: "POLICY_UPDATE" },
    },
    orderBy: { createdAt: "desc" },
    take: LEGACY_LOOKBACK,
  });
}

function hasRequirements(notification) {
  return Array.isArray(notification?.meta?.requirements);
}

function requirementsFromNotification(notification) {
  const meta = notification.meta || {};

  return (meta.requirements || []).map((item) => ({
    id: `${item.key}|${item.audience}`,
    key: item.key,
    audience: item.audience,
    version: item.version,
    deadlineAt: item.deadlineAt || null,
    campaignId: meta.campaignId || null,
    campaignKey: meta.campaignKey || null,
    createdAt: notification.createdAt,
    requiresAction: meta.requiresAction === true,
  }));
}

/*
 * Starea gate-ului pentru un scope (USERS = documente stocate per
 * utilizator, VENDORS = stocate per vendor).
 *
 * Întoarce { notification, requiresAction, documents, sources } în forma
 * folosită de frontendul existent (`documents[]` cu `alreadyAccepted`).
 */
export async function getGateState({
  userId,
  role,
  vendorId = null,
  scope,
  prisma = defaultPrisma,
}) {
  const normalizedScope = normalizeGateScope(scope);

  if (!normalizedScope) throw fail(400, "invalid_scope");

  if (normalizedScope === "VENDORS" && !vendorId) {
    throw fail(403, "vendor_required");
  }

  const notifications = await policyNotifications({
    scope: normalizedScope,
    userId,
    vendorId,
    prisma,
  });

  /* ------- cereri deschise (mecanismul nou) ------- */

  const open = await getOpenRequirements({ prisma });

  const requirementDocs = (
    await resolveRequirementsForPrincipal({
      userId,
      role,
      vendorId,
      prisma,
      requirements: open,
    })
  ).filter((doc) => doc.scope === normalizedScope);

  /* ------- cereri informative (requiresAction=false) ------- */

  const informational = notifications.find(
    (n) => hasRequirements(n) && n.meta?.requiresAction === false
  );

  let informationalDocs = [];

  if (informational && !requirementDocs.length) {
    informationalDocs = (
      await resolveRequirementsForPrincipal({
        userId,
        role,
        vendorId,
        prisma,
        requirements: requirementsFromNotification(informational),
      })
    ).filter((doc) => doc.scope === normalizedScope);
  }

  /* ------- campanii legacy (fără meta.requirements) ------- */

  const legacy = notifications.find((n) => !hasRequirements(n));
  let legacyDocs = [];

  if (legacy) {
    const keys = withoutCookies(
      Array.isArray(legacy.meta?.documents)
        ? legacy.meta.documents.map((k) => String(k).toUpperCase())
        : []
    );

    legacyDocs = keys.length
      ? (
          await buildPolicyGateDocuments({
            scope: normalizedScope,
            userId,
            vendorId,
            documentKeys: keys,
          })
        ).map((doc) => ({ ...doc, legacy: true, scope: normalizedScope }))
      : [];
  }

  /* ------- îmbinare: cererea nouă are prioritate față de legacy ------- */

  const byKey = new Map();

  for (const doc of [...legacyDocs, ...informationalDocs, ...requirementDocs]) {
    byKey.set(doc.key, doc);
  }

  const documents = [...byKey.values()];

  // o cerere deschisă obligă DOAR cât timp mai are documente neacceptate
  const requiresAction =
    pendingOf(requirementDocs).length > 0 ||
    (legacy ? legacy.meta?.requiresAction === true : false);

  let notification = null;
  const newest = notifications[0] || null;

  if (newest) {
    notification = {
      id: newest.id,
      title: newest.title,
      message: newest.body,
      createdAt: newest.createdAt,
    };
  } else if (documents.length) {
    notification = {
      id: null,
      title: "Documente de acceptat",
      message: "Trebuie să consulți și să accepți documentele actualizate.",
      createdAt: documents[0].requestedAt || null,
    };
  }

  return {
    notification: documents.length ? notification : null,
    requiresAction: documents.length ? requiresAction : false,
    documents,
    sources: {
      requirements: requirementDocs.length,
      informational: informationalDocs.length,
      legacy: legacyDocs.length,
    },
  };
}

/*
 * Toate documentele în așteptare pentru cont, pe ambele scope-uri
 * (folosit de răspunsul 428 / hook-ul de gate / verificări).
 */
export async function getPendingDocuments({
  userId,
  role,
  vendorId = null,
  prisma = defaultPrisma,
}) {
  const audience = audienceForRole(role);

  if (!audience) return { pending: [], documents: [] };

  const documents = await resolveRequirementsForPrincipal({
    userId,
    role,
    vendorId,
    prisma,
  });

  return { pending: pendingOf(documents), documents };
}

/* ----------------------------------------------------
   Acceptare
----------------------------------------------------- */

async function acceptRequirementDocs({ docs, userId, vendorId, ip, ua, source, prisma }) {
  const accepted = [];

  await prisma.$transaction(async (tx) => {
    for (const doc of docs) {
      if (doc.storage === "USER") {
        const consent = await tx.userConsent.upsert({
          where: {
            userId_document_version: {
              userId,
              document: doc.document,
              version: doc.version,
            },
          },
          create: {
            userId,
            document: doc.document,
            version: doc.version,
            checksum: doc.checksum || null,
            ip,
            ua,
          },
          update: {
            checksum: doc.checksum || null,
            ip,
            ua,
            givenAt: new Date(),
          },
        });

        accepted.push({
          key: doc.key,
          document: doc.document,
          version: doc.version,
          acceptedAt: consent.givenAt,
        });
      } else {
        const acceptance = await tx.vendorAcceptance.upsert({
          where: {
            vendorId_document_version: {
              vendorId,
              document: doc.document,
              version: doc.version,
            },
          },
          create: {
            vendorId,
            userId,
            document: doc.document,
            version: doc.version,
            checksum: doc.checksum || null,
            acceptedAt: new Date(),
            ip,
            ua,
            source,
          },
          update: {
            userId,
            checksum: doc.checksum || null,
            acceptedAt: new Date(),
            ip,
            ua,
            source,
          },
        });

        accepted.push({
          key: doc.key,
          document: doc.document,
          version: doc.version,
          acceptedAt: acceptance.acceptedAt,
        });
      }
    }
  });

  return accepted;
}

async function archiveCampaignNotifications({ campaignKeys, scope, userId, vendorId, prisma }) {
  const now = new Date();

  for (const campaignKey of campaignKeys) {
    await prisma.notification.updateMany({
      where: {
        archived: false,
        ...(scope === "USERS" ? { userId } : { vendorId }),
        meta: { path: ["campaignKey"], equals: campaignKey },
      },
      data: { archived: true, readAt: now },
    });
  }
}

export async function acceptGateDocuments({
  userId,
  role,
  vendorId = null,
  scope,
  documentKeys,
  ip = null,
  ua = null,
  source = "policy_gate",
  prisma = defaultPrisma,
}) {
  const normalizedScope = normalizeGateScope(scope);

  if (!normalizedScope) throw fail(400, "invalid_scope");

  const keys = Array.from(
    new Set(
      (Array.isArray(documentKeys) ? documentKeys : [])
        .map((k) => String(typeof k === "string" ? k : k?.key || "").trim().toUpperCase())
        .filter(Boolean)
    )
  );

  if (!keys.length) throw fail(400, "no_documents");

  const state = await getGateState({ userId, role, vendorId, scope: normalizedScope, prisma });
  const allowed = new Map(state.documents.map((doc) => [doc.key, doc]));

  const invalid = keys.filter((key) => !allowed.has(key));

  if (invalid.length) throw fail(400, "invalid_documents", { invalidDocuments: invalid });

  const requirementDocs = keys.map((k) => allowed.get(k)).filter((d) => !d.legacy);
  const legacyKeys = keys.filter((k) => allowed.get(k).legacy);

  /*
   * Doar documentele care FAC parte dintr-o cerere/notificare pot fi
   * acceptate aici, iar versiunea acceptată e cea CERUTĂ (nu "cea mai nouă").
   */
  const accepted = [];

  if (requirementDocs.length) {
    accepted.push(
      ...(await acceptRequirementDocs({
        docs: requirementDocs,
        userId,
        vendorId,
        ip,
        ua,
        source,
        prisma,
      }))
    );
  }

  if (legacyKeys.length) {
    const result = await acceptPolicyDocuments({
      scope: normalizedScope,
      userId,
      vendorId,
      documentKeys: legacyKeys,
      ip,
      ua,
      source,
    });

    accepted.push(...result.accepted);
  }

  const after = await getGateState({ userId, role, vendorId, scope: normalizedScope, prisma });
  const remaining = after.documents.filter((doc) => doc.required && !doc.alreadyAccepted);

  // arhivăm notificările cererilor complet îndeplinite
  const satisfied = requirementDocs
    .filter((doc) => doc.campaignKey)
    .filter((doc) => !remaining.some((r) => r.key === doc.key))
    .map((doc) => doc.campaignKey);

  if (satisfied.length) {
    await archiveCampaignNotifications({
      campaignKeys: satisfied,
      scope: normalizedScope,
      userId,
      vendorId,
      prisma,
    });
  }

  let notificationArchived = satisfied.length > 0;

  // notificarea legacy se arhivează doar când nu mai lipsește nimic din ea
  if (legacyKeys.length && !remaining.some((r) => r.legacy)) {
    const legacyNotifications = (
      await policyNotifications({ scope: normalizedScope, userId, vendorId, prisma })
    ).filter((n) => !hasRequirements(n));

    for (const notification of legacyNotifications) {
      await prisma.notification.updateMany({
        where: { id: notification.id, archived: false },
        data: { archived: true, readAt: new Date() },
      });
    }

    notificationArchived = true;
  }

  return {
    ok: true,
    accepted,
    remainingRequired: remaining.map((doc) => ({
      key: doc.key,
      document: doc.document,
      version: doc.version,
    })),
    gateClosed: remaining.length === 0,
    notificationArchived,
    requirementCount: requirementDocs.length,
  };
}
