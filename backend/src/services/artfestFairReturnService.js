// backend/src/services/artfestFairReturnService.js
//
// Târgul Artfest - returul produselor către vendor (Admin), confirmarea
// primirii (vendor sau Admin în numele lui) și restaurarea stocului online.
// Același flux e folosit după anularea participării (PARTICIPATION_CANCELLED),
// pentru produsele nevândute după târg (FAIR_ENDED_UNSOLD) și pentru cele
// refuzate la recepție (RECEPTION_REJECTED).
//
//   PREPARING -> SHIPPED -> CONFIRMED | CONFIRMED_WITH_DIFFERENCES
//   PREPARING -> CANCELLED (fără efect asupra stocului)
//
// Stocul fizic se mișcă DOAR la SHIPPED (mișcări RETURNED_TO_VENDOR /
// REJECTED_RETURNED_TO_VENDOR / DAMAGED_RETURNED_TO_VENDOR legate de linia de
// retur). Stocul ONLINE se restaurează DOAR la confirmarea primirii fizice, în
// aceeași tranzacție, și DOAR pentru bucățile nedeteriorate (vandabile +
// refuzate). Bucățile deteriorate se confirmă separat și nu revin online
// niciodată (CHECK: restoreOnlineQty <= vendorReceivedQty, fără deteriorate).
//
// Lock-uri (aceeași ordine peste tot):
//   1. înscrierea (artfest-fair-submit:<registrationId>) - toate retururile
//      unei înscrieri se serializează între ele și cu anularea;
//   2. produsele (sortat) - doar la confirmare (restaurare online);
//   3. liniile de inventar (sortat) - ca recepția / deteriorarea.
//
// Fără integrare cu curierul și fără efect asupra decontului: costul returului
// (shippingCostCents) e doar informativ.

import crypto from "node:crypto";
import { prisma } from "../db.js";
import {
  RETURN_ADMIN_CONFIRM_MIN_DAYS,
  RETURN_COST_PAYERS,
  RETURN_METHODS,
  RETURN_REASONS,
} from "../config/artfestFair.js";
import { FairError, ensureFair } from "./artfestFairService.js";
import { lockProductForFair } from "./fairProductLock.js";
import { formatFairBarcode } from "./artfestFairInventoryService.js";
import { cleanText, lockLine, requireIdempotencyKey, writeEvent } from "./artfestFairReceptionService.js";
import { lockRegistration } from "./artfestFairCancellationService.js";

const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LINES = 500;
const MAX_QTY = 10000;
const MAX_SHIPPING_COST_CENTS = 10_000_000;
const RETURNABLE_STATUSES = ["RECEIVED", "REJECTED"];
const CONFIRMED_STATUSES = ["CONFIRMED", "CONFIRMED_WITH_DIFFERENCES"];

/* ===================== Utilitare ===================== */

function parseQty(value, field) {
  if (value === undefined || value === null || value === "") return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_QTY) {
    throw new FairError(400, "invalid_quantity", "Cantitate invalidă.", { fields: { [field]: "Introdu un număr întreg ≥ 0." } });
  }
  return n;
}

function parseShort(value, field, max = 80) {
  if (value === undefined) return undefined;
  const text = String(value ?? "").trim();
  if (text.length > max) {
    throw new FairError(400, "text_too_long", `Textul poate avea maximum ${max} de caractere.`, { fields: { [field]: "Text prea lung." } });
  }
  return text || null;
}

function parseShippingCost(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_SHIPPING_COST_CENTS) {
    throw new FairError(400, "invalid_shipping_cost", "Costul transportului este invalid.", {
      fields: { shippingCostCents: "Introdu suma în bani (număr întreg ≥ 0)." },
    });
  }
  return n;
}

// cheia mișcării: cheia operației + amprenta liniei (încape în VarChar(100))
function movementKey(key, returnLineId, kind) {
  const tag = crypto.createHash("sha1").update(String(returnLineId)).digest("hex").slice(0, 10);
  return `${key}:${tag}:${kind}`;
}

export function costPayerFor(reason, registration) {
  return reason === "PARTICIPATION_CANCELLED" && registration?.cancellationCause === "ARTFEST_DECISION" ? "ARTFEST" : "VENDOR";
}

/*
 * Câte bucăți pot reveni online pentru o linie, dacă vendorul primește
 * `received` bucăți: TRANSFERRED -> cât e încă rezervat și nerestaurat;
 * FORCED_UNAVAILABLE -> 1 (starea anterioară a unicatului), o singură dată;
 * NONE -> 0 (stocul online nu a fost atins).
 */
export function restoreCap(item) {
  if (item.onlineReleasedAt || item.onlineRestoredAt) return 0;
  if (item.onlineReservationMode === "TRANSFERRED") {
    return Math.max(0, (item.onlineReservedQty || 0) - (item.onlineReleasedQty || 0) - (item.onlineRestoredQty || 0));
  }
  if (item.onlineReservationMode === "FORCED_UNAVAILABLE") return 1;
  return 0;
}

/* ===================== Candidați ===================== */

async function loadRegistration(db, registrationId) {
  const registration = await db.artfestFairRegistration.findUnique({
    where: { id: String(registrationId || "") },
    select: { id: true, fairId: true, vendorId: true, status: true, cancellationCause: true },
  });
  if (!registration) throw new FairError(404, "registration_not_found", "Înscrierea nu există.");
  return registration;
}

/*
 * Ce poate pleca într-un retur nou: availableQty (în stoc) și refuzatele încă
 * nereturnate, minus ce e deja rezervat în retururile PREPARING. Retururile
 * SHIPPED au scăzut deja contoarele liniei (availableQty / rejectedReturnedQty).
 */
