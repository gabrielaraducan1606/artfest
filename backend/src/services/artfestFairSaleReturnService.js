// backend/src/services/artfestFairSaleReturnService.js
//
// Târgul Artfest - retururi / rambursări către clienți (MVP), doar ADMIN:
//
//   VOID   - anularea integrală a unei vânzări COMPLETED fără nimic returnat;
//            toate bucățile revin în stocul târgului (RESTOCKED).
//   RETURN - retur ulterior, integral sau parțial, pe linii / cantități, cu
//            disposition explicit pe fiecare linie:
//              RESTOCKED     - bucata e înapoi și vandabilă: SALE_REVERSED, availableQty crește;
//                              fără responsabil (returul se tratează normal, afectează vendorul).
//              NOT_RESTOCKED - bucata e înapoi, dar nevandabilă: SALE_REVERSED + DAMAGED,
//                              availableQty NU crește;
//              NOT_RETURNED  - rambursare fără produs: fără mișcare de stoc.
//            Pentru NOT_RESTOCKED și NOT_RETURNED Admin alege EXPLICIT cine suportă
//            rambursarea (refundResponsibility VENDOR / ARTFEST) + motiv intern obligatoriu:
//              VENDOR  - vendorNetReversedCents scade din netul vendorului;
//              ARTFEST - vendorul rămâne neafectat; refundCents e suportat de Artfest.
//            Sumele inversate se păstrează integral pe linie (audit), indiferent de responsabil.
//
// NU conține: decont, fiscalizare, casă de marcat, factură, plata către vendor.
//
// Sumele inversate (bani întregi) - alocare deterministă pe bucăți, fixată în
// schema POS: pentru un total T al liniei și Q bucăți, bucata i (0-based)
// primește floor(T / Q) + (i < T % Q ? 1 : 0). Un retur inversează următoarele
// bucăți nereturnate, începând de la saleLine.returnedQty. Se aplică separat
// pe lineGrossCents, commissionCents și artfestFundedDiscountCents; netul
// vendorului inversat = refund − commission + artfestFunded. Suma tuturor
// retururilor unei linii = exact valorile liniei (fără diferențe de 1 ban).
//
// Tranzacție (aceeași ordine de lock-uri ca vânzarea): târgul (POS), vânzarea,
// liniile de inventar sortate; recitire după lock; orice eroare => rollback.
//
// Idempotență: Idempotency-Key obligatoriu. Schema nu are requestHash pe retur,
// așa că payload-ul canonic se reconstruiește din returul salvat (tip, vânzare,
// motiv, metodă, linii cu responsabil) și se compară cu cererea: același
// conținut => replay, alt conținut => 409.

import crypto from "node:crypto";
import { prisma } from "../db.js";
import { FAIR_TX_OPTIONS } from "../config/artfestFair.js";
import { FairError, ensureFair } from "./artfestFairService.js";
import { cleanText, lockLine, requireIdempotencyKey } from "./artfestFairReceptionService.js";
import { POS_PAYMENT_METHODS, getSale } from "./artfestFairPosService.js";

export const RETURN_DISPOSITIONS = Object.freeze(["RESTOCKED", "NOT_RESTOCKED", "NOT_RETURNED"]);
export const REFUND_RESPONSIBILITIES = Object.freeze(["VENDOR", "ARTFEST"]);
// dispozițiile pentru care Admin alege cine suportă rambursarea (CHECK AFSRL_responsibility_chk)
export const RESPONSIBILITY_REQUIRED = Object.freeze(new Set(["NOT_RESTOCKED", "NOT_RETURNED"]));
const MAX_LINES = 100;
const MIN_REASON = 3;

export const DISPOSITION_LABEL = Object.freeze({
  RESTOCKED: "Returnat, revandabil",
  NOT_RESTOCKED: "Returnat, nevandabil",
  NOT_RETURNED: "Rambursare fără produs",
});

// o linie de retur afectează netul vendorului dacă nu e suportată de Artfest
export function affectsVendor(line) {
  return line.refundResponsibility !== "ARTFEST";
}

/* ===================== Utilitare ===================== */

async function lockFairPos(tx, fairId) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`artfest-fair-pos:${fairId}`}))`;
}

async function lockSale(tx, saleId) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`artfest-fair-sale:${saleId}`}))`;
}

