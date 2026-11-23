// backend/src/services/artfestFairPromoLabelsService.js
//
// Admin → Târg → Etichete → „Etichete fără preț”: date + validare pe server.
//  - doar promovare: QR către pagina publică a unui magazin participant sau către Artfest,
//    cu loc alb pentru preț; nu sunt pentru POS;
//  - cu produs din inventar: eticheta de produs existentă (cod AF al liniei, cod de bare,
//    QR de promovare) fără preț tipărit - prețul efectiv se introduce la casă (orice participant aprobat).
//    Produsul se alege din inventarul participantului sau se adaugă prin fluxul existent
//    de produse manuale (aceleași reguli: termen, cod AF unic, recepție).
// Participant eligibil: înscriere APPROVED la târgul activ. Magazin: pagina publică reală
// (isPublicProductStore + /magazin/<slug>).

import { prisma } from "../db.js";
import { FairError, ensureFair } from "./artfestFairService.js";
import {
  adminAddManualInventoryItem,
  formatFairBarcode,
  markBlankLabelsGenerated,
} from "./artfestFairInventoryService.js";
import { buildLabelsHtml, isPublicProductStore, publicSiteUrl, storeFromService } from "../lib/fairLabels.js";
import { renderPdfWithSharedBrowser } from "../lib/pdfBrowser.js";
import { isManualFairItem } from "../lib/artfestFairManualItem.js";
import {
  ARTFEST_PROMO,
  PROMO_LABEL_KINDS,
  PROMO_LABEL_MAX_COPIES,
  PROMO_LABELS_PER_SHEET,
  STORE_PROMO_TEXT,
  parsePromoCopies,
  renderPromoLabelsPdf,
} from "../lib/fairPromoLabels.js";