async function computeCandidates(db, registrationId, { excludeReturnId = null } = {}) {
  const items = await db.artfestFairInventoryItem.findMany({
    where: { registrationId, status: { in: RETURNABLE_STATUSES } },
    orderBy: { createdAt: "asc" },
  });

  const preparing = await db.artfestFairReturn.findMany({
    where: { registrationId, status: "PREPARING" },
    select: { id: true },
  });
  const preparingIds = preparing.map((r) => r.id).filter((rid) => rid !== excludeReturnId);
  const reserved = preparingIds.length
    ? await db.artfestFairReturnLine.findMany({ where: { returnId: { in: preparingIds } } })
    : [];

  const map = new Map();
  for (const item of items) {
    const held = reserved.filter((l) => l.inventoryItemId === item.id);
    const heldStock = held.reduce((s, l) => s + l.qtyFromStock, 0);
    const heldRejected = held.reduce((s, l) => s + l.qtyRejected, 0);
    const heldDamaged = held.reduce((s, l) => s + (l.qtyDamaged || 0), 0);
    map.set(item.id, {
      item,
      fromStock: Math.max(0, (item.availableQty || 0) - heldStock),
      rejected: Math.max(0, (item.rejectedQty || 0) - (item.rejectedReturnedQty || 0) - heldRejected),
      damaged: Math.max(0, damagedPending(item) - heldDamaged),
      inPreparingReturns: heldStock + heldRejected + heldDamaged,
    });
  }
  return map;
}

// deteriorate încă în custodia Artfest (nereturnate)
export function damagedPending(item) {
  return Math.max(0, (item.damagedQty || 0) - (item.damagedReturnedQty || 0));
}

function serializeCandidate({ item, fromStock, rejected, damaged, inPreparingReturns }) {
  return {
    inventoryItemId: item.id,
    title: item.titleSnapshot,
    variantLabel: item.variantLabel || null,
    barcodeDisplay: formatFairBarcode(item.barcode),
    status: item.status,
    // vandabil / refuzat / deteriorat, separat
    availableQty: item.availableQty || 0,
    rejectedPendingQty: Math.max(0, (item.rejectedQty || 0) - (item.rejectedReturnedQty || 0)),
    damagedPendingQty: damagedPending(item),
    inPreparingReturns,
    maxFromStock: fromStock,
    maxRejected: rejected,
    maxDamaged: damaged,
    damagedQty: item.damagedQty || 0,
    saleBlocked: Boolean(item.saleBlockedAt),
  };
}

export async function listReturnCandidates({ registrationId, db = prisma }) {
  const registration = await loadRegistration(db, registrationId);
  const map = await computeCandidates(db, registration.id);
  const items = [...map.values()]
    .map(serializeCandidate)
    .filter((c) => c.maxFromStock > 0 || c.maxRejected > 0 || c.maxDamaged > 0);
  return {
    registrationId: registration.id,
    registrationStatus: registration.status,
    suggestedCostPayer: costPayerFor(registration.status === "CANCELLED" ? "PARTICIPATION_CANCELLED" : null, registration),
    items,
  };
}

/* ===================== Validarea liniilor ===================== */

function parseLines(rawLines) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw new FairError(400, "lines_required", "Alege cel puțin un produs pentru retur.");
  }
  if (rawLines.length > MAX_LINES) throw new FairError(400, "too_many_lines", "Prea multe linii într-un singur retur.");

  const seen = new Set();
  return rawLines.map((raw, index) => {
    const inventoryItemId = String(raw?.inventoryItemId || "").trim();
    if (!inventoryItemId) throw new FairError(400, "invalid_line", `Linia ${index + 1} nu are produs.`);
    if (seen.has(inventoryItemId)) {
      throw new FairError(400, "duplicate_lines", "Același produs apare de mai multe ori în retur.", { fields: { [inventoryItemId]: "Duplicat." } });
    }
    seen.add(inventoryItemId);
    const qtyFromStock = parseQty(raw?.qtyFromStock, `${inventoryItemId}.qtyFromStock`);
    const qtyRejected = parseQty(raw?.qtyRejected, `${inventoryItemId}.qtyRejected`);
    const qtyDamaged = parseQty(raw?.qtyDamaged, `${inventoryItemId}.qtyDamaged`);
    if (qtyFromStock + qtyRejected + qtyDamaged < 1) {
      throw new FairError(400, "invalid_quantity", "Fiecare produs din retur trebuie să aibă cel puțin o bucată.", {
        fields: { [inventoryItemId]: "Cantitate 0." },
      });
    }
    return { inventoryItemId, qtyFromStock, qtyRejected, qtyDamaged };
  });
}

function assertLinesAvailable(lines, candidates, reason) {
  const problems = [];
  for (const line of lines) {
    const c = candidates.get(line.inventoryItemId);
    if (!c) {
      problems.push({ id: line.inventoryItemId, reason: "not_returnable" });
      continue;
    }
    if (reason === "RECEPTION_REJECTED" && (line.qtyFromStock > 0 || line.qtyDamaged > 0)) {
      problems.push({ id: line.inventoryItemId, reason: "only_rejected_allowed" });
    }
    if (line.qtyFromStock > c.fromStock) problems.push({ id: line.inventoryItemId, reason: "stock_exceeded", available: c.fromStock });
    if (line.qtyRejected > c.rejected) problems.push({ id: line.inventoryItemId, reason: "rejected_exceeded", available: c.rejected });
    if (line.qtyDamaged > c.damaged) problems.push({ id: line.inventoryItemId, reason: "damaged_exceeded", available: c.damaged });
  }
  if (problems.length) {
    throw new FairError(409, "quantity_exceeds_available", "Unele cantități depășesc ce se poate returna (sau sunt deja într-un alt retur).", {
      problems,
    });
  }
}

async function assertReasonAllowed(db, reason, registration, now) {
  if (reason === "PARTICIPATION_CANCELLED" && registration.status !== "CANCELLED") {
    throw new FairError(409, "registration_not_cancelled", "Participarea nu este anulată.", { currentStatus: registration.status });
  }
  if (reason === "FAIR_ENDED_UNSOLD") {
    if (registration.status !== "APPROVED") {
      throw new FairError(409, "registration_not_approved", "Returul după târg este doar pentru participările aprobate.", {
        currentStatus: registration.status,
      });
    }
    const fair = await db.artfestFair.findUnique({ where: { id: registration.fairId }, select: { endsAt: true } });
    if (!fair?.endsAt || now <= new Date(fair.endsAt)) {
      throw new FairError(409, "fair_not_ended", "Târgul nu s-a încheiat încă.");
    }
  }
}