export function returnReferenceFor(returnNumber, date = new Date()) {
  const yy = String(date.getUTCFullYear()).slice(-2);
  return `RT${yy}-${String(returnNumber).padStart(6, "0")}`;
}

/*
 * Suma bucăților [from, from + qty) dintr-un total împărțit determinist pe
 * `quantity` bucăți: bucata i = floor(total / quantity) + (i < total % quantity).
 */
export function allocateUnits(total, quantity, from, qty) {
  const base = Math.floor(total / quantity);
  const rest = total % quantity;
  const extra = Math.max(0, Math.min(from + qty, rest) - Math.min(from, rest));
  return base * qty + extra;
}

// sumele inversate pentru `qty` bucăți ale liniei, începând de la bucata `from`
export function reversedAmounts(saleLine, from, qty) {
  const refundCents = allocateUnits(saleLine.lineGrossCents, saleLine.quantity, from, qty);
  const commissionReversedCents = allocateUnits(saleLine.commissionCents, saleLine.quantity, from, qty);
  const artfestFundedReversedCents = allocateUnits(saleLine.artfestFundedDiscountCents || 0, saleLine.quantity, from, qty);
  return {
    refundCents,
    commissionReversedCents,
    artfestFundedReversedCents,
    vendorNetReversedCents: refundCents - commissionReversedCents + artfestFundedReversedCents,
  };
}

function requireReason(value) {
  const reason = cleanText(value, 1000);
  if (!reason || reason.length < MIN_REASON) {
    throw new FairError(400, "reason_required", "Scrie motivul returului.", { fields: { reason: "Minimum 3 caractere." } });
  }
  return reason;
}

function parseRefundMethod(value) {
  const method = String(value || "").trim();
  if (!POS_PAYMENT_METHODS.includes(method)) {
    throw new FairError(400, "invalid_refund_method", "Alege metoda de rambursare: numerar sau card.", {
      fields: { refundMethod: "CASH sau CARD." },
    });
  }
  return method;
}

const DISPOSITION_ORDER = { RESTOCKED: 0, NOT_RESTOCKED: 1, NOT_RETURNED: 2 };
const RESPONSIBILITY_ORDER = { "": 0, VENDOR: 1, ARTFEST: 2 };

function compareLines(a, b) {
  if (a.saleLineId !== b.saleLineId) return a.saleLineId < b.saleLineId ? -1 : 1;
  if (a.disposition !== b.disposition) return DISPOSITION_ORDER[a.disposition] - DISPOSITION_ORDER[b.disposition];
  return RESPONSIBILITY_ORDER[a.refundResponsibility || ""] - RESPONSIBILITY_ORDER[b.refundResponsibility || ""];
}

/*
 * Liniile cererii, normalizate și în ordine canonică (saleLineId, disposition, responsabil).
 * strict=false doar la preview: sumele se arată înainte de alegerea responsabilului / motivului.
 */
