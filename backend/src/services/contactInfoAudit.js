// backend/src/services/contactInfoAudit.js

/*
 * Conținut EXISTENT cu date de contact externe (descrieri de magazin /
 * texte de produs salvate înainte de contact info guard).
 *
 * - NU șterge și NU modifică nimic automat;
 * - scanVendorContactIssues: lista LIVE de probleme a unui vendor
 *   (folosită de Asistent ca să le parcurgă pe rând);
 * - auditContactInfo: parcurge toți vendorii și creează O SINGURĂ
 *   notificare agregată per vendor (nu câte una per produs). Cheia de
 *   deduplicare depinde de setul de probleme, deci rularea repetată nu
 *   re-notifică pentru aceleași probleme.
 *
 * Regulile de detecție sunt EXCLUSIV cele din lib/contactInfoGuard.js.
 */

import crypto from "node:crypto";

import { prisma as defaultPrisma } from "../db.js";
import { createVendorNotification as defaultNotify } from "./notifications.js";
import {
  GUARDED_FIELDS,
  checkPublicFields,
} from "../lib/contactInfoGuard.js";

// orice pagină de vendor funcționează (asistentul e global, în
// FloatingHub); /vendor/catalog nu face redirect, deci păstrează ?assistant
export const CONTACT_FIX_ASSISTANT_LINK = "/vendor/catalog?assistant=contact-info";

const PRODUCT_SELECT = {
  id: true,
  title: true,
  serviceId: true,
  service: { select: { vendorId: true } },
  ...Object.fromEntries(GUARDED_FIELDS.PRODUCT.map((f) => [f, true])),
};

const PROFILE_SELECT = {
  serviceId: true,
  displayName: true,
  slug: true,
  service: { select: { vendorId: true } },
  ...Object.fromEntries(GUARDED_FIELDS.STORE.map((f) => [f, true])),
};

function pickFields(record, fields) {
  return Object.fromEntries(fields.map((f) => [f, record?.[f]]));
}

export function productIssues(product) {
  return checkPublicFields({
    entityType: "PRODUCT",
    entityId: product.id,
    fields: pickFields(product, GUARDED_FIELDS.PRODUCT),
  }).map((issue) => ({
    ...issue,
    entityName: product.title || "Produs fără titlu",
    source: "STORED",
  }));
}

export function profileIssues(profile) {
  return checkPublicFields({
    entityType: "STORE",
    entityId: profile.serviceId,
    fields: pickFields(profile, GUARDED_FIELDS.STORE),
  }).map((issue) => ({
    ...issue,
    entityName: profile.displayName || "Magazinul tău",
    source: "STORED",
  }));
}

/*
 * Problemele LIVE ale unui vendor (magazine + produse ale lui). Datele
 * vin din DB la momentul cererii - dacă vendorul a corectat deja ceva,
 * nu mai apare.
 */
export async function scanVendorContactIssues({ vendorId, db = defaultPrisma }) {
  if (!vendorId) return [];

  const [profiles, products] = await Promise.all([
    db.serviceProfile.findMany({
      where: { service: { vendorId } },
      select: PROFILE_SELECT,
    }),
    db.product.findMany({
      where: { service: { vendorId } },
      select: PRODUCT_SELECT,
      take: 2000,
    }),
  ]);

  return [
    ...profiles.flatMap(profileIssues),
    ...products.flatMap(productIssues),
  ];
}

export function countAffectedEntities(issues) {
  return new Set(issues.map((i) => `${i.entityType}:${i.entityId}`)).size;
}

export function buildAggregatedNotification(vendorId, issues) {
  const affected = countAffectedEntities(issues);

  const keys = [...new Set(issues.map((i) => `${i.entityType}:${i.entityId}:${i.field}`))].sort();

  const hash = crypto.createHash("sha1").update(keys.join("|")).digest("hex").slice(0, 16);

  return {
    dedupeKey: `contact_info_fix:${vendorId}:${hash}`,
    type: "system",
    title: "Date de contact externe în listări",
    body:
      affected === 1
        ? "Am găsit date de contact externe într-o listare sau în profilul magazinului. Te rugăm să le actualizezi pentru a respecta regulile Artfest."
        : `Am găsit date de contact externe în ${affected} listări/profiluri. Te rugăm să le actualizezi pentru a respecta regulile Artfest.`,
    link: CONTACT_FIX_ASSISTANT_LINK,
    meta: {
      kind: "contact_info_fix",
      cta: "Corectează cu ajutorul asistentului",
      affected,
      vendorId,
    },
  };
}

/*
 * Audit pentru TOȚI vendorii. apply=false (implicit) = doar raport,
 * nicio notificare. Nimic nu se modifică în produse/profiluri.
 */
export async function auditContactInfo({
  apply = false,
  db = defaultPrisma,
  notify = defaultNotify,
  pageSize = 500,
} = {}) {
  const byVendor = new Map();

  const add = (vendorId, issues) => {
    if (!vendorId || !issues.length) return;
    byVendor.set(vendorId, [...(byVendor.get(vendorId) || []), ...issues]);
  };

  const profiles = await db.serviceProfile.findMany({ select: PROFILE_SELECT });
  for (const p of profiles) add(p.service?.vendorId, profileIssues(p));

  let cursor = null;

  for (;;) {
    const page = await db.product.findMany({
      select: PRODUCT_SELECT,
      orderBy: { id: "asc" },
      take: pageSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    for (const product of page) add(product.service?.vendorId, productIssues(product));

    if (page.length < pageSize) break;
    cursor = page[page.length - 1].id;
  }

  const report = [];

  for (const [vendorId, issues] of byVendor) {
    const notification = buildAggregatedNotification(vendorId, issues);

    let notified = false;
    if (apply) {
      notified = Boolean(await notify(vendorId, notification));
    }

    report.push({
      vendorId,
      affected: countAffectedEntities(issues),
      issues: issues.length,
      notified,
    });
  }

  return {
    vendors: report.length,
    affectedEntities: report.reduce((sum, r) => sum + r.affected, 0),
    notificationsCreated: report.filter((r) => r.notified).length,
    applied: apply,
    report,
  };
}
