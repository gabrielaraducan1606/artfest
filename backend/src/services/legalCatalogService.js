// src/services/legalCatalogService.js
//
// Catalogul unitar al documentelor juridice pentru Admin -> Politici /
// consimțăminte. Doar citire. Un rând per (document, audience):
//   TOS x3 (USER, VENDOR, INFLUENCER), Privacy x3, Returns x2 (USER,
//   VENDOR - independente), Vendor Terms, Shipping, Products Addendum,
//   Influencer Terms; plus Cookies ca rând INFORMATIV (fără publicare /
//   reacceptare contractuală).
//
// Statusuri:
//   NOT_PUBLISHED            fără rând activ în DB (se folosește rezerva din
//                            manifest);
//   UP_TO_DATE               publicat, fără cerere deschisă, fără draft;
//   DRAFT_AVAILABLE          există în manifest o versiune nepublicată;
//   REACCEPTANCE_REQUESTED   cerere deschisă;
//   REACCEPTANCE_OVERDUE     cerere deschisă cu termen depășit;
//   INFORMATIONAL            Cookies (CookieConsent).

import { prisma as defaultPrisma } from "../db.js";
import {
  getLegalDefinition,
  listLegalDocumentFiles,
  listManifestVersions,
  loadLegalDoc,
} from "../lib/legal.js";
import { LEGAL_DOCUMENTS } from "./legalRegistry.js";
import { getPublishedInfo, listPolicyRows } from "./legalPublishedService.js";
import {
  latestRequirementsFromCampaigns,
  loadRequestCampaigns,
} from "./reacceptanceService.js";
import {
  cookieConsentStats,
  countAccepted,
  countTargets,
} from "./legalStatsService.js";

function readManifestVersions(type) {
  let versions = [];

  try {
    versions = listManifestVersions(type);
  } catch {
    return { versions: [], definition: null };
  }

  const list = versions.map((manifestVersion) => {
    try {
      const doc = loadLegalDoc(type, { version: manifestVersion });

      return {
        manifestVersion,
        policyVersion: String(doc.policyVersion),
        title: doc.title,
        validFrom: doc.valid_from || null,
        loadable: true,
      };
    } catch (error) {
      return {
        manifestVersion,
        policyVersion: null,
        title: null,
        validFrom: null,
        loadable: false,
        error: error?.message || "load_failed",
      };
    }
  });

  let definition = null;

  try {
    definition = getLegalDefinition(type);
  } catch {
    definition = null;
  }

  return { versions: list, definition };
}

function computeStatus({ published, requirement, drafts, now }) {
  if (requirement) {
    if (requirement.deadlineAt && new Date(requirement.deadlineAt) < now) {
      return "REACCEPTANCE_OVERDUE";
    }

    return "REACCEPTANCE_REQUESTED";
  }

  if (!published || published.source !== "policy") return "NOT_PUBLISHED";

  if (drafts.length) return "DRAFT_AVAILABLE";

  return "UP_TO_DATE";
}

async function cookiesRow(entry, prisma) {
  const { versions, definition } = readManifestVersions(entry.manifestType);
  const current = definition ? versions.find((v) => v.manifestVersion === definition.current) : null;

  return {
    rowId: entry.catalogId,
    catalogId: entry.catalogId,
    key: entry.key,
    label: entry.label,
    audience: null,
    audiences: [],
    storage: null,
    contractual: false,
    informational: true,
    required: definition ? definition.required === true : false,
    published: current
      ? { version: current.policyVersion, source: "manifest", publishedAt: null }
      : null,
    manifestVersions: versions,
    draftVersions: [],
    unregisteredFiles: [],
    stats: await cookieConsentStats({ prisma }),
    status: "INFORMATIONAL",
    note:
      "Consimțământul pentru cookies se gestionează exclusiv prin CookieConsent + consentVersion. Nu se publică prin acest mecanism și nu se cere reacceptare contractuală.",
    actions: { canPublish: false, canRequestReacceptance: false },
  };
}

