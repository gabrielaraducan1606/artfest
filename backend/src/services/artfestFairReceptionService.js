// backend/src/services/artfestFairReceptionService.js
//
// Târgul Artfest - etapa 2: recepția inventarului în Admin.
//
//   - scanare: linia se găsește după codul de bare (scaner USB 1D = tastatură);
//   - recepție: receivedQty + rejectedQty, o singură dată per linie,
//     idempotentă (Idempotency-Key => mișcările au chei unice);
//   - REJECTED la recepție (nu intră în stoc) vs DAMAGED după intrarea în stoc;
//   - blocare / deblocare de la vânzare, separat de statusul fizic;
//   - eligibilitatea produsului (moderare / activ) e semnalată, NU schimbă
//     statusul liniei;
//   - anularea controlată a unei linii SUBMITTED (încă nerecepționată), cu
//     eliberarea rezervării online;
//   - după anularea participării (înscriere CANCELLED): recepția e permisă
//     doar pentru reconciliere / retur (linia se blochează automat de la
//     vânzare), iar deblocarea e refuzată.
//
// NU conține POS, vânzare, decont sau reduceri. Returul către vendor e în
// artfestFairReturnService.js.

import { prisma } from "../db.js";
import { FairError, ensureFair } from "./artfestFairService.js";
import { lockProductForFair } from "./fairProductLock.js";
import { formatFairBarcode } from "./artfestFairInventoryService.js";
import { FAIR_TX_OPTIONS, PARTICIPATION_CANCELLED_BLOCK_REASON } from "../config/artfestFair.js";

export const RETURN_ONLY_TEXT = "Produs primit doar pentru retur – nu este disponibil pentru vânzare.";

export const FAIR_PHOTO_FOLDER = "artfest-fair-reception";
const BARCODE_RE = /^AF[2-9ABCDEFGHJKMNPQRSTVWX]{8}$/;
const MAX_QTY = 10000;
const MAX_PHOTOS = 10;
const TEXT_LIMIT = 2000;

/* ===================== Utilitare ===================== */

// scanerul poate trimite litere mici, spații sau cratime
export function normalizeScannedBarcode(raw) {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function describeDifference(declaredQty, receivedQty, rejectedQty) {
  const delta = (receivedQty || 0) + (rejectedQty || 0) - (declaredQty || 0);
  if (delta === 0) return { delta, text: null };
  const n = Math.abs(delta);
  if (delta < 0) return { delta, text: n === 1 ? "Lipsește 1 bucată" : `Lipsesc ${n} bucăți` };
  return { delta, text: n === 1 ? "+1 bucată față de cantitatea declarată" : `+${n} bucăți față de cantitatea declarată` };
}

/*
 * Eligibilitatea pentru vânzare a produsului asociat - folosită de Admin
 * acum și de POS ulterior. NU modifică statusul fizic al liniei.
 */
export function getSaleEligibility(line, product, { registrationStatus = "APPROVED" } = {}) {
  const reasons = [];
  if (!product) reasons.push("Produsul nu mai există pe Artfest.");
  else {
    if (product.moderationStatus !== "APPROVED") reasons.push("Produsul nu mai este aprobat pe Artfest (moderare).");
    if (product.isActive === false) reasons.push("Produsul nu mai este activ pe Artfest.");
    if (product.isHidden === true) reasons.push("Produsul este ascuns pe Artfest.");
  }
  const eligible = reasons.length === 0;
  // POS-ul (viitor) vinde DOAR linii ale înscrierilor APPROVED
  const sellable =
    eligible &&
    registrationStatus === "APPROVED" &&
    line.status === "RECEIVED" &&
    (line.availableQty || 0) > 0 &&
    !line.saleBlockedAt;
  return { eligible, reasons, sellable };
}

export function cleanText(value, max = TEXT_LIMIT) {
  const text = String(value ?? "").trim();
  if (text.length > max) {
    throw new FairError(400, "text_too_long", `Textul poate avea maximum ${max} de caractere.`);
  }
  return text || null;
}

function parseQty(value, field) {
  if (value === undefined || value === null || value === "") return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_QTY) {
    throw new FairError(400, "invalid_quantity", "Cantitate invalidă.", { fields: { [field]: "Introdu un număr întreg ≥ 0." } });
  }
  return n;
}

