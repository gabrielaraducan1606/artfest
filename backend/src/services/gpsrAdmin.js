// backend/src/services/gpsrAdmin.js
//
// Evidența GPSR în Admin (doar citire): starea declarației per produs,
// sumarul vânzătorului, filtrele listei de produse. Nimic nu se scrie aici.
// Starea „Confirmare înregistrată” NU înseamnă „conform” / „certificat”:
// arată doar că vânzătorul a făcut declarația pentru datele curente.

import { VENDOR_GPSR_SELECT, buildGpsrIncompleteWhere } from "../lib/gpsrCompliance.js";
import {
  GPSR_DECLARATION_STATUS,
  GPSR_DECLARATION_STATUS_LABELS,
  evaluateGpsrDeclaration,
} from "../lib/gpsrDeclaration.js";
import { OPEN_REVIEW_REQUEST_WHERE, getReviewRequest, summarizeReviewRequest } from "./productReviewRequest.js";

export const GPSR_HELP_TICKET_SUBJECT = "Ajutor pentru adresa profesională GPSR";

export const ADMIN_GPSR_FILTERS = Object.freeze({
  incomplete: "GPSR incomplet",
  missing: "Confirmare lipsă / neînregistrată",
  reconfirm: "Reconfirmare necesară",
  confirmed: "Confirmare înregistrată",
  help: "Solicitare ajutor",
});

const PRODUCT_GPSR_SELECT = Object.freeze({
  id: true,
  title: true,
  createdAt: true,
  isActive: true,
  isHidden: true,
  moderationStatus: true,
  aiModeration: true,
  isOwnManufacturer: true,
  manufacturerName: true,
  manufacturerAddress: true,
  manufacturerEmail: true,
  manufacturerInEU: true,
  responsiblePersonName: true,
  responsiblePersonAddress: true,
  responsiblePersonEmail: true,
  safetyWarnings: true,
  isForChildren: true,
  service: { select: { vendorId: true } },
});

const DECLARATION_SELECT = Object.freeze({
  id: true,
  productId: true,
  vendorId: true,
  userId: true,
  kind: true,
  noticeVersion: true,
  textHash: true,
  manufacturerHash: true,
  safetyHash: true,
  source: true,
  createdAt: true,
});

async function usersById(db, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await db.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  return new Map(
    rows.map((u) => [u.id, { id: u.id, email: u.email || null, name: [u.firstName, u.lastName].filter(Boolean).join(" ") || null }])
  );
}

function shapeDeclaration(d, users) {
  return {
    id: d.id,
    kind: d.kind,
    noticeVersion: d.noticeVersion,
    textHash: d.textHash,
    source: d.source,
    createdAt: d.createdAt,
    confirmedBy: users.get(d.userId) || { id: d.userId, email: null, name: null },
  };
}

async function vendorGpsrTickets(db, vendor) {
  if (!vendor?.userId) return [];
  const rows = await db.supportTicket.findMany({
    where: { requesterId: vendor.userId, subject: GPSR_HELP_TICKET_SUBJECT, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, subject: true, status: true, createdAt: true, lastMessageAt: true },
  });
  return rows.map((t) => ({ ...t, link: `/admin/support?${new URLSearchParams({ ticket: t.id, q: t.subject }).toString()}` }));
}

