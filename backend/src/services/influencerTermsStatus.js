// backend/src/services/influencerTermsStatus.js

/*
 * Status de acceptare a Acordului Programului de Influenceri
 * (influencer_terms) pentru un utilizator - sursă UNICĂ, reutilizată
 * de:
 * - GET /api/influencer/me (câmpul `terms`, aditiv);
 * - enforceInfluencerTermsGate (middleware de blocare pe rutele
 *   comerciale);
 * - POST /api/influencer/terms/accept (acceptarea + răspunsul);
 * - rutele admin (adminInfluencerTermsRoutes).
 *
 * REGULA (mecanismul unitar de reacceptare):
 *   O schimbare în manifest sau o publicare de versiune NU blochează
 *   influencerii. Doar o CERERE deschisă de reacceptare
 *   (Admin -> "Cere reacceptarea", document INFLUENCER_TERMS, audience
 *   INFLUENCER) face un influencer "outdated":
 *
 *   - cerere deschisă: outdated dacă influencerul NU a acceptat EXACT
 *     versiunea cerută;
 *   - fără cerere: outdated doar dacă nu a acceptat NICIODATĂ nicio
 *     versiune (cont fără acord); o versiune mai veche acceptată rămâne
 *     validă până la o cerere explicită.
 *
 *   `blocking` = outdated ȘI (fără termen-limită sau termenul a trecut).
 *   Înainte de termen, influencerul vede cererea (modal) dar nu e blocat.
 *
 * Nu recalculează nimic financiar.
 */

import { prisma as defaultPrisma } from "../db.js";
import { loadLegalDocByPolicyVersion } from "../lib/legal.js";
import { getOpenRequirement } from "./reacceptanceService.js";
import { getPublishedInfo } from "./legalPublishedService.js";

export const INFLUENCER_TERMS_LEGAL_TYPE = "influencer_terms";
export const INFLUENCER_TERMS_CONSENT_DOCUMENT = "INFLUENCER_TERMS";
export const INFLUENCER_TERMS_CATALOG_ID = "INFLUENCER_TERMS";
export const INFLUENCER_AUDIENCE = "INFLUENCER";

/**
 * Predicat PUR (păstrat pentru compatibilitate): o versiune acceptată
 * diferă de cea comparată. `null`/`undefined` (nicio acceptare) e mereu
 * "outdated".
 */
export function isInfluencerTermsOutdated(acceptedVersion, currentVersion) {
  return acceptedVersion !== currentVersion;
}

/**
 * Versiunea PUBLICATĂ (rând activ în UserPolicy sau, în lipsă, manifest)
 * + cererea deschisă, dacă există.
 */
export async function getInfluencerTermsTarget(prisma = defaultPrisma) {
  const [published, requirement] = await Promise.all([
    getPublishedInfo(INFLUENCER_TERMS_CATALOG_ID, prisma),
    getOpenRequirement({
      key: INFLUENCER_TERMS_CONSENT_DOCUMENT,
      audience: INFLUENCER_AUDIENCE,
      prisma,
    }),
  ]);

  return { published, requirement };
}

/**
 * Logica pură a statusului, folosită de status individual și de admin.
 *
 * @param {{
 *   published: {version: string}|null,
 *   requirement: {version: string, deadlineAt: Date|string|null}|null,
 *   consentVersions: string[],   // toate versiunile acceptate
 *   now?: Date,
 * }} input
 */
export function computeInfluencerTermsState({
  published,
  requirement,
  consentVersions,
  now = new Date(),
}) {
  const accepted = new Set(consentVersions || []);
  const publishedVersion = published ? String(published.version) : null;

  let outdated = false;
  let reason = null;
  let targetVersion = publishedVersion;

  if (requirement) {
    targetVersion = requirement.version;
    outdated = !accepted.has(requirement.version);
    reason = outdated ? "REACCEPTANCE_REQUESTED" : null;
  } else if (accepted.size === 0) {
    outdated = true;
    reason = "NEVER_ACCEPTED";
  }

  const deadline = requirement?.deadlineAt ? new Date(requirement.deadlineAt) : null;
  const deadlinePassed = !deadline || deadline <= now;

  return {
    targetVersion,
    publishedVersion,
    outdated,
    blocking: outdated && deadlinePassed,
    reason,
    deadlineAt: deadline,
    acceptedPublished: publishedVersion ? accepted.has(publishedVersion) : false,
  };
}