function parseReturnLines(rawLines, { strict = true } = {}) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw new FairError(400, "return_empty", "Alege cel puțin un produs de returnat.");
  }
  if (rawLines.length > MAX_LINES) throw new FairError(400, "return_too_large", "Prea multe linii într-un singur retur.");
  const merged = new Map();
  for (const raw of rawLines) {
    const saleLineId = String(raw?.saleLineId || "").trim();
    const quantity = Number(raw?.quantity);
    const disposition = String(raw?.disposition || "").trim();
    if (!saleLineId) throw new FairError(400, "invalid_line", "Linie de retur invalidă.");
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new FairError(400, "invalid_quantity", "Cantitate invalidă.", { fields: { [saleLineId]: "Introdu un număr întreg ≥ 1." } });
    }
    if (!RETURN_DISPOSITIONS.includes(disposition)) {
      throw new FairError(400, "invalid_disposition", "Alege starea produsului returnat.", {
        fields: { [saleLineId]: "RESTOCKED, NOT_RESTOCKED sau NOT_RETURNED." },
      });
    }
    const conditionNote = cleanText(raw?.conditionNote, 1000);
    const rawResponsibility = String(raw?.refundResponsibility || "").trim();
    const responsibilityReason = cleanText(raw?.responsibilityReason, 1000);
    let refundResponsibility = null;

    if (RESPONSIBILITY_REQUIRED.has(disposition)) {
      if (rawResponsibility && !REFUND_RESPONSIBILITIES.includes(rawResponsibility)) {
        throw new FairError(400, "invalid_responsibility", "Alege cine suportă rambursarea: vendor sau Artfest.", {
          fields: { [saleLineId]: "VENDOR sau ARTFEST." },
        });
      }
      refundResponsibility = rawResponsibility || null;
      if (strict && !refundResponsibility) {
        throw new FairError(400, "responsibility_required", "Alege cine suportă rambursarea: vendor sau Artfest.", {
          fields: { [saleLineId]: "VENDOR sau ARTFEST." },
        });
      }
      if (strict && (!responsibilityReason || responsibilityReason.length < MIN_REASON)) {
        throw new FairError(400, "responsibility_reason_required", "Scrie motivul pentru cine suportă rambursarea.", {
          fields: { [saleLineId]: "Minimum 3 caractere." },
        });
      }
    } else if (rawResponsibility || responsibilityReason) {
      // RESTOCKED: produsul revine vandabil, returul se tratează normal - fără responsabil
      throw new FairError(400, "responsibility_not_allowed", "Pentru produsele revandabile nu se alege cine suportă rambursarea.", {
        fields: { [saleLineId]: "Fără responsabil la RESTOCKED." },
      });
    }

    const key = `${saleLineId}|${disposition}|${refundResponsibility || ""}`;
    const prev = merged.get(key);
    if (prev && (prev.conditionNote !== conditionNote || prev.responsibilityReason !== (refundResponsibility ? responsibilityReason : null))) {
      throw new FairError(400, "duplicate_line", "Aceeași linie apare de două ori cu note diferite.");
    }
    merged.set(key, {
      saleLineId,
      disposition,
      quantity: (prev?.quantity || 0) + quantity,
      conditionNote,
      refundResponsibility,
      responsibilityReason: refundResponsibility ? responsibilityReason : null,
    });
  }
  return [...merged.values()].sort(compareLines);
}

