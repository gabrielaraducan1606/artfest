// backend/src/services/artfestFairPosService.js
//
// Târgul Artfest - POS intern (MVP): scanare -> coș -> CASH / CARD ->
// vânzare atomică -> stoc (SOLD) -> comision -> net vendor.
//
// Retururile clienților: services/artfestFairSaleReturnService.js.
// NU conține: casă de marcat / bon fiscal / factură,
// decont, terminal POS extern. receiptReference (ex. TA26-000123) e o
// referință INTERNĂ, nu bon fiscal.
//
// Toate sumele în bani întregi (RON × 100). Prețul, reducerea, comisionul și
// netul vendorului se calculează EXCLUSIV pe server (clientul trimite doar
// inventoryItemId + quantity + metoda de plată).
//
// Formule (schema POS, D8 a):
//   lineListCents        = listUnitPriceCents × quantity           (listUnit = priceSnapshotCents)
//   lineDiscountCents    = PERCENT: round_half_up(lineList × percentBps / 10000)
//                          FIXED_AMOUNT (per bucată): min(amountCents × quantity, lineList)
//   lineGrossCents       = lineList − lineDiscount
//   effectiveUnitPrice   = floor(lineGross / quantity)
//   commissionCents      = round_half_up(lineGross × commissionBps / 10000)
//   commissionOnList     = round_half_up(lineList × commissionBps / 10000)
//   VENDOR:  artfestFunded = 0;  vendorNet = lineGross − commission
//   ARTFEST: vendorNet = lineList − commissionOnList (vendor neutru);
//            artfestFunded = max(0, (lineList − commissionOnList) − (lineGross − commission))
//
// Lock-uri (aceeași ordine ca recepția / returul): târgul (POS), apoi liniile
// de inventar sortate; liniile și înscrierile se recitesc după lock.

import crypto from "node:crypto";
import { prisma } from "../db.js";
import { FairError, ensureFair } from "./artfestFairService.js";
import { formatFairBarcode } from "./artfestFairInventoryService.js";
import { cleanText, lockLine, normalizeScannedBarcode, requireIdempotencyKey } from "./artfestFairReceptionService.js";
import { notifyVendorsDailySales } from "./artfestFairNotifications.js";

const BARCODE_RE = /^AF[2-9ABCDEFGHJKMNPQRSTVWX]{8}$/;
const MAX_LINES = 100;
const MAX_QTY = 1000;
const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };
export const POS_PAYMENT_METHODS = Object.freeze(["CASH", "CARD"]);

export const SALE_BLOCK_MESSAGES = Object.freeze({
  sales_closed: "Vânzările la târg nu sunt deschise.",
  other_fair: "Produsul nu aparține târgului activ.",
  registration_inactive: "Participarea vendorului nu mai este activă.",
  not_received: "Produsul nu a fost recepționat (nu este în stocul târgului).",
  sale_blocked: "Produs blocat de la vânzare.",
  product_missing: "Produsul nu mai există pe Artfest.",
  product_not_approved: "Produsul nu mai este aprobat pe Artfest (moderare).",
  product_inactive: "Produsul nu mai este activ pe Artfest.",
  product_hidden: "Produsul este ascuns pe Artfest.",
  product_quote_only: "Produsul este doar la cerere de ofertă pe Artfest.",
  label_missing: "Eticheta lipsește.",
  label_outdated: "Prețul de pe etichetă nu mai corespunde.",
  insufficient_stock: "Stoc insuficient.",
});

/* ===================== Utilitare ===================== */

// round_half_up(a / b) pentru a >= 0, b > 0 (bani întregi)
export function roundHalfUpDiv(a, b) {
  return Math.floor((2 * a + b) / (2 * b));
}