/**
 * @param {string} userId
 * @returns {Promise<{
 *   currentVersion: string|null,   // versiunea de acceptat / cea publicată
 *   publishedVersion: string|null,
 *   requiredVersion: string|null,  // doar dacă există cerere deschisă
 *   acceptedVersion: string|null,
 *   outdated: boolean,
 *   blocking: boolean,
 *   reason: string|null,
 *   deadlineAt: Date|null,
 *   documentUrl: string|null,
 * }>}
 */
export async function getInfluencerTermsStatus(userId, { prisma = defaultPrisma, now } = {}) {
  const { published, requirement } = await getInfluencerTermsTarget(prisma);

  const consents = userId
    ? await prisma.userConsent.findMany({
        where: { userId, document: INFLUENCER_TERMS_CONSENT_DOCUMENT },
        select: { version: true, givenAt: true },
        orderBy: { givenAt: "desc" },
      })
    : [];

  const state = computeInfluencerTermsState({
    published,
    requirement,
    consentVersions: consents.map((c) => c.version),
    now,
  });

  /*
   * Verificare pe versiunea ȚINTĂ (cerută / publicată), nu pe "ultima
   * acceptare din timp": istoricul altor versiuni nu influențează statusul
   * curent (vezi audit 2026-09-11).
   */
  const acceptedVersion =
    consents.find((c) => c.version === state.targetVersion)?.version ||
    consents[0]?.version ||
    null;

  return {
    currentVersion: state.targetVersion,
    publishedVersion: state.publishedVersion,
    requiredVersion: requirement ? requirement.version : null,
    acceptedVersion,
    outdated: state.outdated,
    blocking: state.blocking,
    reason: state.reason,
    deadlineAt: state.deadlineAt,
    documentUrl: published?.url || null,
  };
}

/**
 * Acceptă versiunea ȚINTĂ: cea din cererea deschisă (dacă există), altfel
 * cea publicată. Versiunea NU vine de la client. Idempotent (upsert pe
 * userId+document+version); acceptările altor versiuni rămân în istoric.
 */
export async function acceptInfluencerTerms(
  userId,
  { ip = "", ua = "", prisma = defaultPrisma } = {}
) {
  const { published, requirement } = await getInfluencerTermsTarget(prisma);

  const version = requirement?.version || (published ? String(published.version) : null);

  if (!version) {
    const error = new Error("influencer_terms_not_available");
    error.status = 409;
    error.code = "influencer_terms_not_available";
    throw error;
  }

  const policyRow = await prisma.userPolicy.findUnique({
    where: {
      document_version: { document: INFLUENCER_TERMS_CONSENT_DOCUMENT, version },
    },
    select: { checksum: true },
  });

  const doc = loadLegalDocByPolicyVersion(INFLUENCER_TERMS_LEGAL_TYPE, version);

  const checksum =
    policyRow?.checksum || doc?.renderedChecksum || doc?.checksum || published?.checksum || null;

  await prisma.userConsent.upsert({
    where: {
      userId_document_version: {
        userId,
        document: INFLUENCER_TERMS_CONSENT_DOCUMENT,
        version,
      },
    },

    /*
     * Reaccept pe EXACT aceeași versiune: nu duplicăm (unique), dar
     * înregistrăm corect momentul reacceptării (givenAt/checksum/ip/ua).
     */
    update: { givenAt: new Date(), checksum, ip: ip || "", ua: ua || "" },

    create: {
      userId,
      document: INFLUENCER_TERMS_CONSENT_DOCUMENT,
      version,
      checksum,
      ip: ip || "",
      ua: ua || "",
    },
  });

  return { version, status: await getInfluencerTermsStatus(userId, { prisma }) };
}