function canonicalHash({ type, saleId, reason, refundMethod, lines }) {
  const canonical = JSON.stringify({
    type,
    saleId,
    reason,
    refundMethod,
    lines:
      type === "VOID"
        ? []
        : lines.map((l) => [l.saleLineId, l.disposition, l.quantity, l.conditionNote || null, l.refundResponsibility || null, l.responsibilityReason || null]),
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

// hash-ul unui retur salvat (pentru replay / conflict)
async function storedHash(db, saleReturn) {
  const lines = await db.artfestFairSaleReturnLine.findMany({ where: { returnId: saleReturn.id } });
  const merged = new Map();
  for (const l of lines) {
    const key = `${l.saleLineId}|${l.disposition}|${l.refundResponsibility || ""}`;
    const prev = merged.get(key);
    merged.set(key, {
      saleLineId: l.saleLineId,
      disposition: l.disposition,
      quantity: (prev?.quantity || 0) + l.quantity,
      conditionNote: l.conditionNote || null,
      refundResponsibility: l.refundResponsibility || null,
      responsibilityReason: l.responsibilityReason || null,
    });
  }
  return canonicalHash({
    type: saleReturn.type,
    saleId: saleReturn.saleId,
    reason: saleReturn.reason,
    refundMethod: saleReturn.type === "VOID" ? null : saleReturn.refundMethod,
    lines: [...merged.values()].sort(compareLines),
  });
}

/* ===================== Planul returului (fără scriere) ===================== */

/*
 * Calculează returul pe datele curente (sau recitite sub lock): validări,
 * sume inversate pe bucăți, impactul pe vendor / Artfest, efect pe stoc.
 * Nu scrie nimic.
 */
function planReturn({ type, sale, saleLines, items, requestLines }) {
  if (sale.status === "VOIDED") throw new FairError(409, "sale_voided", "Vânzarea este deja anulată.");
  if (type === "VOID") {
    if (sale.status !== "COMPLETED" || saleLines.some((l) => l.returnedQty > 0)) {
      throw new FairError(409, "void_not_allowed", "Vânzarea are deja produse returnate; folosește returul pentru restul.");
    }
  } else if (sale.status === "RETURNED") {
    throw new FairError(409, "sale_fully_returned", "Toate produsele vânzării au fost deja returnate.");
  }

  const byId = new Map(saleLines.map((l) => [l.id, l]));
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const consumed = new Map(); // bucăți deja alocate în acest retur, pe linie / pe produs
  const problems = [];
  const lines = [];

  for (const req of requestLines) {
    const saleLine = byId.get(req.saleLineId);
    if (!saleLine) {
      problems.push({ saleLineId: req.saleLineId, title: null, messages: ["Linia nu aparține acestei vânzări."] });
      continue;
    }
    const used = consumed.get(saleLine.id) || 0;
    const from = saleLine.returnedQty + used;
    const remaining = saleLine.quantity - from;
    const messages = [];
    if (req.quantity > remaining) {
      messages.push(remaining > 0 ? `Se mai pot returna cel mult ${remaining} buc.` : "Toate bucățile acestei linii au fost deja returnate.");
    }
    const item = itemsById.get(saleLine.inventoryItemId);
    if (req.disposition === "RESTOCKED" && item?.status !== "RECEIVED") {
      messages.push("Produsul nu mai este în stocul activ al târgului; alege „Returnat, nevandabil” sau „Rambursare fără produs”.");
    }
    if (req.disposition !== "NOT_RETURNED" && (item?.soldQty ?? 0) < (consumed.get(`sold:${item?.id}`) || 0) + req.quantity) {
      messages.push("Stocul vândut al produsului nu corespunde; verifică vânzarea.");
    }
    if (messages.length) {
      problems.push({ saleLineId: saleLine.id, title: saleLine.titleSnapshot, messages });
      continue;
    }
    consumed.set(saleLine.id, used + req.quantity);
    if (req.disposition !== "NOT_RETURNED") consumed.set(`sold:${item.id}`, (consumed.get(`sold:${item.id}`) || 0) + req.quantity);
    const amounts = reversedAmounts(saleLine, from, req.quantity);
    const vendorAffected = affectsVendor(req);
    lines.push({
      saleLine,
      item,
      quantity: req.quantity,
      disposition: req.disposition,
      conditionNote: req.conditionNote || null,
      refundResponsibility: req.refundResponsibility || null,
      responsibilityReason: req.responsibilityReason || null,
      fromUnit: from,
      ...amounts,
      vendorAffected,
      // ce scade efectiv din netul vendorului / ce suportă Artfest (sumele inversate rămân integral pe linie)
      vendorNetImpactCents: vendorAffected ? amounts.vendorNetReversedCents : 0,
      artfestBorneRefundCents: req.refundResponsibility === "ARTFEST" ? amounts.refundCents : 0,
    });
  }

  const totals = lines.reduce(
    (t, l) => ({
      units: t.units + l.quantity,
      refundCents: t.refundCents + l.refundCents,
      commissionReversedCents: t.commissionReversedCents + l.commissionReversedCents,
      artfestFundedReversedCents: t.artfestFundedReversedCents + l.artfestFundedReversedCents,
      vendorNetReversedCents: t.vendorNetReversedCents + l.vendorNetReversedCents,
      vendorNetImpactCents: t.vendorNetImpactCents + l.vendorNetImpactCents,
      artfestBorneRefundCents: t.artfestBorneRefundCents + l.artfestBorneRefundCents,
    }),
    { units: 0, refundCents: 0, commissionReversedCents: 0, artfestFundedReversedCents: 0, vendorNetReversedCents: 0, vendorNetImpactCents: 0, artfestBorneRefundCents: 0 }
  );

  // statusul vânzării după retur
  const returnedAfter = new Map(saleLines.map((l) => [l.id, l.returnedQty + (consumed.get(l.id) || 0)]));
  const fully = saleLines.every((l) => returnedAfter.get(l.id) === l.quantity);
  const nextStatus = type === "VOID" ? "VOIDED" : fully ? "RETURNED" : "PARTIALLY_RETURNED";

  return { lines, totals, problems, nextStatus };
}

function stockEffect(disposition, quantity) {
  if (disposition === "RESTOCKED") return { availableDelta: quantity, damagedDelta: 0, movements: ["SALE_REVERSED"] };
  if (disposition === "NOT_RESTOCKED") return { availableDelta: 0, damagedDelta: quantity, movements: ["SALE_REVERSED", "DAMAGED"] };
  return { availableDelta: 0, damagedDelta: 0, movements: [] };
}

function publicPlan(plan, refundMethod) {
  return {
    canConfirm: plan.problems.length === 0,
    problems: plan.problems,
    refundMethod,
    nextStatus: plan.nextStatus,
    totals: plan.totals,
    lines: plan.lines.map((l) => ({
      saleLineId: l.saleLine.id,
      vendorId: l.saleLine.vendorId,
      title: l.saleLine.titleSnapshot,
      variantLabel: l.saleLine.variantLabel || null,
      quantity: l.quantity,
      disposition: l.disposition,
      refundResponsibility: l.refundResponsibility,
      responsibilityRequired: RESPONSIBILITY_REQUIRED.has(l.disposition),
      refundCents: l.refundCents,
      commissionReversedCents: l.commissionReversedCents,
      artfestFundedReversedCents: l.artfestFundedReversedCents,
      vendorNetReversedCents: l.vendorNetReversedCents,
      vendorAffected: l.vendorAffected,
      vendorNetImpactCents: l.vendorNetImpactCents,
      artfestBorneRefundCents: l.artfestBorneRefundCents,
      stock: stockEffect(l.disposition, l.quantity),
    })),
  };
}

/* ===================== Încărcare ===================== */

async function loadForReturn(db, saleId) {
  const fair = await ensureFair(db);
  const sale = await db.artfestFairSale.findUnique({ where: { id: String(saleId || "") } });
  if (!sale || sale.fairId !== fair.id) throw new FairError(404, "sale_not_found", "Vânzarea nu a fost găsită.");
  const saleLines = await db.artfestFairSaleLine.findMany({ where: { saleId: sale.id } });
  const items = saleLines.length
    ? await db.artfestFairInventoryItem.findMany({ where: { id: { in: [...new Set(saleLines.map((l) => l.inventoryItemId))] } } })
    : [];
  return { fair, sale, saleLines, items };
}

function parseRequest(type, body) {
  const reason = requireReason(body.reason);
  if (type === "VOID") {
    return { reason, refundMethod: null, requestLines: null };
  }
  return { reason, refundMethod: parseRefundMethod(body.refundMethod), requestLines: parseReturnLines(body.lines) };
}

// la VOID: toate bucățile nereturnate, RESTOCKED (fără responsabil), rambursate cu metoda vânzării
function voidLines(saleLines) {
  return saleLines
    .map((l) => ({
      saleLineId: l.id,
      disposition: "RESTOCKED",
      quantity: l.quantity - l.returnedQty,
      conditionNote: null,
      refundResponsibility: null,
      responsibilityReason: null,
    }))
    .filter((l) => l.quantity > 0)
    .sort(compareLines);
}

/* ===================== Preview ===================== */

export async function previewSaleReturn({ saleId, type = "RETURN", body = {}, db = prisma }) {
  const kind = type === "VOID" ? "VOID" : "RETURN";
  const { sale, saleLines, items } = await loadForReturn(db, saleId);
  const reasonOk = String(body.reason || "").trim().length >= MIN_REASON;
  const refundMethod = kind === "VOID" ? sale.paymentMethod : parseRefundMethod(body.refundMethod);
  const requestLines = kind === "VOID" ? voidLines(saleLines) : parseReturnLines(body.lines, { strict: false });
  const responsibilityOk = requestLines.every(
    (l) => !RESPONSIBILITY_REQUIRED.has(l.disposition) || (l.refundResponsibility && (l.responsibilityReason || "").length >= MIN_REASON)
  );
  const plan = planReturn({ type: kind, sale, saleLines, items, requestLines });
  return { type: kind, reasonOk, responsibilityOk, ...publicPlan(plan, refundMethod) };
}

/* ===================== Creare (VOID / RETURN) ===================== */

async function replayByKey(db, key, hash) {
  const existing = await db.artfestFairSaleReturn.findUnique({ where: { idempotencyKey: key } });
  if (!existing) return null;
  if ((await storedHash(db, existing)) !== hash) {
    throw new FairError(409, "idempotency_conflict", "Cheia operației a fost folosită pentru alt retur.");
  }
  return existing;
}

async function createSaleReturn({ type, saleId, body = {}, idempotencyKey, adminId, db = prisma, now = new Date() }) {
  const key = requireIdempotencyKey(idempotencyKey);
  const id = String(saleId || "");
  const { reason, refundMethod: bodyMethod, requestLines: bodyLines } = parseRequest(type, body);
  const hash = canonicalHash({ type, saleId: id, reason, refundMethod: bodyMethod, lines: bodyLines || [] });

  const early = await replayByKey(db, key, hash);
  if (early) return { replayed: true, ...(await serializeResult(db, early.id)) };

  let returnId;
  let replayedInTx = false;
  try {
    returnId = await db.$transaction(async (tx) => {
      const base = await ensureFair(tx);
      // 1. lock pe târg (numerotare + serializare cu vânzările), apoi pe vânzare
      await lockFairPos(tx, base.id);
      await lockSale(tx, id);

      const again = await replayByKey(tx, key, hash);
      if (again) {
        replayedInTx = true;
        return again.id;
      }

      // 2-4. recitire sub lock: vânzarea, liniile, inventarul (lock-uri sortate)
      const { fair, sale, saleLines } = await loadForReturn(tx, id);
      const itemIds = [...new Set(saleLines.map((l) => l.inventoryItemId))].sort();
      for (const itemId of itemIds) await lockLine(tx, itemId);
      const items = await tx.artfestFairInventoryItem.findMany({ where: { id: { in: itemIds } } });

      const refundMethod = type === "VOID" ? sale.paymentMethod : bodyMethod;
      const requestLines = type === "VOID" ? voidLines(saleLines) : bodyLines;

      // 5. calcul determinist; orice linie invalidă => nimic nu se scrie
      const plan = planReturn({ type, sale, saleLines, items, requestLines });
      if (plan.problems.length) {
        throw new FairError(409, "return_not_allowed", "Returul nu poate fi înregistrat.", { problems: plan.problems });
      }

      const updatedFair = await tx.artfestFair.update({
        where: { id: fair.id },
        data: { nextReturnNumber: { increment: 1 } },
        select: { nextReturnNumber: true },
      });
      const returnNumber = updatedFair.nextReturnNumber - 1;
      const reference = returnReferenceFor(returnNumber, now);

      // 6. returul (totalurile = suma liniilor, valori integrale pentru audit)
      const saleReturn = await tx.artfestFairSaleReturn.create({
        data: {
          saleId: sale.id,
          fairId: fair.id,
          type,
          returnNumber,
          reference,
          reason,
          refundMethod,
          refundCents: plan.totals.refundCents,
          commissionReversedCents: plan.totals.commissionReversedCents,
          artfestFundedReversedCents: plan.totals.artfestFundedReversedCents,
          vendorNetReversedCents: plan.totals.vendorNetReversedCents,
          idempotencyKey: key,
          createdById: adminId,
          createdAt: now,
        },
      });

      for (const l of plan.lines) {
        // 7. linia de retur (cu responsabilul ales explicit, unde e cazul)
        const returnLine = await tx.artfestFairSaleReturnLine.create({
          data: {
            returnId: saleReturn.id,
            saleLineId: l.saleLine.id,
            inventoryItemId: l.saleLine.inventoryItemId,
            vendorId: l.saleLine.vendorId,
            quantity: l.quantity,
            refundCents: l.refundCents,
            commissionReversedCents: l.commissionReversedCents,
            artfestFundedReversedCents: l.artfestFundedReversedCents,
            vendorNetReversedCents: l.vendorNetReversedCents,
            disposition: l.disposition,
            conditionNote: l.conditionNote,
            refundResponsibility: l.refundResponsibility,
            responsibilityReason: l.responsibilityReason,
            createdAt: now,
          },
        });

        // 8-9. mișcări + inventar (doar pentru bucățile întoarse fizic)
        if (l.disposition !== "NOT_RETURNED") {
          const restock = l.disposition === "RESTOCKED";
          const res = await tx.artfestFairInventoryItem.updateMany({
            where: {
              id: l.item.id,
              soldQty: { gte: l.quantity },
              ...(restock ? { status: "RECEIVED" } : {}),
            },
            data: restock
              ? { soldQty: { decrement: l.quantity }, availableQty: { increment: l.quantity } }
              : { soldQty: { decrement: l.quantity }, damagedQty: { increment: l.quantity } },
          });
          if (res.count !== 1) throw new FairError(409, "inventory_conflict", "Stocul s-a modificat între timp. Încearcă din nou.");

          const movementBase = {
            inventoryItemId: l.item.id,
            fairId: fair.id,
            vendorId: l.saleLine.vendorId,
            quantity: l.quantity,
            saleLineId: l.saleLine.id,
            saleReturnLineId: returnLine.id,
            actorUserId: adminId,
            createdAt: now,
          };
          await tx.artfestFairStockMovement.create({
            data: {
              ...movementBase,
              type: "SALE_REVERSED",
              reason: `${type === "VOID" ? "Anulare" : "Retur"} ${reference} (vânzarea ${sale.receiptReference})`,
              idempotencyKey: `sale-return:${saleReturn.id}:${returnLine.id}:reversed`,
            },
          });
          if (!restock) {
            await tx.artfestFairStockMovement.create({
              data: {
                ...movementBase,
                type: "DAMAGED",
                reason: `Retur ${reference}: ${l.conditionNote || "produs nevandabil la retur"}`,
                idempotencyKey: `sale-return:${saleReturn.id}:${returnLine.id}:damaged`,
              },
            });
          }
        }

        // 10. bucățile returnate ale liniei de vânzare (garda: nu depășește cantitatea)
        const lineRes = await tx.artfestFairSaleLine.updateMany({
          where: { id: l.saleLine.id, returnedQty: { lte: l.saleLine.quantity - l.quantity } },
          data: { returnedQty: { increment: l.quantity } },
        });
        if (lineRes.count !== 1) throw new FairError(409, "return_conflict", "Cantitatea returnată s-a modificat între timp.");
      }

      // 11. statusul vânzării
      await tx.artfestFairSale.update({
        where: { id: sale.id },
        data:
          type === "VOID"
            ? { status: "VOIDED", voidedAt: now, voidedById: adminId }
            : { status: plan.nextStatus },
      });

      return saleReturn.id;
    }, FAIR_TX_OPTIONS);
  } catch (error) {
    // două cereri simultane cu aceeași cheie: a doua lovește unicitatea
    if (error?.code === "P2002") {
      const replayed = await replayByKey(db, key, hash);
      if (replayed) return { replayed: true, ...(await serializeResult(db, replayed.id)) };
    }
    throw error;
  }

  return { replayed: replayedInTx, ...(await serializeResult(db, returnId)) };
}

export function voidSale(args) {
  return createSaleReturn({ ...args, type: "VOID" });
}

export function returnSale(args) {
  return createSaleReturn({ ...args, type: "RETURN" });
}

/* ===================== Serializare (Admin) ===================== */

export function serializeReturnLine(l) {
  const vendorAffected = affectsVendor(l);
  return {
    id: l.id,
    saleLineId: l.saleLineId,
    inventoryItemId: l.inventoryItemId,
    vendorId: l.vendorId,
    quantity: l.quantity,
    disposition: l.disposition,
    conditionNote: l.conditionNote || null,
    refundResponsibility: l.refundResponsibility || null,
    responsibilityReason: l.responsibilityReason || null,
    refundCents: l.refundCents,
    commissionReversedCents: l.commissionReversedCents,
    artfestFundedReversedCents: l.artfestFundedReversedCents,
    vendorNetReversedCents: l.vendorNetReversedCents,
    vendorAffected,
    vendorNetImpactCents: vendorAffected ? l.vendorNetReversedCents : 0,
    artfestBorneRefundCents: l.refundResponsibility === "ARTFEST" ? l.refundCents : 0,
  };
}

export function serializeReturn(r, lines) {
  const serialized = lines.map(serializeReturnLine);
  return {
    id: r.id,
    type: r.type,
    reference: r.reference,
    returnNumber: r.returnNumber,
    reason: r.reason,
    refundMethod: r.refundMethod,
    refundCents: r.refundCents,
    commissionReversedCents: r.commissionReversedCents,
    artfestFundedReversedCents: r.artfestFundedReversedCents,
    vendorNetReversedCents: r.vendorNetReversedCents,
    vendorNetImpactCents: serialized.reduce((s, l) => s + l.vendorNetImpactCents, 0),
    artfestBorneRefundCents: serialized.reduce((s, l) => s + l.artfestBorneRefundCents, 0),
    createdAt: r.createdAt,
    createdById: r.createdById,
    lines: serialized,
  };
}

async function serializeResult(db, returnId) {
  const r = await db.artfestFairSaleReturn.findUnique({ where: { id: returnId } });
  const lines = await db.artfestFairSaleReturnLine.findMany({ where: { returnId } });
  return { saleReturn: serializeReturn(r, lines), sale: await getSale({ id: r.saleId, db }) };
}