async function lockFairPos(tx, fairId) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`artfest-fair-pos:${fairId}`}))`;
}

export function receiptReferenceFor(saleNumber, date = new Date()) {
  const yy = String(date.getUTCFullYear()).slice(-2);
  return `TA${yy}-${String(saleNumber).padStart(6, "0")}`;
}

function parseCartLines(rawLines) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw new FairError(400, "cart_empty", "Coșul este gol.");
  }
  if (rawLines.length > MAX_LINES) throw new FairError(400, "cart_too_large", "Prea multe produse într-o singură vânzare.");
  // același produs scanat de mai multe ori => o singură linie, cu cantitățile adunate
  const merged = new Map();
  for (const raw of rawLines) {
    const id = String(raw?.inventoryItemId || "").trim();
    const qty = Number(raw?.quantity);
    if (!id) throw new FairError(400, "invalid_line", "Linie de coș invalidă.");
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      throw new FairError(400, "invalid_quantity", "Cantitate invalidă.", { fields: { [id]: "Introdu un număr întreg ≥ 1." } });
    }
    merged.set(id, (merged.get(id) || 0) + qty);
  }
  return [...merged.entries()].map(([inventoryItemId, quantity]) => ({ inventoryItemId, quantity })).sort((a, b) =>
    a.inventoryItemId < b.inventoryItemId ? -1 : 1
  );
}

// hash canonic al cererii (aceeași cheie + alt conținut => 409)
export function requestHashFor(lines, paymentMethod, notes) {
  const canonical = JSON.stringify({
    lines: lines.map((l) => [l.inventoryItemId, l.quantity]),
    paymentMethod,
    notes: notes || null,
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/* ===================== Garda de vânzare ===================== */

/*
 * Eligibilitatea produsului pe Artfest (regulile publice ale târgului, cap. 4.4):
 * există, activ, vizibil, aprobat la moderare, nu doar la cerere de ofertă.
 * NU se verifică disponibilitatea online (availability / readyQty): un unicat
 * rezervat pentru târg (FORCED_UNAVAILABLE -> SOLD_OUT online) sau un stoc
 * transferat la târg (TRANSFERRED -> readyQty 0) rămâne vandabil la stand.
 */
export function productBlockReasons(product) {
  if (!product) return ["product_missing"];
  const reasons = [];
  if (product.moderationStatus !== "APPROVED") reasons.push("product_not_approved");
  if (product.isActive !== true) reasons.push("product_inactive");
  if (product.isHidden === true) reasons.push("product_hidden");
  if (product.orderMode === "QUOTE_ONLY") reasons.push("product_quote_only");
  return reasons;
}

/*
 * Toate condițiile trebuie îndeplinite; NU există override (etichetă, produs).
 * heldQty = bucăți rezervate în retururi către vendor încă în pregătire.
 */
export function saleBlockReasons({ fair, line, registrationStatus, product, quantity = 1, heldQty = 0 }) {
  const reasons = [];
  if (!fair?.salesOpen) reasons.push("sales_closed");
  if (line.fairId !== fair?.id) reasons.push("other_fair");
  if (registrationStatus !== "APPROVED") reasons.push("registration_inactive");
  if (line.status !== "RECEIVED") reasons.push("not_received");
  if (line.saleBlockedAt) reasons.push("sale_blocked");
  reasons.push(...productBlockReasons(product));
  if (!line.labelGeneratedAt || line.labelPriceCents == null) reasons.push("label_missing");
  else if (line.labelPriceCents !== line.priceSnapshotCents) reasons.push("label_outdated");
  const sellableQty = Math.max(0, (line.availableQty || 0) - heldQty);
  if (line.status === "RECEIVED" && sellableQty < quantity) reasons.push("insufficient_stock");
  return reasons;
}

/* ===================== Reduceri + calcul ===================== */

function discountApplies(discount, line, now) {
  if (discount.status !== "ACTIVE" || discount.fairId !== line.fairId) return false;
  if (discount.startsAt && new Date(discount.startsAt) > now) return false;
  if (discount.endsAt && new Date(discount.endsAt) <= now) return false;
  if (discount.scope === "INVENTORY_ITEM") return discount.inventoryItemId === line.id;
  if (discount.scope === "VENDOR") return discount.vendorId === line.vendorId;
  return false;
}

function discountAmount(discount, listUnitPriceCents, quantity) {
  const lineList = listUnitPriceCents * quantity;
  if (!discount) return 0;
  // FIXED_AMOUNT = reducere per bucată, plafonată la valoarea liniei
  const raw =
    discount.type === "PERCENT"
      ? roundHalfUpDiv(lineList * discount.percentBps, 10000)
      : Math.min(discount.amountCents * quantity, lineList);
  return Math.max(0, Math.min(raw, lineList));
}

const time = (v) => (v ? new Date(v).getTime() : 0);

/*
 * D2: cel mult o reducere pe linie. Dacă sunt eligibile mai multe:
 *   1. INVENTORY_ITEM înaintea VENDOR;
 *   2. în același scope, cea mai mare reducere pentru client (pe linia dată);
 *   3. la egalitate: createdAt crescător, apoi id - același coș dă mereu același rezultat.
 */
export function pickDiscount(discounts, line, quantity, now = new Date()) {
  const applicable = discounts.filter((d) => discountApplies(d, line, now));
  if (!applicable.length) return null;
  const rank = (d) => (d.scope === "INVENTORY_ITEM" ? 0 : 1);
  return [...applicable].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    const diff = discountAmount(b, line.priceSnapshotCents, quantity) - discountAmount(a, line.priceSnapshotCents, quantity);
    if (diff !== 0) return diff;
    const created = time(a.createdAt) - time(b.createdAt);
    if (created !== 0) return created;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0];
}

export function computeLine({ listUnitPriceCents, quantity, commissionBps, discount = null }) {
  const lineListCents = listUnitPriceCents * quantity;
  const lineDiscountCents = discountAmount(discount, listUnitPriceCents, quantity);
  const lineGrossCents = lineListCents - lineDiscountCents;
  const effectiveUnitPriceCents = Math.floor(lineGrossCents / quantity);
  const commissionCents = roundHalfUpDiv(lineGrossCents * commissionBps, 10000);
  const commissionOnListCents = roundHalfUpDiv(lineListCents * commissionBps, 10000);
  const vendorNetAfterDiscount = lineGrossCents - commissionCents;

  let artfestFundedDiscountCents = 0;
  if (discount && lineDiscountCents > 0 && discount.fundingSource === "ARTFEST") {
    const vendorNetWithoutDiscount = lineListCents - commissionOnListCents;
    artfestFundedDiscountCents = Math.max(0, vendorNetWithoutDiscount - vendorNetAfterDiscount);
  }

  return {
    listUnitPriceCents,
    quantity,
    lineListCents,
    lineDiscountCents,
    lineGrossCents,
    effectiveUnitPriceCents,
    commissionBps,
    commissionCents,
    commissionOnListCents,
    artfestFundedDiscountCents,
    vendorNetCents: vendorNetAfterDiscount + artfestFundedDiscountCents,
  };
}

function discountSnapshot(d) {
  return d
    ? {
        id: d.id,
        name: d.name,
        type: d.type,
        percentBps: d.percentBps ?? null,
        amountCents: d.amountCents ?? null,
        scope: d.scope,
        fundingSource: d.fundingSource,
      }
    : null;
}

function summarize(computed) {
  const totals = { listCents: 0, discountCents: 0, totalPaidCents: 0, commissionCents: 0, vendorNetCents: 0, artfestFundedDiscountCents: 0 };
  const byVendor = new Map();
  for (const c of computed) {
    totals.listCents += c.lineListCents;
    totals.discountCents += c.lineDiscountCents;
    totals.totalPaidCents += c.lineGrossCents;
    totals.commissionCents += c.commissionCents;
    totals.vendorNetCents += c.vendorNetCents;
    totals.artfestFundedDiscountCents += c.artfestFundedDiscountCents;
    const v = byVendor.get(c.vendorId) || {
      vendorId: c.vendorId,
      vendorName: c.vendorName || null,
      listCents: 0,
      discountCents: 0,
      grossCents: 0,
      commissionCents: 0,
      vendorNetCents: 0,
      artfestFundedDiscountCents: 0,
      units: 0,
    };
    v.listCents += c.lineListCents;
    v.discountCents += c.lineDiscountCents;
    v.grossCents += c.lineGrossCents;
    v.commissionCents += c.commissionCents;
    v.vendorNetCents += c.vendorNetCents;
    v.artfestFundedDiscountCents += c.artfestFundedDiscountCents;
    v.units += c.quantity;
    byVendor.set(c.vendorId, v);
  }
  return { totals, vendors: [...byVendor.values()] };
}

/* ===================== Încărcarea contextului ===================== */

async function loadFairForPos(db) {
  const base = await ensureFair(db);
  return db.artfestFair.findUnique({
    where: { id: base.id },
    select: { id: true, key: true, title: true, salesOpen: true, commissionBps: true, nextSaleNumber: true },
  });
}

// bucăți rezervate în retururi către vendor încă în pregătire (nu se mai vând)
async function heldInPreparingReturns(db, itemIds) {
  const map = new Map();
  if (!itemIds.length) return map;
  const lines = await db.artfestFairReturnLine.findMany({ where: { inventoryItemId: { in: itemIds } } });
  if (!lines.length) return map;
  const preparing = await db.artfestFairReturn.findMany({
    where: { id: { in: [...new Set(lines.map((l) => l.returnId))] }, status: "PREPARING" },
    select: { id: true },
  });
  const ids = new Set(preparing.map((r) => r.id));
  for (const l of lines) if (ids.has(l.returnId)) map.set(l.inventoryItemId, (map.get(l.inventoryItemId) || 0) + l.qtyFromStock);
  return map;
}

async function loadContext(db, fair, itemIds, now) {
  const items = await db.artfestFairInventoryItem.findMany({ where: { id: { in: itemIds } } });
  const byId = new Map(items.map((i) => [i.id, i]));
  const registrationIds = [...new Set(items.map((i) => i.registrationId))];
  const vendorIds = [...new Set(items.map((i) => i.vendorId))];
  const productIds = [...new Set(items.map((i) => i.productId).filter(Boolean))];
  const [registrations, vendors, discounts, held, products] = await Promise.all([
    registrationIds.length
      ? db.artfestFairRegistration.findMany({ where: { id: { in: registrationIds } }, select: { id: true, status: true } })
      : [],
    vendorIds.length ? db.vendor.findMany({ where: { id: { in: vendorIds } }, select: { id: true, displayName: true } }) : [],
    db.artfestFairDiscount.findMany({ where: { fairId: fair.id, status: "ACTIVE" } }),
    heldInPreparingReturns(db, itemIds),
    productIds.length
      ? db.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, moderationStatus: true, isActive: true, isHidden: true, orderMode: true },
        })
      : [],
  ]);
  void now;
  return {
    byId,
    registrations: new Map(registrations.map((r) => [r.id, r.status])),
    vendors: new Map(vendors.map((v) => [v.id, v.displayName])),
    products: new Map(products.map((p) => [p.id, p])),
    discounts,
    held,
  };
}

/*
 * Calculează coșul pe server. Întoarce liniile calculate și problemele
 * (motive de blocare) pe fiecare linie; nu scrie nimic.
 */
function priceCart(fair, cart, ctx, now) {
  const problems = [];
  const computed = [];
  for (const entry of cart) {
    const line = ctx.byId.get(entry.inventoryItemId);
    if (!line) {
      problems.push({ inventoryItemId: entry.inventoryItemId, reasons: ["not_found"], messages: ["Produsul nu există în inventarul târgului."] });
      continue;
    }
    const reasons = saleBlockReasons({
      fair,
      line,
      registrationStatus: ctx.registrations.get(line.registrationId),
      product: line.productId ? ctx.products.get(line.productId) || null : null,
      quantity: entry.quantity,
      heldQty: ctx.held.get(line.id) || 0,
    });
    if (reasons.length) {
      problems.push({ inventoryItemId: line.id, title: line.titleSnapshot, reasons, messages: reasons.map((r) => SALE_BLOCK_MESSAGES[r]) });
    }
    const discount = pickDiscount(ctx.discounts, line, entry.quantity, now);
    const c = computeLine({
      listUnitPriceCents: line.priceSnapshotCents,
      quantity: entry.quantity,
      commissionBps: fair.commissionBps,
      discount,
    });
    computed.push({
      ...c,
      inventoryItemId: line.id,
      vendorId: line.vendorId,
      vendorName: ctx.vendors.get(line.vendorId) || null,
      title: line.titleSnapshot,
      variantLabel: line.variantLabel || null,
      barcodeDisplay: formatFairBarcode(line.barcode),
      discount: discountSnapshot(discount),
      discountEntity: discount,
      line,
      sellable: reasons.length === 0,
    });
  }
  return { computed, problems };
}

function publicLine(c) {
  // eslint-disable-next-line no-unused-vars
  const { discountEntity, line, ...rest } = c;
  return rest;
}

/* ===================== Deschiderea vânzărilor ===================== */

export async function getPosStatus({ db = prisma } = {}) {
  const fair = await loadFairForPos(db);
  return { salesOpen: Boolean(fair.salesOpen), commissionBps: fair.commissionBps, fairTitle: fair.title };
}

export async function setSalesOpen({ open, adminId, db = prisma }) {
  if (typeof open !== "boolean") {
    throw new FairError(400, "invalid_sales_open", "Spune dacă vânzările se deschid sau se închid.");
  }
  const fair = await loadFairForPos(db);
  await db.artfestFair.update({ where: { id: fair.id }, data: { salesOpen: open } });
  void adminId;
  return getPosStatus({ db });
}

/* ===================== Scanare ===================== */

export async function scanBarcode({ barcode, db = prisma, now = new Date() }) {
  const code = normalizeScannedBarcode(barcode);
  if (!BARCODE_RE.test(code)) {
    throw new FairError(404, "barcode_not_found", "Codul scanat nu există în inventarul târgului.");
  }
  const fair = await loadFairForPos(db);
  const line = await db.artfestFairInventoryItem.findUnique({ where: { barcode: code } });
  if (!line) throw new FairError(404, "barcode_not_found", "Codul scanat nu există în inventarul târgului.");

  const ctx = await loadContext(db, fair, [line.id], now);
  const heldQty = ctx.held.get(line.id) || 0;
  const reasons = saleBlockReasons({
    fair,
    line,
    registrationStatus: ctx.registrations.get(line.registrationId),
    product: line.productId ? ctx.products.get(line.productId) || null : null,
    quantity: 1,
    heldQty,
  });
  const discount = pickDiscount(ctx.discounts, line, 1, now);
  const unit = computeLine({ listUnitPriceCents: line.priceSnapshotCents, quantity: 1, commissionBps: fair.commissionBps, discount });

  return {
    inventoryItemId: line.id,
    barcode: line.barcode,
    barcodeDisplay: formatFairBarcode(line.barcode),
    title: line.titleSnapshot,
    variantLabel: line.variantLabel || null,
    imageUrl: line.imageUrlSnapshot || null,
    vendor: { id: line.vendorId, name: ctx.vendors.get(line.vendorId) || null },
    priceCents: line.priceSnapshotCents,
    unitPriceAfterDiscountCents: unit.lineGrossCents,
    discount: discountSnapshot(discount),
    availableQty: Math.max(0, (line.availableQty || 0) - heldQty),
    sellable: reasons.length === 0,
    reasons,
    messages: reasons.map((r) => SALE_BLOCK_MESSAGES[r]),
  };
}

/* ===================== Preview ===================== */

export async function previewSale({ body = {}, db = prisma, now = new Date() }) {
  const cart = parseCartLines(body.lines);
  const fair = await loadFairForPos(db);
  const ctx = await loadContext(db, fair, cart.map((l) => l.inventoryItemId), now);
  const { computed, problems } = priceCart(fair, cart, ctx, now);
  const { totals, vendors } = summarize(computed);
  return {
    canConfirm: problems.length === 0,
    problems,
    lines: computed.map(publicLine),
    totals,
    vendors,
    commissionBps: fair.commissionBps,
  };
}

/* ===================== Vânzarea ===================== */

function serializeSaleRow(sale, lines = [], allocations = [], movements = []) {
  return {
    id: sale.id,
    saleNumber: sale.saleNumber,
    receiptReference: sale.receiptReference,
    // referință internă - NU bon fiscal
    fiscal: false,
    status: sale.status,
    currency: sale.currency,
    listCents: sale.listCents,
    discountCents: sale.discountCents,
    totalPaidCents: sale.totalPaidCents,
    commissionCents: sale.commissionCents,
    vendorNetCents: sale.vendorNetCents,
    paymentMethod: sale.paymentMethod,
    cashCents: sale.cashCents ?? null,
    cardCents: sale.cardCents ?? null,
    soldAt: sale.soldAt,
    voidedAt: sale.voidedAt || null,
    createdById: sale.createdById,
    notes: sale.notes || null,
    lines: lines.map((l) => ({
      id: l.id,
      inventoryItemId: l.inventoryItemId,
      vendorId: l.vendorId,
      title: l.titleSnapshot,
      variantLabel: l.variantLabel || null,
      barcode: l.barcodeSnapshot,
      barcodeDisplay: formatFairBarcode(l.barcodeSnapshot),
      quantity: l.quantity,
      listUnitPriceCents: l.listUnitPriceCents,
      lineListCents: l.lineListCents,
      lineDiscountCents: l.lineDiscountCents,
      lineGrossCents: l.lineGrossCents,
      effectiveUnitPriceCents: l.effectiveUnitPriceCents,
      commissionBps: l.commissionBps,
      commissionCents: l.commissionCents,
      commissionOnListCents: l.commissionOnListCents,
      artfestFundedDiscountCents: l.artfestFundedDiscountCents,
      vendorNetCents: l.vendorNetCents,
      returnedQty: l.returnedQty || 0,
      discount: allocations.find((a) => a.saleLineId === l.id)?.snapshot || null,
      movements: movements.filter((m) => m.saleLineId === l.id).map((m) => ({ id: m.id, type: m.type, quantity: m.quantity })),
    })),
  };
}

async function loadSale(db, saleId) {
  const sale = await db.artfestFairSale.findUnique({ where: { id: saleId } });
  if (!sale) throw new FairError(404, "sale_not_found", "Vânzarea nu a fost găsită.");
  const lines = await db.artfestFairSaleLine.findMany({ where: { saleId: sale.id }, orderBy: { createdAt: "asc" } });
  const lineIds = lines.map((l) => l.id);
  const [allocations, movements, vendors] = await Promise.all([
    lineIds.length ? db.artfestFairSaleLineDiscount.findMany({ where: { saleLineId: { in: lineIds } } }) : [],
    lineIds.length ? db.artfestFairStockMovement.findMany({ where: { saleLineId: { in: lineIds } } }) : [],
    db.vendor.findMany({ where: { id: { in: [...new Set(lines.map((l) => l.vendorId))] } }, select: { id: true, displayName: true } }),
  ]);
  const out = serializeSaleRow(sale, lines, allocations, movements);
  const names = new Map(vendors.map((v) => [v.id, v.displayName]));
  for (const l of out.lines) l.vendorName = names.get(l.vendorId) || null;
  out.vendors = summarizeSaleLines(out.lines);
  // retururile / anularea vânzării (clienți)
  const returns = await db.artfestFairSaleReturn.findMany({ where: { saleId: sale.id }, orderBy: { createdAt: "asc" } });
  const returnLines = returns.length
    ? await db.artfestFairSaleReturnLine.findMany({ where: { returnId: { in: returns.map((r) => r.id) } } })
    : [];
  out.returns = returns.map((r) => ({
    id: r.id,
    type: r.type,
    reference: r.reference,
    reason: r.reason,
    refundMethod: r.refundMethod,
    refundCents: r.refundCents,
    commissionReversedCents: r.commissionReversedCents,
    artfestFundedReversedCents: r.artfestFundedReversedCents,
    vendorNetReversedCents: r.vendorNetReversedCents,
    createdAt: r.createdAt,
    lines: returnLines
      .filter((l) => l.returnId === r.id)
      .map((l) => ({
        id: l.id,
        saleLineId: l.saleLineId,
        quantity: l.quantity,
        disposition: l.disposition,
        conditionNote: l.conditionNote || null,
        // cine suportă rambursarea (NOT_RESTOCKED / NOT_RETURNED) + motivul intern (doar Admin)
        refundResponsibility: l.refundResponsibility || null,
        responsibilityReason: l.responsibilityReason || null,
        refundCents: l.refundCents,
        commissionReversedCents: l.commissionReversedCents,
        artfestFundedReversedCents: l.artfestFundedReversedCents,
        vendorNetReversedCents: l.vendorNetReversedCents,
        vendorAffected: l.refundResponsibility !== "ARTFEST",
        vendorNetImpactCents: l.refundResponsibility === "ARTFEST" ? 0 : l.vendorNetReversedCents,
        artfestBorneRefundCents: l.refundResponsibility === "ARTFEST" ? l.refundCents : 0,
      })),
  }));
  out.refundedCents = returns.reduce((sum, r) => sum + r.refundCents, 0);
  out.actions = {
    canVoid: sale.status === "COMPLETED" && lines.every((l) => !l.returnedQty),
    canReturn: ["COMPLETED", "PARTIALLY_RETURNED"].includes(sale.status),
  };
  return out;
}

function summarizeSaleLines(lines) {
  const map = new Map();
  for (const l of lines) {
    const v = map.get(l.vendorId) || { vendorId: l.vendorId, vendorName: l.vendorName || null, grossCents: 0, commissionCents: 0, vendorNetCents: 0, artfestFundedDiscountCents: 0, units: 0 };
    v.grossCents += l.lineGrossCents;
    v.commissionCents += l.commissionCents;
    v.vendorNetCents += l.vendorNetCents;
    v.artfestFundedDiscountCents += l.artfestFundedDiscountCents;
    v.units += l.quantity;
    map.set(l.vendorId, v);
  }
  return [...map.values()];
}

export async function getSale({ id, db = prisma }) {
  return loadSale(db, String(id || ""));
}

export async function listSales({ limit = 50, db = prisma } = {}) {
  const fair = await ensureFair(db);
  const rows = await db.artfestFairSale.findMany({
    where: { fairId: fair.id },
    orderBy: { saleNumber: "desc" },
    take: Math.min(Math.max(Number(limit) || 50, 1), 200),
  });
  const lines = rows.length
    ? await db.artfestFairSaleLine.findMany({ where: { saleId: { in: rows.map((r) => r.id) } } })
    : [];
  const vendorIds = [...new Set(lines.map((l) => l.vendorId))];
  const vendors = vendorIds.length ? await db.vendor.findMany({ where: { id: { in: vendorIds } }, select: { id: true, displayName: true } }) : [];
  const names = new Map(vendors.map((v) => [v.id, v.displayName]));
  return {
    items: rows.map((s) => {
      const own = lines.filter((l) => l.saleId === s.id);
      return {
        id: s.id,
        saleNumber: s.saleNumber,
        receiptReference: s.receiptReference,
        soldAt: s.soldAt,
        totalPaidCents: s.totalPaidCents,
        paymentMethod: s.paymentMethod,
        status: s.status,
        units: own.reduce((sum, l) => sum + l.quantity, 0),
        returnedUnits: own.reduce((sum, l) => sum + (l.returnedQty || 0), 0),
        vendors: [...new Set(own.map((l) => names.get(l.vendorId) || l.vendorId))],
      };
    }),
  };
}

async function findSaleByKey(db, key) {
  return db.artfestFairSale.findUnique({ where: { idempotencyKey: key }, select: { id: true, requestHash: true } });
}

export async function createSale({ body = {}, idempotencyKey, adminId, db = prisma, now = new Date() }) {
  const key = requireIdempotencyKey(idempotencyKey);
  const cart = parseCartLines(body.lines);
  const paymentMethod = String(body.paymentMethod || "").trim();
  if (!POS_PAYMENT_METHODS.includes(paymentMethod)) {
    throw new FairError(400, "invalid_payment_method", "Alege metoda de plată: numerar sau card.", {
      fields: { paymentMethod: "CASH sau CARD." },
    });
  }
  const notes = cleanText(body.note);
  const requestHash = requestHashFor(cart, paymentMethod, notes);

  // retry / dublu click: aceeași cheie => aceeași vânzare (sau 409 dacă s-a schimbat conținutul)
  const replay = async () => {
    const existing = await findSaleByKey(db, key);
    if (!existing) return null;
    if (existing.requestHash !== requestHash) {
      throw new FairError(409, "idempotency_conflict", "Cheia operației a fost folosită pentru o altă vânzare.");
    }
    return { replayed: true, sale: await loadSale(db, existing.id) };
  };
  const early = await replay();
  if (early) return early;

  let saleId;
  let replayedInTx = false;
  try {
    saleId = await db.$transaction(async (tx) => {
      const base = await ensureFair(tx);
      // 1. lock pe târg (serializează vânzările și numerotarea)
      await lockFairPos(tx, base.id);

      const again = await findSaleByKey(tx, key);
      if (again) {
        if (again.requestHash !== requestHash) {
          throw new FairError(409, "idempotency_conflict", "Cheia operației a fost folosită pentru o altă vânzare.");
        }
        replayedInTx = true;
        return again.id;
      }

      // 2. salesOpen recitit sub lock
      const fair = await tx.artfestFair.findUnique({
        where: { id: base.id },
        select: { id: true, salesOpen: true, commissionBps: true, nextSaleNumber: true },
      });
      if (!fair.salesOpen) throw new FairError(409, "sales_closed", SALE_BLOCK_MESSAGES.sales_closed);

      // 3. lock pe linii, sortat; 4. recitire după lock
      const itemIds = cart.map((l) => l.inventoryItemId);
      for (const id of itemIds) await lockLine(tx, id);
      const ctx = await loadContext(tx, fair, itemIds, now);

      // 5-6. garda + calculul pe server; orice linie invalidă => nimic nu se scrie
      const { computed, problems } = priceCart(fair, cart, ctx, now);
      if (problems.length) {
        throw new FairError(409, "cart_not_sellable", "Unele produse nu pot fi vândute.", { problems });
      }
      const { totals } = summarize(computed);

      // numerotare în aceeași tranzacție
      const updatedFair = await tx.artfestFair.update({
        where: { id: fair.id },
        data: { nextSaleNumber: { increment: 1 } },
        select: { nextSaleNumber: true },
      });
      const saleNumber = updatedFair.nextSaleNumber - 1;

      const sale = await tx.artfestFairSale.create({
        data: {
          fairId: fair.id,
          saleNumber,
          receiptReference: receiptReferenceFor(saleNumber, now),
          status: "COMPLETED",
          currency: "RON",
          listCents: totals.listCents,
          discountCents: totals.discountCents,
          totalPaidCents: totals.totalPaidCents,
          commissionCents: totals.commissionCents,
          vendorNetCents: totals.vendorNetCents,
          paymentMethod,
          // Artfest încasează integral; împărțirea pe vendor e contabilă (linii / decont)
          cashCents: paymentMethod === "CASH" ? totals.totalPaidCents : null,
          cardCents: paymentMethod === "CARD" ? totals.totalPaidCents : null,
          idempotencyKey: key,
          requestHash,
          soldAt: now,
          createdById: adminId,
          notes,
        },
      });

      for (const c of computed) {
        const line = c.line;
        const saleLine = await tx.artfestFairSaleLine.create({
          data: {
            saleId: sale.id,
            fairId: fair.id,
            inventoryItemId: line.id,
            vendorId: line.vendorId,
            productId: line.productId || null,
            titleSnapshot: line.titleSnapshot,
            variantLabel: line.variantLabel || null,
            variantSnapshot: line.variantSnapshot ?? undefined,
            barcodeSnapshot: line.barcode,
            quantity: c.quantity,
            listUnitPriceCents: c.listUnitPriceCents,
            lineListCents: c.lineListCents,
            lineDiscountCents: c.lineDiscountCents,
            lineGrossCents: c.lineGrossCents,
            effectiveUnitPriceCents: c.effectiveUnitPriceCents,
            commissionBps: c.commissionBps,
            commissionCents: c.commissionCents,
            commissionOnListCents: c.commissionOnListCents,
            vendorNetCents: c.vendorNetCents,
            artfestFundedDiscountCents: c.artfestFundedDiscountCents,
          },
        });

        if (c.discountEntity && c.lineDiscountCents > 0) {
          await tx.artfestFairSaleLineDiscount.create({
            data: { saleLineId: saleLine.id, discountId: c.discountEntity.id, amountCents: c.lineDiscountCents, snapshot: c.discount },
          });
        }

        // stocul scade DOAR acum, după validarea completă a coșului
        const res = await tx.artfestFairInventoryItem.updateMany({
          where: { id: line.id, status: "RECEIVED", saleBlockedAt: null, availableQty: line.availableQty },
          data: { availableQty: { decrement: c.quantity }, soldQty: { increment: c.quantity } },
        });
        if (res.count !== 1) throw new FairError(409, "inventory_conflict", "Stocul s-a modificat între timp. Încearcă din nou.");

        await tx.artfestFairStockMovement.create({
          data: {
            inventoryItemId: line.id,
            fairId: fair.id,
            vendorId: line.vendorId,
            type: "SOLD",
            quantity: c.quantity,
            saleLineId: saleLine.id,
            actorUserId: adminId,
            reason: `Vânzare ${sale.receiptReference}`,
            idempotencyKey: `sale:${sale.id}:${saleLine.id}`,
          },
        });
      }

      return sale.id;
    }, TX_OPTIONS);
  } catch (error) {
    // două cereri simultane cu aceeași cheie: a doua lovește unicitatea
    if (error?.code === "P2002") {
      const replayed = await replay();
      if (replayed) return replayed;
    }
    throw error;
  }

  // sumarul zilnic al vendorilor implicați (o notificare / vendor / zi), după commit
  if (!replayedInTx) await notifyVendorsDailySales({ saleId, db });

  return { replayed: replayedInTx, sale: await loadSale(db, saleId) };
}