/* ===================== Serializare ===================== */

async function loadReturnLines(db, returnIds) {
  if (!returnIds.length) return { lines: [], items: new Map() };
  const lines = await db.artfestFairReturnLine.findMany({ where: { returnId: { in: returnIds } }, orderBy: { createdAt: "asc" } });
  const itemIds = [...new Set(lines.map((l) => l.inventoryItemId))];
  const items = itemIds.length ? await db.artfestFairInventoryItem.findMany({ where: { id: { in: itemIds } } }) : [];
  return { lines, items: new Map(items.map((i) => [i.id, i])) };
}

function serializeReturn(ret, lines, items, { forVendor = false, vendorName = null } = {}) {
  const confirmOnBehalfFrom = ret.shippedAt ? new Date(new Date(ret.shippedAt).getTime() + RETURN_ADMIN_CONFIRM_MIN_DAYS * DAY_MS) : null;
  const serializedLines = lines
    .filter((l) => l.returnId === ret.id)
    .map((l) => {
      const item = items.get(l.inventoryItemId) || {};
      const qtyDamaged = l.qtyDamaged || 0;
      // nedeteriorate (vandabile + refuzate): singurele care pot reveni online
      const sentQty = l.qtyFromStock + l.qtyRejected;
      const confirmed = l.vendorReceivedQty != null;
      const difference = confirmed
        ? l.vendorReceivedQty - sentQty + ((l.vendorReceivedDamagedQty ?? 0) - qtyDamaged)
        : null;
      return {
        id: l.id,
        inventoryItemId: l.inventoryItemId,
        title: item.titleSnapshot || null,
        variantLabel: item.variantLabel || null,
        barcodeDisplay: item.barcode ? formatFairBarcode(item.barcode) : null,
        isUnique: Boolean(item.isUnique),
        qtyFromStock: l.qtyFromStock,
        qtyRejected: l.qtyRejected,
        qtyDamaged,
        sentQty,
        sentTotalQty: sentQty + qtyDamaged,
        vendorReceivedQty: l.vendorReceivedQty ?? null,
        vendorReceivedDamagedQty: l.vendorReceivedDamagedQty ?? null,
        restoreOnlineQty: l.restoreOnlineQty ?? null,
        onlineRestoredQty: l.onlineRestoredQty || 0,
        difference,
        note: l.note || null,
        onlineReservationMode: item.onlineReservationMode || "NONE",
        // cât poate reveni online (doar din nedeteriorate; implicit în UI = min(primit, plafon))
        restoreCap: ret.status === "SHIPPED" ? Math.min(sentQty, restoreCap(item)) : null,
      };
    });

  const out = {
    id: ret.id,
    number: ret.number,
    registrationId: ret.registrationId,
    vendorId: ret.vendorId,
    reason: ret.reason,
    costPayer: ret.costPayer,
    method: ret.method,
    status: ret.status,
    courierName: ret.courierName || null,
    trackingNumber: ret.trackingNumber || null,
    shippingCostCents: ret.shippingCostCents ?? null,
    createdAt: ret.createdAt,
    shippedAt: ret.shippedAt || null,
    confirmedAt: ret.confirmedAt || null,
    confirmedByAdmin: Boolean(ret.confirmedByAdmin),
    vendorNote: ret.vendorNote || null,
    cancelledAt: ret.cancelledAt || null,
    // diferențe la confirmare: nu se rezolvă automat
    needsClarification: ret.status === "CONFIRMED_WITH_DIFFERENCES",
    totals: {
      sent: serializedLines.reduce((s, l) => s + l.sentTotalQty, 0),
      sentDamaged: serializedLines.reduce((s, l) => s + l.qtyDamaged, 0),
      received: serializedLines.reduce((s, l) => s + (l.vendorReceivedQty || 0) + (l.vendorReceivedDamagedQty || 0), 0),
      restoredOnline: serializedLines.reduce((s, l) => s + l.onlineRestoredQty, 0),
    },
    lines: serializedLines,
    actions: forVendor
      ? { canConfirm: ret.status === "SHIPPED" }
      : {
          canEdit: ret.status === "PREPARING",
          canCancel: ret.status === "PREPARING",
          canShip: ret.status === "PREPARING",
          canConfirmOnBehalf: ret.status === "SHIPPED",
          confirmOnBehalfFrom,
        },
  };
  if (!forVendor) {
    out.vendorName = vendorName;
    out.adminNotes = ret.adminNotes || null;
    out.confirmationNote = ret.confirmationNote || null;
    out.createdById = ret.createdById || null;
    out.shippedById = ret.shippedById || null;
    out.confirmedById = ret.confirmedById || null;
  }
  return out;
}

async function loadReturnForAdmin(db, id) {
  const ret = await db.artfestFairReturn.findUnique({ where: { id: String(id || "") } });
  if (!ret) throw new FairError(404, "return_not_found", "Returul nu a fost găsit.");
  const { lines, items } = await loadReturnLines(db, [ret.id]);
  const vendor = await db.vendor.findUnique({ where: { id: ret.vendorId }, select: { displayName: true } });
  return serializeReturn(ret, lines, items, { vendorName: vendor?.displayName || null });
}

export async function getReturnForAdmin({ id, db = prisma }) {
  return loadReturnForAdmin(db, id);
}

export async function listReturnsForAdmin({ registrationId = null, status = null, db = prisma } = {}) {
  const fair = await ensureFair(db);
  const where = { fairId: fair.id };
  if (registrationId) where.registrationId = String(registrationId);
  if (status) where.status = String(status);
  const rows = await db.artfestFairReturn.findMany({ where, orderBy: { createdAt: "desc" } });
  const { lines, items } = await loadReturnLines(db, rows.map((r) => r.id));
  const vendorIds = [...new Set(rows.map((r) => r.vendorId))];
  const vendors = vendorIds.length
    ? await db.vendor.findMany({ where: { id: { in: vendorIds } }, select: { id: true, displayName: true } })
    : [];
  const names = new Map(vendors.map((v) => [v.id, v.displayName]));
  return { items: rows.map((r) => serializeReturn(r, lines, items, { vendorName: names.get(r.vendorId) || null })) };
}

