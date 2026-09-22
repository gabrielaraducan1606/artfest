// src/services/legalStatsService.js
//
// Numărători pentru tabelul Admin -> Politici / consimțăminte. Doar
// interogări (nicio scriere), pe tabelele existente:
//   UserConsent / VendorAcceptance / User / Vendor / CookieConsent.
//
// Definiții:
//   vizați   = conturi active ale audienței (rol USER/VENDOR/INFLUENCER;
//              pentru documente stocate per vendor: vendorii cu utilizator
//              activ);
//   acceptat = vizați care au acceptare pentru EXACT versiunea cerută
//              (dacă există cerere deschisă) sau pentru cea publicată.

import { prisma as defaultPrisma } from "../db.js";
import { AUDIENCE_ROLES } from "./legalRegistry.js";

const ACTIVE = "ACTIVE";

function rolesFor(audience) {
  return AUDIENCE_ROLES[audience] || [];
}

function userWhere(audience) {
  return { role: { in: rolesFor(audience) }, status: ACTIVE };
}

const vendorUserWhere = { user: { is: { status: ACTIVE } } };

export async function countTargets({ entry, audience, prisma = defaultPrisma }) {
  if (entry.storage === "USER") {
    return prisma.user.count({ where: userWhere(audience) });
  }

  if (entry.storage === "VENDOR") {
    return prisma.vendor.count({ where: vendorUserWhere });
  }

  return 0;
}

export async function countAccepted({
  entry,
  audience,
  version,
  prisma = defaultPrisma,
}) {
  if (!version) return 0;

  if (entry.storage === "USER") {
    return prisma.userConsent.count({
      where: {
        document: entry.policyDocument,
        version: String(version),
        user: { is: userWhere(audience) },
      },
    });
  }

  if (entry.storage === "VENDOR") {
    return prisma.vendorAcceptance.count({
      where: {
        document: entry.policyDocument,
        version: String(version),
        vendor: { is: vendorUserWhere },
      },
    });
  }

  return 0;
}

/*
 * Distribuția acceptărilor pe versiuni (istoric agregat) pentru un document
 * și o audience.
 */
export async function acceptancesByVersion({
  entry,
  audience,
  prisma = defaultPrisma,
}) {
  if (entry.storage === "USER") {
    const rows = await prisma.userConsent.groupBy({
      by: ["version"],
      where: {
        document: entry.policyDocument,
        user: { is: { role: { in: rolesFor(audience) } } },
      },
      _count: { _all: true },
    });

    return rows
      .map((row) => ({ version: row.version, count: row._count._all }))
      .sort((a, b) => String(b.version).localeCompare(String(a.version)));
  }

  if (entry.storage === "VENDOR") {
    const rows = await prisma.vendorAcceptance.groupBy({
      by: ["version"],
      where: { document: entry.policyDocument },
      _count: { _all: true },
    });

    return rows
      .map((row) => ({ version: row.version, count: row._count._all }))
      .sort((a, b) => String(b.version).localeCompare(String(a.version)));
  }

  return [];
}

/*
 * Lista individuală (pentru sertarul de istoric): cine a acceptat / cine
 * trebuie să accepte o anumită versiune.
 */
export async function listAcceptances({
  entry,
  audience,
  version,
  status = "all", // all | accepted | pending
  page = 1,
  pageSize = 25,
  prisma = defaultPrisma,
}) {
  const take = Math.min(100, Math.max(1, Number(pageSize) || 25));
  const skip = (Math.max(1, Number(page) || 1) - 1) * take;
  const wantedVersion = String(version || "");

  if (entry.storage === "USER") {
    const acceptedFilter = {
      UserConsent: { some: { document: entry.policyDocument, version: wantedVersion } },
    };
    const pendingFilter = {
      UserConsent: { none: { document: entry.policyDocument, version: wantedVersion } },
    };

    const where = {
      ...userWhere(audience),
      ...(status === "accepted" ? acceptedFilter : {}),
      ...(status === "pending" ? pendingFilter : {}),
    };

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { email: "asc" },
        skip,
        take,
        select: {
          id: true,
          email: true,
          role: true,
          UserConsent: {
            where: { document: entry.policyDocument, version: wantedVersion },
            select: { givenAt: true, ip: true, checksum: true },
            take: 1,
          },
        },
      }),
    ]);

    return {
      total,
      page: Math.max(1, Number(page) || 1),
      pageSize: take,
      items: users.map((u) => ({
        userId: u.id,
        vendorId: null,
        email: u.email,
        role: u.role,
        accepted: (u.UserConsent || []).length > 0,
        acceptedAt: u.UserConsent?.[0]?.givenAt || null,
        ip: u.UserConsent?.[0]?.ip || null,
        checksum: u.UserConsent?.[0]?.checksum || null,
      })),
    };
  }

  if (entry.storage === "VENDOR") {
    const acceptedFilter = {
      VendorAcceptance: { some: { document: entry.policyDocument, version: wantedVersion } },
    };
    const pendingFilter = {
      VendorAcceptance: { none: { document: entry.policyDocument, version: wantedVersion } },
    };

    const where = {
      ...vendorUserWhere,
      ...(status === "accepted" ? acceptedFilter : {}),
      ...(status === "pending" ? pendingFilter : {}),
    };

    const [total, vendors] = await Promise.all([
      prisma.vendor.count({ where }),
      prisma.vendor.findMany({
        where,
        orderBy: { displayName: "asc" },
        skip,
        take,
        select: {
          id: true,
          displayName: true,
          email: true,
          user: { select: { id: true, email: true } },
          VendorAcceptance: {
            where: { document: entry.policyDocument, version: wantedVersion },
            select: { acceptedAt: true, ip: true, checksum: true },
            take: 1,
          },
        },
      }),
    ]);

    return {
      total,
      page: Math.max(1, Number(page) || 1),
      pageSize: take,
      items: vendors.map((v) => ({
        userId: v.user?.id || null,
        vendorId: v.id,
        email: v.email || v.user?.email || null,
        name: v.displayName,
        role: "VENDOR",
        accepted: (v.VendorAcceptance || []).length > 0,
        acceptedAt: v.VendorAcceptance?.[0]?.acceptedAt || null,
        ip: v.VendorAcceptance?.[0]?.ip || null,
        checksum: v.VendorAcceptance?.[0]?.checksum || null,
      })),
    };
  }

  return { total: 0, page: 1, pageSize: take, items: [] };
}

/*
 * Cookies: informativ, din CookieConsent (NU se cere reacceptare
 * contractuală). Numără EVENIMENTELE de consimțământ înregistrate pe
 * versiune (nu persoane unice) și ultimul eveniment.
 */
export async function cookieConsentStats({ prisma = defaultPrisma } = {}) {
  const [byVersion, latest, total] = await Promise.all([
    prisma.cookieConsent.groupBy({
      by: ["consentVersion"],
      _count: { _all: true },
    }),
    prisma.cookieConsent.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, consentVersion: true },
    }),
    prisma.cookieConsent.count(),
  ]);

  return {
    totalEvents: total,
    lastEventAt: latest?.createdAt || null,
    lastConsentVersion: latest?.consentVersion || null,
    eventsByConsentVersion: byVersion
      .map((row) => ({
        consentVersion: row.consentVersion,
        events: row._count._all,
      }))
      .sort((a, b) => String(b.consentVersion).localeCompare(String(a.consentVersion))),
  };
}