/** Admin → Produse: zona „Conformitate GPSR” a unui produs. */
export async function getProductGpsrForAdmin(db, productId) {
  const product = await db.product.findUnique({ where: { id: String(productId) }, select: PRODUCT_GPSR_SELECT });
  if (!product) return null;
  const vendor = await db.vendor.findUnique({
    where: { id: product.service?.vendorId || "" },
    select: { id: true, userId: true, displayName: true, ...VENDOR_GPSR_SELECT },
  });
  const declarations = await db.productGpsrDeclaration.findMany({
    where: { productId: product.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: DECLARATION_SELECT,
  });
  const evaluation = evaluateGpsrDeclaration({ product, vendor, declarations });
  const users = await usersById(db, declarations.map((d) => d.userId));
  const reviewRequest = getReviewRequest(product);

  return {
    productId: product.id,
    status: evaluation.status,
    label: evaluation.label,
    complete: evaluation.complete,
    requiredForPublication: evaluation.required,
    reconfirmReasons: evaluation.reasonLabels,
    currentNoticeVersion: evaluation.currentNoticeVersion,
    latest: evaluation.latest ? shapeDeclaration(evaluation.latest, users) : null,
    history: evaluation.history.map((d) => shapeDeclaration(d, users)),
    helpRequest: reviewRequest ? summarizeReviewRequest(product) : null,
    vendorGpsrTickets: await vendorGpsrTickets(db, vendor),
    note: "Starea arată doar dacă vânzătorul a confirmat informațiile; nu este o certificare a conformității.",
  };
}

/** Admin → Vânzători: „Informări și confirmări GPSR”. */
export async function getVendorGpsrForAdmin(db, vendorId) {
  const vendor = await db.vendor.findUnique({
    where: { id: String(vendorId) },
    select: { id: true, userId: true, displayName: true, ...VENDOR_GPSR_SELECT },
  });
  if (!vendor) return null;

  const [products, declarations] = await Promise.all([
    db.product.findMany({ where: { service: { is: { vendorId: vendor.id } } }, select: PRODUCT_GPSR_SELECT, take: 1000 }),
    db.productGpsrDeclaration.findMany({
      where: { vendorId: vendor.id },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: DECLARATION_SELECT,
    }),
  ]);

  const byProduct = new Map();
  for (const d of declarations) {
    if (!byProduct.has(d.productId)) byProduct.set(d.productId, []);
    byProduct.get(d.productId).push(d);
  }

  const counts = Object.fromEntries(Object.keys(GPSR_DECLARATION_STATUS).map((k) => [k, 0]));
  const attention = [];
  for (const product of products) {
    const e = evaluateGpsrDeclaration({ product, vendor, declarations: byProduct.get(product.id) || [] });
    counts[e.status] += 1;
    if (e.status !== GPSR_DECLARATION_STATUS.VALID) {
      attention.push({
        productId: product.id,
        title: product.title,
        status: e.status,
        label: e.label,
        reasons: e.reasonLabels,
        link: `/admin?tab=products&productId=${encodeURIComponent(product.id)}`,
      });
    }
  }

  const titles = new Map(products.map((p) => [p.id, p.title]));
  const users = await usersById(db, declarations.map((d) => d.userId));
  const latest = declarations[0] || null;

  return {
    vendorId: vendor.id,
    latestNoticeVersion: latest?.noticeVersion || null,
    latestConfirmedAt: latest?.createdAt || null,
    productsWithDeclaration: byProduct.size,
    counts,
    labels: GPSR_DECLARATION_STATUS_LABELS,
    attention: attention.slice(0, 200),
    history: declarations.slice(0, 100).map((d) => ({ ...shapeDeclaration(d, users), productId: d.productId, productTitle: titles.get(d.productId) || null })),
    gpsrTickets: await vendorGpsrTickets(db, vendor),
  };
}

/*
 * Filtrul listei Admin → Produse. Întoarce o condiție Prisma (sau null).
 * „confirmed” / „reconfirm” cer evaluarea amprentelor: se calculează pe
 * produsele care au cel puțin o declarație (mulțime mărginită).
 */
export async function adminGpsrFilterWhere(db, filter) {
  const key = String(filter || "").trim().toLowerCase();
  if (!key || !ADMIN_GPSR_FILTERS[key]) return null;
  if (key === "incomplete") return buildGpsrIncompleteWhere();
  if (key === "help") return OPEN_REVIEW_REQUEST_WHERE;

  const declarations = await db.productGpsrDeclaration.findMany({
    select: { productId: true, noticeVersion: true, manufacturerHash: true, safetyHash: true, createdAt: true },
  });
  const declaredIds = [...new Set(declarations.map((d) => d.productId))];
  if (key === "missing") return declaredIds.length ? { id: { notIn: declaredIds } } : {};
  if (!declaredIds.length) return { id: { in: [] } };

  const products = await db.product.findMany({
    where: { id: { in: declaredIds } },
    select: { ...PRODUCT_GPSR_SELECT, service: { select: { vendor: { select: { id: true, ...VENDOR_GPSR_SELECT } } } } },
  });
  const byProduct = new Map();
  for (const d of declarations) {
    if (!byProduct.has(d.productId)) byProduct.set(d.productId, []);
    byProduct.get(d.productId).push(d);
  }
  const wanted = key === "confirmed" ? GPSR_DECLARATION_STATUS.VALID : GPSR_DECLARATION_STATUS.RECONFIRM;
  const ids = products
    .filter((p) => evaluateGpsrDeclaration({ product: p, vendor: p.service?.vendor ?? null, declarations: byProduct.get(p.id) || [] }).status === wanted)
    .map((p) => p.id);
  return { id: { in: ids } };
}