export async function listReturnsForVendor({ vendorId, db = prisma }) {
  const fair = await ensureFair(db);
  const rows = await db.artfestFairReturn.findMany({
    where: { fairId: fair.id, vendorId, status: { not: "CANCELLED" } },
    orderBy: { createdAt: "desc" },
  });
  const { lines, items } = await loadReturnLines(db, rows.map((r) => r.id));
  return { items: rows.map((r) => serializeReturn(r, lines, items, { forVendor: true })) };
}

/* ===================== Creare ===================== */

export async function createReturn({ body = {}, adminId, db = prisma, now = new Date() }) {
  const reason = String(body.reason || "").trim();
  const method = String(body.method || "").trim();
  const fields = {};
  if (!RETURN_REASONS.includes(reason)) fields.reason = "Alege motivul returului.";
  if (!RETURN_METHODS.includes(method)) fields.method = "Alege modul de retur.";
  if (Object.keys(fields).length) throw new FairError(400, "invalid_return", "Verifică datele returului.", { fields });

  const lines = parseLines(body.lines);
  const courierName = parseShort(body.courierName, "courierName");
  const trackingNumber = parseShort(body.trackingNumber, "trackingNumber");
  const shippingCostCents = parseShippingCost(body.shippingCostCents);
  const adminNotes = body.note === undefined ? null : cleanText(body.note);

  const requestedPayer = body.costPayer === undefined || body.costPayer === null || body.costPayer === "" ? null : String(body.costPayer);
  if (requestedPayer && !RETURN_COST_PAYERS.includes(requestedPayer)) {
    throw new FairError(400, "invalid_cost_payer", "Cine suportă returul: VENDOR sau ARTFEST.");
  }
  const payerReason = cleanText(body.costPayerReason);

  const created = await db.$transaction(async (tx) => {
    const found = await loadRegistration(tx, body.registrationId);
    await lockRegistration(tx, found.id);
    const registration = await loadRegistration(tx, found.id);

    await assertReasonAllowed(tx, reason, registration, now);

    const derivedPayer = costPayerFor(reason, registration);
    const costPayer = requestedPayer || derivedPayer;
    const overridden = costPayer !== derivedPayer;
    if (overridden && (!payerReason || payerReason.length < 3)) {
      throw new FairError(400, "cost_payer_reason_required", "Motivul schimbării celui care suportă returul este obligatoriu.", {
        fields: { costPayerReason: "Scrie motivul." },
      });
    }

    const candidates = await computeCandidates(tx, registration.id);
    assertLinesAvailable(lines, candidates, reason);

    const fair = await tx.artfestFair.update({
      where: { id: registration.fairId },
      data: { nextVendorReturnNumber: { increment: 1 } },
    });
    const number = fair.nextVendorReturnNumber - 1;

    const overrideNote = overridden ? `Cost retur schimbat manual: ${derivedPayer} → ${costPayer}. Motiv: ${payerReason}` : null;

    const ret = await tx.artfestFairReturn.create({
      data: {
        fairId: registration.fairId,
        registrationId: registration.id,
        vendorId: registration.vendorId,
        number,
        reason,
        costPayer,
        method,
        status: "PREPARING",
        courierName: courierName ?? null,
        trackingNumber: trackingNumber ?? null,
        shippingCostCents: shippingCostCents ?? null,
        adminNotes: [adminNotes, overrideNote].filter(Boolean).join("\n") || null,
        createdById: adminId || null,
      },
    });

    for (const line of lines) {
      await tx.artfestFairReturnLine.create({
        data: { returnId: ret.id, inventoryItemId: line.inventoryItemId, qtyFromStock: line.qtyFromStock, qtyRejected: line.qtyRejected, qtyDamaged: line.qtyDamaged },
      });
      if (overridden) {
        await writeEvent(tx, candidates.get(line.inventoryItemId).item, "ADMIN_NOTE", {
          before: { costPayer: derivedPayer },
          after: { costPayer, returnId: ret.id },
          note: overrideNote,
          actorUserId: adminId || null,
        });
      }
    }
    return ret;
  }, TX_OPTIONS);

  return loadReturnForAdmin(db, created.id);
}

/* ===================== Editare / anulare (doar PREPARING) ===================== */

async function lockReturn(tx, id) {
  const found = await tx.artfestFairReturn.findUnique({ where: { id: String(id || "") }, select: { id: true, registrationId: true } });
  if (!found) throw new FairError(404, "return_not_found", "Returul nu a fost găsit.");
  await lockRegistration(tx, found.registrationId);
  return tx.artfestFairReturn.findUnique({ where: { id: found.id } });
}

function requirePreparing(ret) {
  if (ret.status !== "PREPARING") {
    throw new FairError(409, "return_not_editable", "Returul a fost deja expediat sau anulat.", { currentStatus: ret.status });
  }
}

export async function updateReturn({ id, body = {}, adminId, db = prisma }) {
  const method = body.method === undefined ? undefined : String(body.method || "").trim();
  if (method !== undefined && !RETURN_METHODS.includes(method)) {
    throw new FairError(400, "invalid_return", "Verifică datele returului.", { fields: { method: "Alege modul de retur." } });
  }
  const lines = body.lines === undefined ? undefined : parseLines(body.lines);
  const courierName = parseShort(body.courierName, "courierName");
  const trackingNumber = parseShort(body.trackingNumber, "trackingNumber");
  const shippingCostCents = parseShippingCost(body.shippingCostCents);
  const adminNotes = body.note === undefined ? undefined : cleanText(body.note);

  await db.$transaction(async (tx) => {
    const ret = await lockReturn(tx, id);
    requirePreparing(ret);

    if (lines) {
      const registration = await loadRegistration(tx, ret.registrationId);
      const candidates = await computeCandidates(tx, registration.id, { excludeReturnId: ret.id });
      assertLinesAvailable(lines, candidates, ret.reason);
      await tx.artfestFairReturnLine.deleteMany({ where: { returnId: ret.id } });
      for (const line of lines) {
        await tx.artfestFairReturnLine.create({
          data: { returnId: ret.id, inventoryItemId: line.inventoryItemId, qtyFromStock: line.qtyFromStock, qtyRejected: line.qtyRejected, qtyDamaged: line.qtyDamaged },
        });
      }
    }

    const data = {};
    if (method !== undefined) data.method = method;
    if (courierName !== undefined) data.courierName = courierName;
    if (trackingNumber !== undefined) data.trackingNumber = trackingNumber;
    if (shippingCostCents !== undefined) data.shippingCostCents = shippingCostCents;
    if (adminNotes !== undefined) data.adminNotes = adminNotes;
    if (Object.keys(data).length) {
      const res = await tx.artfestFairReturn.updateMany({ where: { id: ret.id, status: "PREPARING" }, data });
      if (res.count !== 1) throw new FairError(409, "return_not_editable", "Returul s-a modificat între timp.");
    }
    void adminId;
  }, TX_OPTIONS);

  return loadReturnForAdmin(db, id);
}

