// src/services/legalPublishService.js
//
// "PUBLICĂ VERSIUNEA": face o versiune din manifest ACTIVĂ în
// UserPolicy/VendorPolicy. Efecte, exact:
//   - versiunea devine cea afișată de pagina publică și de /api/legal;
//   - o folosesc înregistrările NOI (server-side);
//   - versiunile anterioare rămân în tabel, doar isActive=false (istoric);
//   - se scrie un eveniment de audit (PolicyGateCampaign "pub_...").
// NU creează notificări, NU trimite emailuri și NU obligă niciun utilizator
// existent să reaccepte - asta face exclusiv "Cere reacceptarea"
// (services/reacceptanceService.js).
//
// Publicarea afectează DOAR tabelul stocării rândului de catalog:
// RETURNS_POLICY_ACK@USER scrie doar UserPolicy, RETURNS_POLICY_ACK@VENDOR
// doar VendorPolicy. TOS/Privacy/Influencer Terms au un singur rând
// (UserPolicy) comun audiențelor lor.
//
// Versiunea trebuie să existe în manifest (catalog). Manifestul NU se
// modifică din Admin.

import { prisma as defaultPrisma } from "../db.js";
import {
  defaultPublicUrlForType,
  getLegalDefinition,
  loadLegalDocByPolicyVersion,
} from "../lib/legal.js";
import { getCatalogEntry } from "./legalRegistry.js";
import { policyChecksumOf } from "./legalPublishedService.js";
import { recordPublishEvent } from "./reacceptanceService.js";

function fail(status, code, message) {
  const error = new Error(message || code);
  error.status = status;
  error.code = code;
  return error;
}

export async function publishLegalDocumentVersion({
  catalogId,
  version,
  actorId = null,
  prisma = defaultPrisma,
  now = new Date(),
}) {
  const entry = getCatalogEntry(catalogId);

  if (!entry || !entry.contractual) {
    throw fail(400, "document_not_publishable", "Documentul nu poate fi publicat din Admin.");
  }

  const wantedVersion = String(version || "").trim();

  if (!wantedVersion) {
    throw fail(400, "version_required", "Selectează versiunea de publicat.");
  }

  const doc = loadLegalDocByPolicyVersion(entry.manifestType, wantedVersion);

  if (!doc) {
    throw fail(
      404,
      "version_not_in_manifest",
      "Versiunea nu există în manifest (catalog). Doar versiunile înregistrate în manifest pot fi publicate."
    );
  }

  const definition = getLegalDefinition(entry.manifestType);
  const title = String(doc.title || definition.title || entry.label).trim();
  const url = doc.publicUrl || defaultPublicUrlForType(entry.manifestType) || "#";
  const checksum = policyChecksumOf(doc);
  const isRequired = definition.required === true;

  return prisma.$transaction(async (tx) => {
    const model = entry.storage === "USER" ? tx.userPolicy : tx.vendorPolicy;

    const previousActive = await model.findFirst({
      where: { document: entry.policyDocument, isActive: true },
      orderBy: { publishedAt: "desc" },
    });

    const existing = await model.findUnique({
      where: {
        document_version: { document: entry.policyDocument, version: wantedVersion },
      },
    });

    await model.updateMany({
      where: {
        document: entry.policyDocument,
        version: { not: wantedVersion },
        isActive: true,
      },
      data: { isActive: false },
    });

    let policy;

    if (existing) {
      policy = await model.update({
        where: { id: existing.id },
        data: {
          title,
          url,
          checksum,
          isRequired,
          isActive: true,
          // data primei publicări nu se suprascrie dacă versiunea era deja activă
          ...(existing.isActive ? {} : { publishedAt: now }),
        },
      });
    } else {
      policy = await model.create({
        data: {
          document: entry.policyDocument,
          version: wantedVersion,
          title,
          url,
          checksum,
          isRequired,
          isActive: true,
          publishedAt: now,
        },
      });
    }

    const event = await recordPublishEvent({
      db: tx,
      entry,
      version: wantedVersion,
      previousVersion:
        previousActive && previousActive.version !== wantedVersion
          ? previousActive.version
          : null,
      actorId,
    });

    return {
      ok: true,
      catalogId: entry.catalogId,
      storage: entry.storage,
      version: policy.version,
      publishedAt: policy.publishedAt,
      previousVersion:
        previousActive && previousActive.version !== wantedVersion
          ? previousActive.version
          : null,
      eventId: event.id,
      // explicit: publicarea nu cere reacceptare de la nimeni
      reacceptanceRequested: false,
    };
  });
}
