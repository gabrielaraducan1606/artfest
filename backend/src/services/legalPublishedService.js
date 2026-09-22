// src/services/legalPublishedService.js
//
// Versiunea PUBLICATĂ a unui document juridic = rândul activ din
// UserPolicy / VendorPolicy. Ea determină:
//   - ce versiune afișează pagina publică și /api/legal;
//   - ce versiune acceptă înregistrările NOI (server-side);
// și NU obligă utilizatorii existenți să reaccepte (asta face doar o cerere
// explicită de reacceptare - services/reacceptanceService.js).
//
// Rezervă: dacă documentul nu are încă rând activ în DB, se folosește
// versiunea `current` din manifest (comportamentul de dinainte). Schimbarea
// manifestului NU blochează pe nimeni: gate-ul nu citește manifestul.

import { prisma as defaultPrisma } from "../db.js";
import {
  defaultPublicUrlForType,
  getLegalDefinition,
  loadLegalDoc,
  loadLegalDocByPolicyVersion,
} from "../lib/legal.js";
import {
  contractualEntries,
  findEntryByStorageAndKey,
  getCatalogEntry,
} from "./legalRegistry.js";

export function policyChecksumOf(doc) {
  return doc?.renderedChecksum || doc?.checksum || doc?.sourceChecksum || null;
}

export async function getActivePolicyRow(entry, prisma = defaultPrisma) {
  if (!entry?.storage) return null;

  const model = entry.storage === "USER" ? prisma.userPolicy : prisma.vendorPolicy;

  return model.findFirst({
    where: { document: entry.policyDocument, isActive: true },
    orderBy: { publishedAt: "desc" },
  });
}

/*
 * Toate rândurile de politică (istoric complet) pentru un rând de catalog.
 */
export async function listPolicyRows(entry, prisma = defaultPrisma) {
  if (!entry?.storage) return [];

  const model = entry.storage === "USER" ? prisma.userPolicy : prisma.vendorPolicy;

  return model.findMany({
    where: { document: entry.policyDocument },
    orderBy: { publishedAt: "desc" },
  });
}

/*
 * { version, checksum, title, url, publishedAt, isRequired, source }
 * source = "policy" (rând activ în DB) sau "manifest" (rezervă).
 */
export async function getPublishedInfo(catalogId, prisma = defaultPrisma) {
  const entry = getCatalogEntry(catalogId);

  if (!entry || !entry.contractual) return null;

  const row = await getActivePolicyRow(entry, prisma);

  if (row) {
    return {
      version: row.version,
      checksum: row.checksum || null,
      title: row.title,
      url: row.url,
      publishedAt: row.publishedAt,
      isRequired: row.isRequired,
      source: "policy",
    };
  }

  try {
    const doc = loadLegalDoc(entry.manifestType);

    return {
      version: doc.policyVersion,
      checksum: policyChecksumOf(doc),
      title: doc.title,
      url: doc.publicUrl || defaultPublicUrlForType(entry.manifestType),
      publishedAt: null,
      isRequired: getLegalDefinition(entry.manifestType).required === true,
      source: "manifest",
    };
  } catch {
    return null;
  }
}

/*
 * Pentru fluxurile de înregistrare: versiunea + checksum-ul pe care le
 * acceptă un cont nou pentru un document stocat per utilizator, alese de
 * SERVER (nu de client). Întoarce null dacă nu se poate determina (apelantul
 * păstrează atunci comportamentul anterior).
 */
export async function getPublishedForUserDocument(
  policyDocument,
  prisma = defaultPrisma
) {
  const entry = findEntryByStorageAndKey(
    "USER",
    policyDocument === "PRIVACY_ACK" ? "PRIVACY" : policyDocument
  );

  if (!entry) return null;

  return getPublishedInfo(entry.catalogId, prisma);
}

/*
 * Consimțământul unui cont NOU (înregistrare) pentru TOS / Privacy / Acord
 * influenceri: versiunea
 * și checksum-ul le decide SERVERUL (versiunea publicată), nu clientul.
 * Pentru orice alt document (ex. marketing) sau dacă nu se poate determina,
 * se păstrează valorile trimise de client (comportamentul anterior).
 */
export async function resolveRegistrationConsent(
  document,
  consent = {},
  prisma = defaultPrisma
) {
  const fallback = {
    version: consent?.version || "1.0.0",
    checksum: consent?.checksum || null,
  };

  if (!["TOS", "PRIVACY_ACK", "INFLUENCER_TERMS"].includes(document)) return fallback;

  try {
    const info = await getPublishedForUserDocument(document, prisma);

    if (info?.version) {
      return {
        version: String(info.version),
        checksum: info.checksum || fallback.checksum,
      };
    }
  } catch (error) {
    console.error("[legal] registration consent version lookup failed:", error?.message);
  }

  return fallback;
}

/*
 * Documentul (randat) publicat pentru un tip din manifest - folosit de
 * /api/legal și de paginile publice. Pentru returns_policy_ack (BOTH) pagina
 * publică e cea adresată clienților (rândul USER).
 */
export async function loadPublishedLegalDoc(manifestType, prisma = defaultPrisma) {
  const entry =
    contractualEntries().find((e) => e.manifestType === manifestType) || null;

  if (!entry) return loadLegalDoc(manifestType);

  // paginile publice nu trebuie să cadă dacă DB nu răspunde: rezerva e manifestul
  try {
    const row = await getActivePolicyRow(entry, prisma);

    if (row) {
      const doc = loadLegalDocByPolicyVersion(manifestType, row.version);

      if (doc) return doc;
    }
  } catch (error) {
    console.error("[legal] published version lookup failed:", error?.message);
  }

  return loadLegalDoc(manifestType);
}