export async function cancelReturn({ id, reason = null, adminId, db = prisma, now = new Date() }) {
  const note = cleanText(reason);
  await db.$transaction(async (tx) => {
    const ret = await lockReturn(tx, id);
    requirePreparing(ret);
    const res = await tx.artfestFairReturn.updateMany({
      where: { id: ret.id, status: "PREPARING" },
      data: { status: "CANCELLED", cancelledAt: now, cancelledById: adminId || null },
    });
    if (res.count !== 1) throw new FairError(409, "return_not_editable", "Returul s-a modificat între timp.");

    // stocul nu se atinge: returul nu a plecat
    const lines = await tx.artfestFairReturnLine.findMany({ where: { returnId: ret.id } });
    const items = await tx.artfestFairInventoryItem.findMany({ where: { id: { in: lines.map((l) => l.inventoryItemId) } } });
    for (const item of items) {
      await writeEvent(tx, item, "RETURN_CANCELLED", { after: { returnId: ret.id, number: ret.number }, note, actorUserId: adminId || null });
    }
  }, TX_OPTIONS);

  return loadReturnForAdmin(db, id);
}

/* ===================== Expediere / predare ===================== */

async function findReplayMovement(tx, key) {
  return tx.artfestFairStockMovement.findFirst({ where: { idempotencyKey: { startsWith: `${key}:` } } });
}

export async function shipReturn({ id, body = {}, idempotencyKey, adminId, db = prisma, now = new Date() }) {
  const key = requireIdempotencyKey(idempotencyKey);
  const courierName = parseShort(body.courierName, "courierName");
  const trackingNumber = parseShort(body.trackingNumber, "trackingNumber");
  const shippingCostCents = parseShippingCost(body.shippingCostCents);

  const replayed = await db.$transaction(async (tx) => {
    const ret = await lockReturn(tx, id);

    const previous = await findReplayMovement(tx, key);
    if (previous) {
      const line = previous.returnLineId
        ? await tx.artfestFairReturnLine.findUnique({ where: { id: previous.returnLineId }, select: { returnId: true } })
        : null;
      if (line?.returnId !== ret.id) {
        throw new FairError(409, "idempotency_conflict", "Cheia operației a fost folosită pentru altă operație.");
      }
      return true;
    }
    requirePreparing(ret);

    const lines = (await tx.artfestFairReturnLine.findMany({ where: { returnId: ret.id } })).sort((a, b) =>
      a.inventoryItemId < b.inventoryItemId ? -1 : 1
    );
    if (!lines.length) throw new FairError(409, "lines_required", "Returul nu are produse.");
    for (const line of lines) await lockLine(tx, line.inventoryItemId);

    // revalidare pe contoarele curente (recepție / deteriorare pot fi rulat între timp)
    const problems = [];
    const items = new Map();
    for (const line of lines) {
      const item = await tx.artfestFairInventoryItem.findUnique({ where: { id: line.inventoryItemId } });
      items.set(line.inventoryItemId, item);
      if (!item || item.registrationId !== ret.registrationId) {
        problems.push({ id: line.inventoryItemId, reason: "not_returnable" });
        continue;
      }
      if (line.qtyFromStock > 0 && (item.status !== "RECEIVED" || line.qtyFromStock > item.availableQty)) {
        problems.push({ id: item.id, reason: "stock_exceeded", available: item.status === "RECEIVED" ? item.availableQty : 0 });
      }
      const rejectedPending = (item.rejectedQty || 0) - (item.rejectedReturnedQty || 0);
      if (line.qtyRejected > rejectedPending) problems.push({ id: item.id, reason: "rejected_exceeded", available: rejectedPending });
      const damaged = damagedPending(item);
      if ((line.qtyDamaged || 0) > damaged) problems.push({ id: item.id, reason: "damaged_exceeded", available: damaged });
    }
    if (problems.length) {
      throw new FairError(409, "quantity_exceeds_available", "Cantitățile s-au schimbat între timp. Corectează returul.", { problems });
    }

    for (const line of lines) {
      const item = items.get(line.inventoryItemId);
      const qtyDamaged = line.qtyDamaged || 0;
      // deterioratele ies din custodia Artfest fără să atingă availableQty (deja scăzut la DAMAGED)
      const res = await tx.artfestFairInventoryItem.updateMany({
        where: {
          id: item.id,
          availableQty: item.availableQty,
          rejectedReturnedQty: item.rejectedReturnedQty,
          damagedReturnedQty: item.damagedReturnedQty || 0,
        },
        data: {
          availableQty: { decrement: line.qtyFromStock },
          returnedQty: { increment: line.qtyFromStock },
          rejectedReturnedQty: { increment: line.qtyRejected },
          damagedReturnedQty: { increment: qtyDamaged },
        },
      });
      if (res.count !== 1) throw new FairError(409, "inventory_conflict", "Stocul s-a modificat între timp. Încearcă din nou.");

      const base = { inventoryItemId: item.id, fairId: item.fairId, vendorId: item.vendorId, actorUserId: adminId || null, returnLineId: line.id };
      if (line.qtyFromStock > 0) {
        await tx.artfestFairStockMovement.create({
          data: { ...base, type: "RETURNED_TO_VENDOR", quantity: line.qtyFromStock, reason: `Retur #${ret.number}`, idempotencyKey: movementKey(key, line.id, "S") },
        });
      }
      if (line.qtyRejected > 0) {
        await tx.artfestFairStockMovement.create({
          data: { ...base, type: "REJECTED_RETURNED_TO_VENDOR", quantity: line.qtyRejected, reason: `Retur #${ret.number}`, idempotencyKey: movementKey(key, line.id, "R") },
        });
      }
      if (qtyDamaged > 0) {
        await tx.artfestFairStockMovement.create({
          data: {
            ...base,
            type: "DAMAGED_RETURNED_TO_VENDOR",
            quantity: qtyDamaged,
            reason: `Retur #${ret.number} – returnat deteriorat`,
            idempotencyKey: movementKey(key, line.id, "D"),
          },
        });
      }
    }

    const data = { status: "SHIPPED", shippedAt: now, shippedById: adminId || null };
    if (ret.method !== "PICKUP") {
      if (courierName !== undefined) data.courierName = courierName;
      if (trackingNumber !== undefined) data.trackingNumber = trackingNumber;
    }
    if (shippingCostCents !== undefined) data.shippingCostCents = shippingCostCents;
    const res = await tx.artfestFairReturn.updateMany({ where: { id: ret.id, status: "PREPARING" }, data });
    if (res.count !== 1) throw new FairError(409, "return_not_editable", "Returul s-a modificat între timp.");
    // stocul ONLINE nu se atinge la expediere: produsele nu sunt încă la vendor
    return false;
  }, TX_OPTIONS);

  return { replayed, item: await loadReturnForAdmin(db, id) };
}