const ELIGIBLE_STATUS = "APPROVED";
const LABEL_LINE_STATUSES = ["SUBMITTED", "RECEIVED"];
const NO_MARGIN = { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" };

const STORE_SELECT = {
  id: true,
  vendorId: true,
  title: true,
  isActive: true,
  status: true,
  type: { select: { code: true } },
  vendor: { select: { isActive: true } },
  profile: { select: { slug: true, displayName: true } },
};

function storeView(service, baseUrl) {
  const store = storeFromService(service, baseUrl);
  return {
    serviceId: service.id,
    name: String(service.profile?.displayName || service.title || "").trim() || "Magazin fără nume",
    available: Boolean(store),
    url: store ? store.url : null,
    reason: store ? null : "Magazinul nu are o pagină publică activă pe Artfest (inactiv, nepublicat sau fără adresă).",
  };
}

function lineView(line) {
  return {
    id: line.id,
    title: line.titleSnapshot,
    variantLabel: line.variantLabel || null,
    barcodeDisplay: formatFairBarcode(line.barcode),
    status: line.status,
    isManual: isManualFairItem(line),
    declaredQty: line.declaredQty,
    receivedQty: line.receivedQty || 0,
    blankPriceLabel: Boolean(line.labelGeneratedAt) && line.labelPriceCents == null,
  };
}

async function productStoresOf(db, vendorIds) {
  if (!vendorIds.length) return [];
  return db.vendorService.findMany({
    where: { vendorId: { in: vendorIds }, type: { is: { code: "products" } } },
    select: STORE_SELECT,
  });
}

/** Participanții APPROVED la târgul activ: magazine + produsele din inventar (pentru alegere în Admin). */
export async function listPromoParticipants({ db = prisma, baseUrl = publicSiteUrl() } = {}) {
  const fair = await ensureFair(db);
  const registrations = await db.artfestFairRegistration.findMany({
    where: { fairId: fair.id, status: ELIGIBLE_STATUS },
    select: { id: true, vendorId: true, status: true },
  });
  const vendorIds = [...new Set(registrations.map((r) => r.vendorId))];
  const registrationIds = registrations.map((r) => r.id);
  const [vendors, services, lines] = await Promise.all([
    vendorIds.length ? db.vendor.findMany({ where: { id: { in: vendorIds } }, select: { id: true, displayName: true } }) : [],
    productStoresOf(db, vendorIds),
    registrationIds.length
      ? db.artfestFairInventoryItem.findMany({
          where: { registrationId: { in: registrationIds }, status: { in: LABEL_LINE_STATUSES } },
          orderBy: { createdAt: "asc" },
        })
      : [],
  ]);
  const names = new Map(vendors.map((v) => [v.id, v.displayName]));
  const base = String(baseUrl).replace(/\/+$/, "");
  const items = registrations.map((r) => ({
    registrationId: r.id,
    vendorId: r.vendorId,
    vendorName: names.get(r.vendorId) || "Vânzător",
    stores: services.filter((s) => s.vendorId === r.vendorId).map((s) => storeView(s, base)),
    lines: lines.filter((l) => l.registrationId === r.id).map(lineView),
  }));
  items.sort((a, b) => a.vendorName.localeCompare(b.vendorName, "ro"));
  return { items, maxCopies: PROMO_LABEL_MAX_COPIES, artfest: { name: ARTFEST_PROMO.name, url: ARTFEST_PROMO.url } };
}

async function requireParticipant(db, registrationId) {
  const fair = await ensureFair(db);
  const id = String(registrationId || "").trim();
  const registration = id
    ? await db.artfestFairRegistration.findUnique({
        where: { id },
        select: { id: true, fairId: true, vendorId: true, status: true },
      })
    : null;
  if (!registration || registration.fairId !== fair.id || registration.status !== ELIGIBLE_STATUS) {
    throw new FairError(409, "participant_not_eligible", "Participantul nu este activ la târg (înscrierea nu este aprobată sau a fost retrasă, respinsă ori anulată).");
  }
  return registration;
}

async function requirePublicStore(db, registration, serviceId, baseUrl) {
  const id = String(serviceId || "").trim();
  const service = id ? await db.vendorService.findUnique({ where: { id }, select: STORE_SELECT }) : null;
  if (!service || service.vendorId !== registration.vendorId || service.type?.code !== "products") {
    throw new FairError(404, "store_not_found", "Magazinul ales nu aparține acestui participant.");
  }
  const store = isPublicProductStore(service) ? storeFromService(service, String(baseUrl).replace(/\/+$/, "")) : null;
  if (!store) {
    throw new FairError(409, "store_not_public", "Magazinul nu are o pagină publică activă pe Artfest, deci nu se poate genera un QR valid.");
  }
  return store;
}

/**
 * Ținta etichetei, verificată pe server (nu ne bazăm pe lista din frontend).
 * Cu inventoryItemId: participantul (registrationId) e OBLIGATORIU și pentru QR-ul Artfest -
 * alegerea QR-ului nu schimbă proprietarul produsului.
 */
export async function resolvePromoTarget({ body = {}, db = prisma, baseUrl = publicSiteUrl() }) {
  const kind = String(body.kind || "");
  if (!PROMO_LABEL_KINDS.includes(kind)) {
    throw new FairError(400, "invalid_kind", "Alege tipul etichetei: magazin participant sau Artfest.");
  }
  const copies = parsePromoCopies(body.copies);
  if (copies === null) {
    throw new FairError(400, "invalid_copies", `Numărul de exemplare trebuie să fie un număr întreg între 1 și ${PROMO_LABEL_MAX_COPIES}.`, {
      fields: { copies: `Între 1 și ${PROMO_LABEL_MAX_COPIES}.` },
    });
  }
  const withProduct = Boolean(String(body.inventoryItemId || "").trim());
  const needsParticipant = kind === "store" || withProduct;
  const registration = needsParticipant ? await requireParticipant(db, body.registrationId) : null;

  let target;
  if (kind === "artfest") {
    target = { ...ARTFEST_PROMO };
  } else {
    const store = await requirePublicStore(db, registration, body.serviceId, baseUrl);
    target = { name: store.name, url: store.url, text: STORE_PROMO_TEXT, site: null };
  }

  let line = null;
  if (withProduct) {
    line = await db.artfestFairInventoryItem.findUnique({ where: { id: String(body.inventoryItemId) } });
    if (!line || line.registrationId !== registration.id || !LABEL_LINE_STATUSES.includes(line.status)) {
      throw new FairError(404, "inventory_item_not_found", "Produsul nu este în inventarul trimis al acestui participant.");
    }
  }
  return { target, copies, line, registration };
}

/** Eticheta de produs existentă, fără preț tipărit, cu QR-ul de promovare și codul AF al liniei. */
export function buildBlankPriceProductLabelsHtml(line, target, copies) {
  const label = {
    title: line.titleSnapshot,
    variantLabel: line.variantLabel || null,
    storeName: line.storeNameSnapshot || null,
    priceCents: null,
    blankPrice: true,
    barcode: line.barcode,
    qrUrl: target.url,
  };
  return buildLabelsHtml(Array.from({ length: copies }, () => label), { mode: "sheet" });
}

export async function renderPromoLabels({ body = {}, db = prisma, baseUrl, toPdf = renderPdfWithSharedBrowser, adminId = null, now = new Date() } = {}) {
  const { target, copies, line } = await resolvePromoTarget({ body, db, ...(baseUrl ? { baseUrl } : {}) });
  if (!line) {
    const out = await renderPromoLabelsPdf(target, copies, { toPdf });
    return { ...out, target, line: null };
  }
  const html = buildBlankPriceProductLabelsHtml(line, target, copies);
  const pdf = await toPdf(html, { format: "A4", margin: NO_MARGIN });
  // eticheta există fizic, fără preț: POS-ul cere prețul la casă (starea „blank”)
  await markBlankLabelsGenerated({ item: line, copies, userId: adminId, db, now });
  return { pdf, labelCount: copies, pageCount: Math.ceil(copies / PROMO_LABELS_PER_SHEET), target, line };
}

/**
 * „Adaugă și în inventar”: produs manual pentru participantul ales, prin fluxul existent.
 * body: { registrationId, title, priceRon, declaredQty, clientRequestId, isFragile?, isUnique?, ... }
 */
export async function addPromoInventoryItem({ body = {}, adminId, db = prisma, now = new Date(), env, randomInt }) {
  const registration = await requireParticipant(db, body.registrationId);
  const { registrationId: _ignored, ...manualBody } = body;
  void _ignored;
  const { item, duplicate } = await adminAddManualInventoryItem({
    vendorId: registration.vendorId,
    adminId,
    body: manualBody,
    db,
    now,
    env,
    randomInt,
  });
  return { item: lineView(item), duplicate };
}