export async function buildLegalCatalog({ prisma = defaultPrisma, now = new Date() } = {}) {
  const campaigns = await loadRequestCampaigns({ prisma });
  const latestRequirements = latestRequirementsFromCampaigns(campaigns);
  const rows = [];

  for (const entry of LEGAL_DOCUMENTS) {
    if (entry.informational) {
      rows.push(await cookiesRow(entry, prisma));
      continue;
    }

    const { versions, definition } = readManifestVersions(entry.manifestType);
    const published = await getPublishedInfo(entry.catalogId, prisma);
    const policyRows = await listPolicyRows(entry, prisma);
    const activeRow = policyRows.find((row) => row.isActive) || null;

    let files = [];
    try {
      files = listLegalDocumentFiles(entry.manifestType);
    } catch {
      files = [];
    }

    const registeredNumbers = versions.map((v) => v.manifestVersion);
    const unregisteredFiles = files.filter((n) => !registeredNumbers.includes(n));

    const publishedManifest = published
      ? versions.find((v) => v.policyVersion === String(published.version))
      : null;

    const drafts = versions.filter(
      (v) =>
        v.loadable &&
        (!published || v.policyVersion !== String(published.version)) &&
        (!publishedManifest || v.manifestVersion > publishedManifest.manifestVersion)
    );

    for (const audience of entry.audiences) {
      const requirementId = `${entry.key}|${audience}`;
      const lastRequest =
        latestRequirements.find((r) => r.id === requirementId) || null;
      const requirement = lastRequest && lastRequest.requiresAction ? lastRequest : null;

      const targets = await countTargets({ entry, audience, prisma });
      const acceptedOnPublished = published
        ? await countAccepted({ entry, audience, version: published.version, prisma })
        : 0;

      let requirementStats = null;

      if (requirement) {
        const acceptedOnRequired = await countAccepted({
          entry,
          audience,
          version: requirement.version,
          prisma,
        });

        requirementStats = {
          accepted: acceptedOnRequired,
          pending: Math.max(0, targets - acceptedOnRequired),
        };
      }

      const status = computeStatus({ published, requirement, drafts, now });

      rows.push({
        rowId: `${entry.catalogId}#${audience}`,
        catalogId: entry.catalogId,
        key: entry.key,
        label: entry.label,
        audience,
        audiences: entry.audiences,
        storage: entry.storage,
        contractual: true,
        informational: false,
        required: activeRow ? activeRow.isRequired : definition ? definition.required === true : false,
        published: published
          ? {
              version: published.version,
              source: published.source,
              publishedAt: published.publishedAt,
              title: published.title,
              url: published.url,
            }
          : null,
        lastPublishedAt: activeRow?.publishedAt || null,
        manifestVersions: versions.map((v) => ({
          ...v,
          isPublished: published ? v.policyVersion === String(published.version) : false,
        })),
        draftVersions: drafts,
        unregisteredFiles,
        sharedPublication: entry.audiences.length > 1,
        stats: {
          targets,
          acceptedOnPublished,
          notOnPublished: Math.max(0, targets - acceptedOnPublished),
        },
        // coloanele cerute de tabel
        targetCount: targets,
        acceptedCount: requirementStats ? requirementStats.accepted : acceptedOnPublished,
        mustReacceptCount: requirementStats ? requirementStats.pending : 0,
        requirement: requirement
          ? {
              version: requirement.version,
              campaignId: requirement.campaignId,
              campaignKey: requirement.campaignKey,
              requestedAt: requirement.createdAt,
              deadlineAt: requirement.deadlineAt,
              ...requirementStats,
            }
          : null,
        lastRequestAt: lastRequest?.createdAt || null,
        status,
        actions: {
          canPublish: drafts.length > 0 || !activeRow,
          canRequestReacceptance: Boolean(activeRow),
        },
      });
    }
  }

  return {
    generatedAt: now,
    rows,
    statuses: [
      "NOT_PUBLISHED",
      "UP_TO_DATE",
      "DRAFT_AVAILABLE",
      "REACCEPTANCE_REQUESTED",
      "REACCEPTANCE_OVERDUE",
      "INFORMATIONAL",
    ],
  };
}