/* ===================== Confirmarea primirii + restaurare online ===================== */

function parseConfirmLines(rawLines, returnLines) {
  if (!Array.isArray(rawLines)) throw new FairError(400, "lines_required", "Confirmă fiecare produs din retur.");
  const byId = new Map(returnLines.map((l) => [l.id, l]));
  const seen = new Set();
  const parsed = [];
  for (const raw of rawLines) {
    const id = String(raw?.returnLineId || "").trim();
    const line = byId.get(id);
    if (!line) throw new FairError(400, "invalid_line", "Produsul nu face parte din acest retur.");
    if (seen.has(id)) throw new FairError(400, "duplicate_lines", "Același produs apare de mai multe ori.");
    seen.add(id);
    // nedeteriorate (vandabile + refuzate) și deteriorate se confirmă separat
    const sent = line.qtyFromStock + line.qtyRejected;
    const sentDamaged = line.qtyDamaged || 0;
    const missing = (v) => v === undefined || v === null || v === "";
    if (sent > 0 && missing(raw?.receivedQty)) {
      throw new FairError(400, "received_qty_required", "Completează cantitatea primită pentru fiecare produs.", { fields: { [id]: "Obligatoriu." } });
    }
    if (sentDamaged > 0 && missing(raw?.receivedDamagedQty)) {
      throw new FairError(400, "received_damaged_qty_required", "Completează câte bucăți deteriorate ai primit.", {
        fields: { [id]: "Obligatoriu pentru bucățile deteriorate." },
      });
    }
    const receivedQty = missing(raw?.receivedQty) ? 0 : parseQty(raw.receivedQty, `${id}.receivedQty`);
    const receivedDamagedQty = missing(raw?.receivedDamagedQty) ? 0 : parseQty(raw.receivedDamagedQty, `${id}.receivedDamagedQty`);
    if (receivedQty > sent) {
      throw new FairError(400, "received_exceeds_sent", "Nu poți confirma mai mult decât s-a trimis.", { fields: { [id]: `Maximum ${sent}.` } });
    }
    if (receivedDamagedQty > sentDamaged) {
      throw new FairError(400, "received_exceeds_sent", "Nu poți confirma mai multe bucăți deteriorate decât s-au trimis.", {
        fields: { [id]: `Deteriorate: maximum ${sentDamaged}.` },
      });
    }
    const restoreOnlineQty =
      raw?.restoreOnlineQty === undefined || raw?.restoreOnlineQty === null || raw?.restoreOnlineQty === ""
        ? null
        : parseQty(raw.restoreOnlineQty, `${id}.restoreOnlineQty`);
    let note = null;
    try {
      note = cleanText(raw?.note, 1000);
    } catch {
      throw new FairError(400, "text_too_long", "Observația poate avea maximum 1000 de caractere.", { fields: { [id]: "Prea lung." } });
    }
    parsed.push({ line, sent, sentDamaged, receivedQty, receivedDamagedQty, restoreOnlineQty, note });
  }
  if (parsed.length !== returnLines.length) {
    throw new FairError(400, "lines_incomplete", "Confirmă fiecare produs din retur (și cu 0, dacă nu a ajuns).");
  }
  return parsed;
}