// doar fotografii urcate prin endpoint-ul de recepție (R2, folderul târgului)
export function validatePhotoUrls(urls, allowedPrefix) {
  if (urls === undefined || urls === null) return [];
  if (!Array.isArray(urls) || urls.length > MAX_PHOTOS) {
    throw new FairError(400, "invalid_photos", `Poți atașa maximum ${MAX_PHOTOS} fotografii.`);
  }
  const clean = urls.map((u) => String(u || "").trim()).filter(Boolean);
  if (!allowedPrefix || clean.some((u) => !u.startsWith(allowedPrefix))) {
    throw new FairError(400, "invalid_photos", "Fotografiile trebuie încărcate din pagina de recepție.");
  }
  return [...new Set(clean)];
}

export function requireIdempotencyKey(key) {
  const value = String(key || "").trim();
  if (value.length < 8 || value.length > 80 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new FairError(400, "idempotency_key_required", "Lipsește cheia de idempotență a operației.");
  }
  return value;
}

export async function lockLine(tx, lineId) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`artfest-fair-line:${lineId}`}))`;
}

export async function writeEvent(db, line, type, { before = null, after = null, note = null, actorUserId = null } = {}) {
  await db.artfestFairInventoryEvent.create({
    data: { inventoryItemId: line.id, fairId: line.fairId, vendorId: line.vendorId, type, before, after, note, actorUserId },
  });
}

/* ===================== Serializare Admin ===================== */

const PRODUCT_SELECT = {
  id: true,
  title: true,
  priceCents: true,
  moderationStatus: true,
  isActive: true,
  isHidden: true,
  availability: true,
  readyQty: true,
};

async function loadRelated(db, lines) {
  const productIds = [...new Set(lines.map((l) => l.productId).filter(Boolean))];
  const vendorIds = [...new Set(lines.map((l) => l.vendorId))];
  const registrationIds = [...new Set(lines.map((l) => l.registrationId).filter(Boolean))];
  const [products, vendors, registrations] = await Promise.all([
    productIds.length ? db.product.findMany({ where: { id: { in: productIds } }, select: PRODUCT_SELECT }) : [],
    vendorIds.length ? db.vendor.findMany({ where: { id: { in: vendorIds } }, select: { id: true, displayName: true } }) : [],
    registrationIds.length
      ? db.artfestFairRegistration.findMany({ where: { id: { in: registrationIds } }, select: { id: true, status: true } })
      : [],
  ]);
  return {
    products: new Map(products.map((p) => [p.id, p])),
    vendors: new Map(vendors.map((v) => [v.id, v])),
    registrations: new Map(registrations.map((r) => [r.id, r.status])),
  };
}

function serializeMovement(m) {
  return {
    id: m.id,
    type: m.type,
    quantity: m.quantity,
    reason: m.reason || null,
    photoUrls: Array.isArray(m.photoUrls) ? m.photoUrls : [],
    createdAt: m.createdAt,
  };
}

function warningsFor(line, product, eligibility, registrationStatus) {
  const warnings = [];
  if (registrationStatus === "CANCELLED") {
    warnings.push(
      line.status === "SUBMITTED"
        ? "Participarea vendorului a fost anulată. La sosire, produsul se recepționează doar pentru retur."
        : RETURN_ONLY_TEXT
    );
  }
  if (line.isFragile) warnings.push("Fragil - manipulează cu grijă.");
  if (line.handlingInstructions) warnings.push(`Manipulare: ${line.handlingInstructions}`);
  if (line.isUnique) warnings.push("Unicat - o singură bucată.");
  if (!line.labelGeneratedAt) warnings.push("Vendorul nu a generat încă eticheta.");
  else if (line.labelPriceCents !== line.priceSnapshotCents) warnings.push("Eticheta are un preț vechi.");
  if (line.status === "DRAFT") warnings.push("Vendorul nu a trimis încă această linie de inventar.");
  if (line.status === "CANCELLED") warnings.push("Linia a fost anulată.");
  if (line.saleBlockedAt && line.saleBlockedReason !== PARTICIPATION_CANCELLED_BLOCK_REASON) {
    warnings.push(`Blocat de la vânzare: ${line.saleBlockedReason}`);
  }
  for (const reason of eligibility.reasons) warnings.push(reason);
  if (product && product.priceCents !== line.priceSnapshotCents && line.status === "SUBMITTED") {
    warnings.push("Prețul produsului pe Artfest diferă de prețul declarat pentru târg.");
  }
  return warnings;
}

export function serializeAdminLine(
  line,
  { product = null, vendor = null, movements = null, fairId = null, registrationStatus = "APPROVED" } = {}
) {
  const eligibility = getSaleEligibility(line, product, { registrationStatus });
  const received = line.status === "RECEIVED" || line.status === "REJECTED";
  const participationCancelled = registrationStatus === "CANCELLED";
  return {
    id: line.id,
    barcode: line.barcode,
    barcodeDisplay: formatFairBarcode(line.barcode),
    belongsToActiveFair: fairId ? line.fairId === fairId : true,
    title: line.titleSnapshot,
    variantLabel: line.variantLabel || null,
    storeName: line.storeNameSnapshot || null,
    imageUrl: line.imageUrlSnapshot || null,
    vendor: { id: line.vendorId, name: vendor?.displayName || null },
    productId: line.productId,
    priceCents: line.priceSnapshotCents,
    currency: line.currency,
    declaredQty: line.declaredQty,
    receivedQty: line.receivedQty,
    rejectedQty: line.rejectedQty,
    damagedQty: line.damagedQty,
    lostQty: line.lostQty,
    soldQty: line.soldQty,
    returnedQty: line.returnedQty,
    availableQty: line.availableQty,
    status: line.status,
    isFragile: line.isFragile,
    isUnique: line.isUnique,
    isLimitedEdition: line.isLimitedEdition,
    canBeRemade: line.canBeRemade,
    handlingInstructions: line.handlingInstructions || null,
    vendorNotes: line.vendorNotes || null,
    adminNotes: line.adminNotes || null,
    receivedAt: line.receivedAt || null,
    // eticheta: aceeași stare ca la vendor (preț vechi => de regenerat)
    label: {
      state: !line.labelGeneratedAt || line.labelPriceCents == null ? "none" : line.labelPriceCents === line.priceSnapshotCents ? "valid" : "outdated",
      generatedAt: line.labelGeneratedAt || null,
      priceCents: line.labelPriceCents ?? null,
    },
    onlineReservationMode: line.onlineReservationMode,
    registrationId: line.registrationId,
    registrationStatus,
    // înscriere anulată: linia e doar pentru reconciliere / retur, niciodată de vânzare
    returnOnly: participationCancelled,
    rejectedReturnedQty: line.rejectedReturnedQty || 0,
    damagedReturnedQty: line.damagedReturnedQty || 0,
    saleBlocked: line.saleBlockedAt
      ? {
          at: line.saleBlockedAt,
          reason: line.saleBlockedReason === PARTICIPATION_CANCELLED_BLOCK_REASON ? RETURN_ONLY_TEXT : line.saleBlockedReason,
          code: line.saleBlockedReason === PARTICIPATION_CANCELLED_BLOCK_REASON ? PARTICIPATION_CANCELLED_BLOCK_REASON : null,
        }
      : null,
    difference: received ? describeDifference(line.declaredQty, line.receivedQty, line.rejectedQty) : { delta: 0, text: null },
    eligibility,
    warnings: warningsFor(line, product, eligibility, registrationStatus),
    actions: {
      canReceive: line.status === "SUBMITTED" && (registrationStatus === "APPROVED" || participationCancelled),
      canMarkDamaged: line.status === "RECEIVED" && line.availableQty > 0,
      canBlock: line.status === "RECEIVED" && !line.saleBlockedAt,
      canUnblock: Boolean(line.saleBlockedAt) && registrationStatus === "APPROVED",
      canCancel: line.status === "SUBMITTED",
      canPrintLabel: ["SUBMITTED", "RECEIVED"].includes(line.status) && registrationStatus === "APPROVED",
    },
    ...(movements ? { movements: movements.map(serializeMovement) } : {}),
  };
}

async function loadAdminLine(db, id, fairId) {
  const line = await db.artfestFairInventoryItem.findUnique({ where: { id: String(id || "") } });
  if (!line) throw new FairError(404, "inventory_item_not_found", "Linia de inventar nu a fost găsită.");
  const { products, vendors, registrations } = await loadRelated(db, [line]);
  const movements = await db.artfestFairStockMovement.findMany({
    where: { inventoryItemId: line.id },
    orderBy: { createdAt: "asc" },
  });
  return serializeAdminLine(line, {
    product: products.get(line.productId) || null,
    vendor: vendors.get(line.vendorId) || null,
    movements,
    fairId,
    registrationStatus: registrations.get(line.registrationId),
  });
}

export async function getAdminInventoryLine({ id, db = prisma }) {
  const fair = await ensureFair(db);
  return loadAdminLine(db, id, fair.id);
}

/* ===================== Scanare ===================== */

export async function lookupByBarcode({ barcode, db = prisma }) {
  const code = normalizeScannedBarcode(barcode);
  if (!BARCODE_RE.test(code)) {
    throw new FairError(404, "barcode_not_found", "Codul scanat nu există în inventarul târgului.");
  }

  const fair = await ensureFair(db);
  const line = await db.artfestFairInventoryItem.findUnique({ where: { barcode: code } });
  if (!line) throw new FairError(404, "barcode_not_found", "Codul scanat nu există în inventarul târgului.");

  const item = await loadAdminLine(db, line.id, fair.id);
  if (line.fairId !== fair.id) {
    throw new FairError(409, "barcode_other_fair", "Produsul scanat nu aparține târgului activ.", { item });
  }
  return item;
}

/* ===================== Listă + filtre ===================== */

export const INVENTORY_FILTERS = Object.freeze(["all", "to_receive", "received", "discrepancy", "rejected", "blocked"]);

function matchesFilter(line, filter) {
  switch (filter) {
    case "to_receive":
      return line.status === "SUBMITTED";
    case "received":
      return line.status === "RECEIVED";
    case "discrepancy":
      return (
        (line.status === "RECEIVED" || line.status === "REJECTED") &&
        line.receivedQty + line.rejectedQty !== line.declaredQty
      );
    case "rejected":
      return line.status === "REJECTED" || line.rejectedQty > 0;
    case "blocked":
      return Boolean(line.saleBlockedAt);
    default:
      return true;
  }
}

export async function listAdminInventory({ filter = "all", q = "", db = prisma }) {
  if (!INVENTORY_FILTERS.includes(filter)) throw new FairError(400, "invalid_filter", "Filtru invalid.");
  const fair = await ensureFair(db);

  // ciornele vendorului nu sunt încă inventar; liniile anulate nu se mai recepționează
  const lines = await db.artfestFairInventoryItem.findMany({
    where: { fairId: fair.id, status: { notIn: ["DRAFT", "CANCELLED"] } },
    orderBy: { submittedAt: "asc" },
  });
  const { products, vendors, registrations } = await loadRelated(db, lines);

  const term = String(q || "").trim().toLowerCase();
  const searchable = term
    ? lines.filter((l) => {
        const vendorName = vendors.get(l.vendorId)?.displayName || "";
        return [l.titleSnapshot, l.barcode, formatFairBarcode(l.barcode), vendorName, l.variantLabel || ""]
          .join(" ")
          .toLowerCase()
          .includes(term);
      })
    : lines;

  const counts = Object.fromEntries(INVENTORY_FILTERS.map((f) => [f, searchable.filter((l) => matchesFilter(l, f)).length]));
  const items = searchable
    .filter((l) => matchesFilter(l, filter))
    .map((l) =>
      serializeAdminLine(l, {
        product: products.get(l.productId) || null,
        vendor: vendors.get(l.vendorId) || null,
        fairId: fair.id,
        registrationStatus: registrations.get(l.registrationId),
      })
    );

  return { filter, counts, items };
}

/* ===================== Recepție ===================== */

export async function receiveInventoryLine({
  id,
  body = {},
  idempotencyKey,
  adminId,
  photoPrefix,
  db = prisma,
  now = new Date(),
}) {
  const key = requireIdempotencyKey(idempotencyKey);
  const receivedQty = parseQty(body.receivedQty, "receivedQty");
  const rejectedQty = parseQty(body.rejectedQty, "rejectedQty");
  const rejectedReason = cleanText(body.rejectedReason, 500);
  const adminNotes = body.adminNotes === undefined ? undefined : cleanText(body.adminNotes);
  const photoUrls = validatePhotoUrls(body.photoUrls, photoPrefix);

  if (receivedQty + rejectedQty < 1) {
    throw new FairError(400, "invalid_quantity", "Introdu cel puțin o bucată primită sau refuzată.", {
      fields: { receivedQty: "Introdu cantitatea primită." },
    });
  }
  if (rejectedQty > 0 && (!rejectedReason || rejectedReason.length < 3)) {
    throw new FairError(400, "rejected_reason_required", "Motivul refuzului este obligatoriu.", {
      fields: { rejectedReason: "Scrie motivul pentru care produsele sunt refuzate." },
    });
  }

  const fair = await ensureFair(db);
  const movementKeys = [`${key}:RECEIVED`, `${key}:REJECTED`];

  const replayed = await db.$transaction(async (tx) => {
    await lockLine(tx, String(id));

    // aceeași operație retrimisă (dublu click, Enter dublu, retry de rețea)
    const previous = await tx.artfestFairStockMovement.findFirst({
      where: { idempotencyKey: { in: movementKeys } },
      select: { inventoryItemId: true },
    });
    if (previous) {
      if (previous.inventoryItemId !== String(id)) {
        throw new FairError(409, "idempotency_conflict", "Cheia operației a fost folosită pentru alt produs.");
      }
      return true;
    }

    const line = await tx.artfestFairInventoryItem.findUnique({ where: { id: String(id) } });
    if (!line) throw new FairError(404, "inventory_item_not_found", "Linia de inventar nu a fost găsită.");
    if (line.fairId !== fair.id) throw new FairError(409, "barcode_other_fair", "Produsul nu aparține târgului activ.");
    if (line.status !== "SUBMITTED") {
      throw new FairError(
        409,
        line.status === "RECEIVED" || line.status === "REJECTED" ? "already_received" : "not_receivable",
        line.status === "RECEIVED" || line.status === "REJECTED"
          ? "Produsul a fost deja recepționat."
          : "Linia nu poate fi recepționată (nu a fost trimisă de vendor sau a fost anulată).",
        { currentStatus: line.status }
      );
    }

    // statusul înscrierii, citit sub lock-ul liniei (anularea ia același lock)
    const registration = await tx.artfestFairRegistration.findUnique({
      where: { id: line.registrationId },
      select: { status: true },
    });
    const returnOnly = registration?.status === "CANCELLED";
    if (!returnOnly && registration?.status !== "APPROVED") {
      throw new FairError(409, "registration_not_approved", "Înscrierea vendorului nu este aprobată. Produsul nu poate fi recepționat.", {
        currentStatus: registration?.status || null,
      });
    }

    const status = receivedQty > 0 ? "RECEIVED" : "REJECTED";
    const availableQty = receivedQty - line.soldQty - line.damagedQty - line.lostQty - line.returnedQty;
    // participare anulată: intră în stoc doar pentru reconciliere / retur, blocat de la vânzare
    const blockForReturn = returnOnly && status === "RECEIVED" && !line.saleBlockedAt;

    const claimed = await tx.artfestFairInventoryItem.updateMany({
      where: { id: line.id, status: "SUBMITTED" },
      data: {
        status,
        receivedQty,
        rejectedQty,
        availableQty,
        receivedAt: now,
        receivedById: adminId || null,
        ...(adminNotes !== undefined ? { adminNotes } : {}),
        ...(blockForReturn
          ? { saleBlockedAt: now, saleBlockedReason: PARTICIPATION_CANCELLED_BLOCK_REASON, saleBlockedById: adminId || null }
          : {}),
      },
    });
    if (claimed.count !== 1) throw new FairError(409, "already_received", "Produsul a fost deja recepționat.");

    const base = { inventoryItemId: line.id, fairId: line.fairId, vendorId: line.vendorId, actorUserId: adminId || null };
    if (receivedQty > 0) {
      await tx.artfestFairStockMovement.create({
        data: {
          ...base,
          type: "RECEIVED",
          quantity: receivedQty,
          idempotencyKey: movementKeys[0],
          photoUrls: rejectedQty > 0 ? [] : photoUrls,
        },
      });
    }
    if (rejectedQty > 0) {
      await tx.artfestFairStockMovement.create({
        data: { ...base, type: "REJECTED", quantity: rejectedQty, reason: rejectedReason, photoUrls, idempotencyKey: movementKeys[1] },
      });
    }

    const diff = describeDifference(line.declaredQty, receivedQty, rejectedQty);
    await writeEvent(tx, line, "STATUS_CHANGED", {
      before: { status: "SUBMITTED" },
      after: { status, receivedQty, rejectedQty, difference: diff.delta },
      note: diff.text,
      actorUserId: adminId || null,
    });
    if (returnOnly) {
      await writeEvent(tx, line, "RECEIVED_FOR_RETURN_ONLY", {
        after: { status, receivedQty, rejectedQty },
        note: "participation_cancelled",
        actorUserId: adminId || null,
      });
      if (blockForReturn) {
        await writeEvent(tx, line, "SALE_BLOCKED", {
          after: { reason: PARTICIPATION_CANCELLED_BLOCK_REASON },
          actorUserId: adminId || null,
        });
      }
    }
    return false;
  }, FAIR_TX_OPTIONS);

  const item = await loadAdminLine(db, id, fair.id);
  return { replayed, returnOnly: item.returnOnly, item };
}

/* ===================== Deteriorare (după intrarea în stoc) ===================== */

export async function markDamaged({ id, body = {}, idempotencyKey, adminId, photoPrefix, db = prisma }) {
  const key = `${requireIdempotencyKey(idempotencyKey)}:DAMAGED`;
  const quantity = parseQty(body.quantity, "quantity");
  const reason = cleanText(body.reason, 500);
  const photoUrls = validatePhotoUrls(body.photoUrls, photoPrefix);

  if (quantity < 1) throw new FairError(400, "invalid_quantity", "Introdu câte bucăți sunt deteriorate.");
  if (!reason || reason.length < 3) {
    throw new FairError(400, "damage_reason_required", "Motivul deteriorării este obligatoriu.", {
      fields: { reason: "Descrie deteriorarea." },
    });
  }

  const fair = await ensureFair(db);
  const replayed = await db.$transaction(async (tx) => {
    await lockLine(tx, String(id));

    const previous = await tx.artfestFairStockMovement.findUnique({ where: { idempotencyKey: key }, select: { inventoryItemId: true } });
    if (previous) {
      if (previous.inventoryItemId !== String(id)) {
        throw new FairError(409, "idempotency_conflict", "Cheia operației a fost folosită pentru alt produs.");
      }
      return true;
    }

    const line = await tx.artfestFairInventoryItem.findUnique({ where: { id: String(id) } });
    if (!line) throw new FairError(404, "inventory_item_not_found", "Linia de inventar nu a fost găsită.");
    if (line.status !== "RECEIVED") {
      throw new FairError(409, "not_in_stock", "Doar produsele recepționate (intrate în stoc) pot fi marcate deteriorate.");
    }

    const res = await tx.artfestFairInventoryItem.updateMany({
      where: { id: line.id, status: "RECEIVED", availableQty: { gte: quantity } },
      data: { damagedQty: { increment: quantity }, availableQty: { decrement: quantity } },
    });
    if (res.count !== 1) {
      throw new FairError(409, "insufficient_available", `În stoc sunt doar ${line.availableQty} bucăți disponibile.`);
    }

    await tx.artfestFairStockMovement.create({
      data: {
        inventoryItemId: line.id,
        fairId: line.fairId,
        vendorId: line.vendorId,
        type: "DAMAGED",
        quantity,
        reason,
        photoUrls,
        actorUserId: adminId || null,
        idempotencyKey: key,
      },
    });
    return false;
  }, FAIR_TX_OPTIONS);

  return { replayed, item: await loadAdminLine(db, id, fair.id) };
}

/* ===================== Blocare de la vânzare ===================== */

export async function blockSale({ id, reason, adminId, db = prisma, now = new Date() }) {
  const text = cleanText(reason, 500);
  if (!text || text.length < 3) {
    throw new FairError(400, "block_reason_required", "Motivul blocării este obligatoriu.", { fields: { reason: "Scrie motivul." } });
  }
  const fair = await ensureFair(db);

  await db.$transaction(async (tx) => {
    await lockLine(tx, String(id));
    const line = await tx.artfestFairInventoryItem.findUnique({ where: { id: String(id) } });
    if (!line) throw new FairError(404, "inventory_item_not_found", "Linia de inventar nu a fost găsită.");
    if (line.status !== "RECEIVED") {
      throw new FairError(409, "not_in_stock", "Doar produsele recepționate pot fi blocate de la vânzare.");
    }
    const res = await tx.artfestFairInventoryItem.updateMany({
      where: { id: line.id, saleBlockedAt: null },
      data: { saleBlockedAt: now, saleBlockedReason: text, saleBlockedById: adminId || null },
    });
    if (res.count !== 1) throw new FairError(409, "already_blocked", "Produsul este deja blocat de la vânzare.");
    await writeEvent(tx, line, "SALE_BLOCKED", { after: { reason: text }, actorUserId: adminId || null });
  }, FAIR_TX_OPTIONS);

  return loadAdminLine(db, id, fair.id);
}

export async function unblockSale({ id, adminId, db = prisma }) {
  const fair = await ensureFair(db);

  await db.$transaction(async (tx) => {
    await lockLine(tx, String(id));
    const line = await tx.artfestFairInventoryItem.findUnique({ where: { id: String(id) } });
    if (!line) throw new FairError(404, "inventory_item_not_found", "Linia de inventar nu a fost găsită.");
    // o linie a unei participări anulate nu mai poate redeveni de vânzare
    const registration = await tx.artfestFairRegistration.findUnique({
      where: { id: line.registrationId },
      select: { status: true },
    });
    if (registration?.status !== "APPROVED") {
      throw new FairError(
        409,
        "registration_not_approved",
        "Participarea vendorului nu este aprobată (sau a fost anulată). Produsul nu poate fi deblocat pentru vânzare.",
        { currentStatus: registration?.status || null }
      );
    }
    const res = await tx.artfestFairInventoryItem.updateMany({
      where: { id: line.id, saleBlockedAt: { not: null } },
      data: { saleBlockedAt: null, saleBlockedReason: null, saleBlockedById: null },
    });
    if (res.count !== 1) throw new FairError(409, "not_blocked", "Produsul nu este blocat de la vânzare.");
    // auditul blocării rămâne în evenimente
    await writeEvent(tx, line, "SALE_UNBLOCKED", {
      before: { reason: line.saleBlockedReason, blockedAt: line.saleBlockedAt, blockedById: line.saleBlockedById },
      actorUserId: adminId || null,
    });
  }, FAIR_TX_OPTIONS);

  return loadAdminLine(db, id, fair.id);
}

/* ===================== Anulare SUBMITTED + eliberarea rezervării ===================== */

/*
 * Eliberează rezervarea online a liniei (în tranzacția apelantului, după
 * lock pe produs). Restaurează doar dacă e sigur; altfel lasă produsul
 * neatins și scrie ONLINE_RESTORE_SKIPPED.
 */
export async function releaseOnlineReservation(tx, line, { actorUserId, now }) {
  const lineData = {};

  if (line.onlineReservationMode === "TRANSFERRED") {
    const qty = Math.max(0, (line.onlineReservedQty || 0) - (line.onlineReleasedQty || 0));
    const product = line.productId
      ? await tx.product.findUnique({ where: { id: line.productId }, select: { id: true, readyQty: true, availability: true } })
      : null;

    const res =
      qty > 0 && product
        ? await tx.product.updateMany({
            // aceeași regulă ca stockRestore: doar produse încă urmărite pe stoc
            where: { id: product.id, readyQty: { not: null }, availability: { in: ["READY", "SOLD_OUT"] } },
            data: { readyQty: { increment: qty }, availability: "READY" },
          })
        : { count: 0 };

    lineData.onlineReleasedQty = line.onlineReservedQty;
    lineData.onlineReleasedAt = now;

    if (res.count === 1) {
      await writeEvent(tx, line, "ONLINE_STOCK_RELEASED", {
        before: { readyQty: product.readyQty, availability: product.availability },
        after: { readyQty: product.readyQty + qty, availability: "READY", releasedQty: qty },
        actorUserId,
      });
    } else if (qty > 0) {
      await writeEvent(tx, line, "ONLINE_RESTORE_SKIPPED", {
        before: product ? { readyQty: product.readyQty, availability: product.availability } : null,
        after: { releasedQty: qty },
        note: product ? "product_no_longer_stock_tracked" : "product_deleted",
        actorUserId,
      });
    }
  } else if (line.onlineReservationMode === "FORCED_UNAVAILABLE") {
    const prevReadyQty = line.onlinePrevReadyQty;
    const forcedReadyQty = prevReadyQty === null || prevReadyQty === undefined ? null : 0;
    const deferred = line.onlineDeferredRestoreQty || 0;
    const nextReadyQty = forcedReadyQty === null ? null : prevReadyQty + deferred;
    let nextAvailability = line.onlinePrevAvailability || "READY";
    if (nextAvailability === "SOLD_OUT" && nextReadyQty !== null && nextReadyQty > 0) nextAvailability = "READY";

    const product = line.productId
      ? await tx.product.findUnique({ where: { id: line.productId }, select: { id: true, readyQty: true, availability: true } })
      : null;

    // sigur doar dacă produsul e încă exact în starea pusă de noi
    const res = product
      ? await tx.product.updateMany({
          where: { id: product.id, availability: "SOLD_OUT", readyQty: forcedReadyQty },
          data: { availability: nextAvailability, readyQty: nextReadyQty },
        })
      : { count: 0 };

    lineData.onlineReleasedAt = now;

    if (res.count === 1) {
      await writeEvent(tx, line, "ONLINE_STOCK_RELEASED", {
        before: { availability: "SOLD_OUT", readyQty: forcedReadyQty },
        after: { availability: nextAvailability, readyQty: nextReadyQty, deferredRestored: deferred },
        actorUserId,
      });
    } else {
      await writeEvent(tx, line, "ONLINE_RESTORE_SKIPPED", {
        before: product ? { availability: product.availability, readyQty: product.readyQty } : null,
        after: { wanted: { availability: nextAvailability, readyQty: nextReadyQty } },
        note: product ? "product_changed_since_reservation" : "product_deleted",
        actorUserId,
      });
    }
  }

  return lineData;
}

/*
 * actor: { type: "vendor", vendorId, userId, canEdit } | { type: "admin", userId }
 */
/*
 * releaseOnline = false (doar Admin): coletul s-a pierdut pe drum - linia se
 * anulează, dar stocul NU revine online (produsul nu mai există fizic).
 */
export async function cancelSubmittedLine({ id, actor, reason = null, releaseOnline = true, db = prisma, now = new Date() }) {
  const existing = await db.artfestFairInventoryItem.findUnique({ where: { id: String(id || "") } });
  if (!existing || (actor.type === "vendor" && existing.vendorId !== actor.vendorId)) {
    throw new FairError(404, "inventory_item_not_found", "Linia de inventar nu a fost găsită.");
  }
  if (actor.type === "vendor" && !actor.canEdit) {
    throw new FairError(409, "inventory_locked", "Termenul pentru inventar a trecut. Pentru anulare, scrie-ne din Asistență.");
  }

  const note = cleanText(reason, 500);

  await db.$transaction(async (tx) => {
    if (existing.productId) await lockProductForFair(tx, existing.productId);
    await lockLine(tx, existing.id);

    const line = await tx.artfestFairInventoryItem.findUnique({ where: { id: existing.id } });
    if (line.status !== "SUBMITTED") {
      throw new FairError(
        409,
        "not_cancellable",
        line.status === "RECEIVED" || line.status === "REJECTED"
          ? "Produsul a fost deja recepționat de Artfest și nu mai poate fi anulat."
          : "Doar liniile trimise și încă nerecepționate pot fi anulate.",
        { currentStatus: line.status }
      );
    }

    let releaseData;
    if (releaseOnline || actor.type !== "admin") {
      releaseData = await releaseOnlineReservation(tx, line, { actorUserId: actor.userId || null, now });
    } else {
      // rezervarea se închide fără să readucă stocul online
      releaseData = { onlineReleasedAt: now, onlineReleasedQty: line.onlineReservedQty };
      if (line.onlineReservationMode !== "NONE") {
        await writeEvent(tx, line, "ONLINE_RESTORE_SKIPPED", {
          after: { mode: line.onlineReservationMode },
          note: "not_released_by_admin",
          actorUserId: actor.userId || null,
        });
      }
    }

    const res = await tx.artfestFairInventoryItem.updateMany({
      where: { id: line.id, status: "SUBMITTED" },
      data: { status: "CANCELLED", cancelledAt: now, ...releaseData },
    });
    if (res.count !== 1) throw new FairError(409, "not_cancellable", "Linia a fost modificată între timp.");

    await writeEvent(tx, line, "CANCELLED", {
      before: { status: "SUBMITTED" },
      after: { status: "CANCELLED", by: actor.type },
      note,
      actorUserId: actor.userId || null,
    });
  }, FAIR_TX_OPTIONS);

  return { ok: true };
}