async function restoreOnline(tx, item, qty, { actorUserId, now, returnId }) {
  if (qty <= 0) return { restored: 0, itemData: {} };

  const product = item.productId
    ? await tx.product.findUnique({ where: { id: item.productId }, select: { id: true, readyQty: true, availability: true } })
    : null;

  if (item.onlineReservationMode === "TRANSFERRED") {
    const res = product
      ? await tx.product.updateMany({
          // aceeași regulă ca stockRestore: doar produse încă urmărite pe stoc
          where: { id: product.id, readyQty: { not: null }, availability: { in: ["READY", "SOLD_OUT"] } },
          data: { readyQty: { increment: qty }, availability: "READY" },
        })
      : { count: 0 };
    if (res.count === 1) {
      await writeEvent(tx, item, "ONLINE_STOCK_RESTORED", {
        before: { readyQty: product.readyQty, availability: product.availability },
        after: { readyQty: product.readyQty + qty, availability: "READY", restoredQty: qty, returnId },
        actorUserId,
      });
      return { restored: qty, itemData: {} };
    }
    await writeEvent(tx, item, "ONLINE_RESTORE_SKIPPED", {
      before: product ? { readyQty: product.readyQty, availability: product.availability } : null,
      after: { wantedQty: qty, returnId },
      note: product ? "product_no_longer_stock_tracked" : "product_deleted",
      actorUserId,
    });
    return { restored: 0, itemData: {} };
  }

  if (item.onlineReservationMode === "FORCED_UNAVAILABLE") {
    const prevReadyQty = item.onlinePrevReadyQty;
    const forcedReadyQty = prevReadyQty === null || prevReadyQty === undefined ? null : 0;
    const deferred = item.onlineDeferredRestoreQty || 0;
    const nextReadyQty = forcedReadyQty === null ? null : prevReadyQty + deferred;
    let nextAvailability = item.onlinePrevAvailability || "READY";
    if (nextAvailability === "SOLD_OUT" && nextReadyQty !== null && nextReadyQty > 0) nextAvailability = "READY";

    // sigur doar dacă produsul e încă exact în starea impusă de Artfest
    const res = product
      ? await tx.product.updateMany({
          where: { id: product.id, availability: "SOLD_OUT", readyQty: forcedReadyQty },
          data: { availability: nextAvailability, readyQty: nextReadyQty },
        })
      : { count: 0 };
    if (res.count === 1) {
      await writeEvent(tx, item, "ONLINE_STOCK_RESTORED", {
        before: { availability: "SOLD_OUT", readyQty: forcedReadyQty },
        after: { availability: nextAvailability, readyQty: nextReadyQty, deferredRestored: deferred, returnId },
        actorUserId,
      });
      return { restored: 1, itemData: { onlineRestoredAt: now } };
    }
    await writeEvent(tx, item, "ONLINE_RESTORE_SKIPPED", {
      before: product ? { availability: product.availability, readyQty: product.readyQty } : null,
      after: { wanted: { availability: nextAvailability, readyQty: nextReadyQty }, returnId },
      note: product ? "product_changed_since_reservation" : "product_deleted",
      actorUserId,
    });
    return { restored: 0, itemData: {} };
  }

  return { restored: 0, itemData: {} };
}

/*
 * actor: { type: "vendor", vendorId, userId } | { type: "admin", userId, reason }
 */
export async function confirmReturn({ id, body = {}, idempotencyKey, actor, db = prisma, now = new Date() }) {
  const key = requireIdempotencyKey(idempotencyKey);
  const byAdmin = actor.type === "admin";
  const adminReason = byAdmin ? cleanText(body.reason) : null;
  if (byAdmin && (!adminReason || adminReason.length < 3)) {
    throw new FairError(400, "reason_required", "Motivul confirmării în numele vendorului este obligatoriu.", {
      fields: { reason: "Scrie motivul." },
    });
  }
  let vendorNote = null;
  if (!byAdmin) {
    try {
      vendorNote = cleanText(body.note, 1000);
    } catch {
      throw new FairError(400, "text_too_long", "Observația poate avea maximum 1000 de caractere.");
    }
  }

  const replayed = await db.$transaction(async (tx) => {
    const found = await tx.artfestFairReturn.findUnique({ where: { id: String(id || "") }, select: { id: true, vendorId: true, registrationId: true } });
    // vendorul vede doar retururile proprii (altfel 404, fără să confirmăm existența)
    if (!found || (!byAdmin && found.vendorId !== actor.vendorId)) {
      throw new FairError(404, "return_not_found", "Returul nu a fost găsit.");
    }
    const ret = await lockReturn(tx, found.id);
    const returnLines = await tx.artfestFairReturnLine.findMany({ where: { returnId: ret.id } });

    if (CONFIRMED_STATUSES.includes(ret.status)) {
      const previous = await tx.artfestFairInventoryEvent.findFirst({
        where: {
          type: "VENDOR_RETURN_CONFIRMED",
          inventoryItemId: { in: returnLines.map((l) => l.inventoryItemId) },
          after: { path: ["idempotencyKey"], equals: key },
        },
      });
      if (previous) return true;
      throw new FairError(409, "already_confirmed", "Primirea acestui retur a fost deja confirmată.", { currentStatus: ret.status });
    }
    if (ret.status !== "SHIPPED") {
      throw new FairError(409, "return_not_shipped", "Returul nu a fost încă expediat.", { currentStatus: ret.status });
    }
    if (byAdmin) {
      const allowedFrom = new Date(new Date(ret.shippedAt).getTime() + RETURN_ADMIN_CONFIRM_MIN_DAYS * DAY_MS);
      if (now < allowedFrom) {
        throw new FairError(
          409,
          "confirm_too_early",
          `Confirmarea în numele vendorului e posibilă abia după ${RETURN_ADMIN_CONFIRM_MIN_DAYS} zile de la expediere.`,
          { item: { allowedFrom } }
        );
      }
    }

    const parsed = parseConfirmLines(body.lines, returnLines);

    // lock-uri: produse (sortat), apoi linii (sortat)
    const itemIds = [...new Set(returnLines.map((l) => l.inventoryItemId))].sort();
    const itemsBefore = await tx.artfestFairInventoryItem.findMany({ where: { id: { in: itemIds } } });
    const productIds = [...new Set(itemsBefore.map((i) => i.productId).filter(Boolean))].sort();
    for (const productId of productIds) await lockProductForFair(tx, productId);
    for (const itemId of itemIds) await lockLine(tx, itemId);

    // validare restoreOnlineQty (după lock-uri, pe valorile curente)
    const fieldErrors = {};
    for (const entry of parsed) {
      const item = await tx.artfestFairInventoryItem.findUnique({ where: { id: entry.line.inventoryItemId } });
      entry.item = item;
      // plafonul ține cont DOAR de bucățile nedeteriorate primite
      const cap = Math.min(entry.receivedQty, restoreCap(item));
      if (entry.restoreOnlineQty === null) entry.restoreOnlineQty = cap; // implicit: tot ce s-a primit și e eligibil
      if (entry.restoreOnlineQty > 0 && entry.sent === 0) {
        fieldErrors[entry.line.id] = "Bucățile deteriorate nu pot fi readăugate în stocul online.";
      } else if (entry.restoreOnlineQty > entry.receivedQty) {
        fieldErrors[entry.line.id] = "Nu poți readăuga online mai mult decât ai primit (fără bucățile deteriorate).";
      } else if (entry.restoreOnlineQty > cap) fieldErrors[entry.line.id] = `Poți readăuga online cel mult ${cap}.`;
    }
    if (Object.keys(fieldErrors).length) {
      throw new FairError(400, "invalid_restore_qty", "Cantitatea de readăugat online este prea mare.", { fields: fieldErrors });
    }

    const actorUserId = actor.userId || null;
    let differences = false;

    for (const entry of parsed) {
      const { line, item, receivedQty, sent, receivedDamagedQty, sentDamaged } = entry;
      if (receivedQty !== sent || receivedDamagedQty !== sentDamaged) differences = true;

      const { restored, itemData } =
        entry.restoreOnlineQty > 0
          ? await restoreOnline(tx, item, entry.restoreOnlineQty, { actorUserId, now, returnId: ret.id })
          : { restored: 0, itemData: {} };
      if (entry.restoreOnlineQty === 0 && restoreCap(item) > 0 && receivedQty > 0) {
        await writeEvent(tx, item, "ONLINE_RESTORE_SKIPPED", {
          after: { wantedQty: 0, returnId: ret.id },
          note: "vendor_declined",
          actorUserId,
        });
      }

      await tx.artfestFairReturnLine.update({
        where: { id: line.id },
        data: {
          vendorReceivedQty: receivedQty,
          vendorReceivedDamagedQty: sentDamaged > 0 ? receivedDamagedQty : null,
          restoreOnlineQty: entry.restoreOnlineQty,
          onlineRestoredQty: restored,
          note: entry.note,
        },
      });

      await tx.artfestFairInventoryItem.update({
        where: { id: item.id },
        data: {
          // total primit fizic (inclusiv deteriorate); restaurarea online rămâne doar pe nedeteriorate
          vendorReturnReceivedQty: (item.vendorReturnReceivedQty || 0) + receivedQty + receivedDamagedQty,
          vendorReturnConfirmedAt: now,
          vendorReturnConfirmedById: actorUserId,
          onlineRestoredQty: (item.onlineRestoredQty || 0) + restored,
          ...itemData,
        },
      });

      await writeEvent(tx, item, "VENDOR_RETURN_CONFIRMED", {
        before: { vendorReturnReceivedQty: item.vendorReturnReceivedQty ?? null },
        after: {
          returnId: ret.id,
          returnNumber: ret.number,
          sentQty: sent,
          receivedQty,
          // explicit: bucăți returnate deteriorate (nu revin online)
          returnedDamagedQty: sentDamaged,
          receivedDamagedQty,
          restoreOnlineQty: entry.restoreOnlineQty,
          restoredQty: restored,
          byAdmin,
          idempotencyKey: key,
        },
        note: [byAdmin ? adminReason : entry.note, sentDamaged > 0 ? `Returnat deteriorat: ${sentDamaged}` : null]
          .filter(Boolean)
          .join(" · ") || null,
        actorUserId,
      });
    }

    const res = await tx.artfestFairReturn.updateMany({
      where: { id: ret.id, status: "SHIPPED" },
      data: {
        status: differences ? "CONFIRMED_WITH_DIFFERENCES" : "CONFIRMED",
        confirmedAt: now,
        confirmedById: actorUserId,
        confirmedByAdmin: byAdmin,
        confirmationNote: byAdmin ? adminReason : null,
        vendorNote: byAdmin ? null : vendorNote,
      },
    });
    if (res.count !== 1) throw new FairError(409, "already_confirmed", "Returul s-a modificat între timp.");

    await closeSettledLines(tx, itemIds, { actorUserId, now });
    return false;
  }, TX_OPTIONS);

  const item = byAdmin
    ? await loadReturnForAdmin(db, id)
    : (await listReturnsForVendor({ vendorId: actor.vendorId, db })).items.find((r) => r.id === String(id)) || null;
  return { replayed, item };
}

/*
 * O linie devine CLOSED doar când nu mai e nimic fizic în custodia Artfest:
 * stoc 0, toate refuzatele și toate deterioratele returnate, fără retur
 * SHIPPED neconfirmat (o bucată deteriorată e închisă doar după ce a fost
 * returnată ȘI confirmată; nu există altă „soluționare”).
 * La închidere, rezervarea online se consideră încheiată (onlineRestoredAt).
 */
async function closeSettledLines(tx, itemIds, { actorUserId, now }) {
  const lines = await tx.artfestFairReturnLine.findMany({ where: { inventoryItemId: { in: itemIds } } });
  const shipped = lines.length
    ? await tx.artfestFairReturn.findMany({
        where: { id: { in: [...new Set(lines.map((l) => l.returnId))] }, status: "SHIPPED" },
        select: { id: true },
      })
    : [];
  const openReturnIds = new Set(shipped.map((r) => r.id));

  for (const itemId of itemIds) {
    const item = await tx.artfestFairInventoryItem.findUnique({ where: { id: itemId } });
    if (!item || !RETURNABLE_STATUSES.includes(item.status)) continue;
    const openReturn = lines.some((l) => l.inventoryItemId === itemId && openReturnIds.has(l.returnId));
    const settled =
      (item.availableQty || 0) === 0 &&
      (item.rejectedReturnedQty || 0) >= (item.rejectedQty || 0) &&
      (item.damagedReturnedQty || 0) >= (item.damagedQty || 0) &&
      !openReturn;
    if (!settled) continue;

    const res = await tx.artfestFairInventoryItem.updateMany({
      where: { id: item.id, status: item.status },
      data: {
        status: "CLOSED",
        closedAt: now,
        ...(item.onlineReservationMode !== "NONE" && !item.onlineRestoredAt && !item.onlineReleasedAt ? { onlineRestoredAt: now } : {}),
      },
    });
    if (res.count === 1) {
      await writeEvent(tx, item, "STATUS_CHANGED", {
        before: { status: item.status },
        after: { status: "CLOSED" },
        note: "return_settled",
        actorUserId,
      });
    }
  }
}
