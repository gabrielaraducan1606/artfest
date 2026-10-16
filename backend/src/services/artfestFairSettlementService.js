// backend/src/services/artfestFairSettlementService.js
//
// Târgul Artfest - decontul per vendor (vânzări + retururi + ajustări + sold reportat).
// NU conține: fiscalizare, bon, factură, plată bancară / transfer real.
// „Marchează plătit” doar înregistrează o plată făcută în afara aplicației.
//
// Ce intră într-un decont (vendor V, perioada [periodFrom, periodTo)):
//   - liniile de vânzare ale lui V cu sale.soldAt în perioadă, încă neincluse în alt decont;
//   - liniile de retur ale lui V cu return.createdAt în perioadă, încă neincluse în alt decont.
//   O linie intră o singură dată (ArtfestFairSettlementEntry.saleLineId / returnLineId @unique).
//   Un retur făcut după finalizarea decontului vânzării intră în decontul următor.
//
// Sumele vin EXCLUSIV din snapshot-urile liniilor (nu se recalculează reduceri / comision):
//   vânzare:  listSales += lineList, discounts += lineDiscount, grossSales += lineGross,
//             commission += commissionCents, vendorNet += vendorNetCents (D8 deja aplicat)
//   retur:    returnsRefund += refundCents (TOATE, indiferent cine suportă)
//             dacă afectează vendorul (RESTOCKED sau responsabil VENDOR):
//               commissionReversed += commissionReversedCents, vendorNetReversed += vendorNetReversedCents
//             dacă responsabil ARTFEST: artfestBorneRefund += refundCents; vendorul rămâne neafectat
//   finalDue = vendorNet − vendorNetReversed + adjustments + carriedIn   (CHECK AFST_finalDue_chk)
//
// Statusuri: DRAFT (recalculabil, ajustări) -> FINALIZED (înghețat; > 0 de plătit sau 0 = nimic de plătit)
//            -> PAID (doar > 0, cu dată / autor / referință); sau DRAFT -> CARRIED_FORWARD (sold < 0).
//            CANCELLED doar pentru un DRAFT (eliberează liniile și soldul preluat).
// Sold negativ: noul decont al aceluiași vendor preia decontul CARRIED_FORWARD încă nepreluat
// (previousSettlementId @unique => o singură dată); carriedInCents = finalDue-ul lui (< 0).
// Maximum un DRAFT pe vendor odată (lock pe vendor), ca soldul să nu fie preluat de două ori.

import { prisma } from "../db.js";
import { FAIR_TX_OPTIONS } from "../config/artfestFair.js";
import { FairError, ensureFair } from "./artfestFairService.js";
import { formatFairBarcode } from "./artfestFairInventoryService.js";
import { cleanText } from "./artfestFairReceptionService.js";
import { localDayRange, todayLocal } from "./artfestFairReportsService.js";

export const SETTLEMENT_STATUS_LABEL = Object.freeze({
  DRAFT: "Ciornă",
  FINALIZED: "Finalizat",
  PAID: "Plătit",
  CARRIED_FORWARD: "Sold reportat",
  CANCELLED: "Anulat",
});

const MAX_ADJUSTMENT_CENTS = 100_000_000; // 1.000.000 lei - gardă împotriva greșelilor de tastare

/* ===================== Utilitare ===================== */

async function lockVendor(tx, fairId, vendorId) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`artfest-fair-settlement:${fairId}:${vendorId}`}))`;
}

// o linie de retur afectează vendorul dacă nu e suportată de Artfest
const affectsVendor = (rl) => rl.refundResponsibility !== "ARTFEST";

function parsePeriod(body) {
  const from = String(body.periodFrom || "").trim();
  const to = String(body.periodTo || "").trim();
  const start = localDayRange(from).start;
  const end = localDayRange(to).end;
  if (!(start < end)) throw new FairError(400, "invalid_period", "Perioada este invalidă.");
  return { periodFrom: start, periodTo: end, fromDate: from, toDate: to };
}

async function requireVendor(db, vendorId) {
  const id = String(vendorId || "").trim();
  const vendor = id ? await db.vendor.findUnique({ where: { id }, select: { id: true, displayName: true } }) : null;
  if (!vendor) throw new FairError(404, "vendor_not_found", "Vendorul nu a fost găsit.");
  return vendor;
}

/* ===================== Calculul ===================== */

function emptyTotals() {
  return {
    listSalesCents: 0,
    discountsCents: 0,
    grossSalesCents: 0,
    commissionCents: 0,
    vendorNetCents: 0,
    artfestFundedDiscountCents: 0,
    returnsRefundCents: 0,
    commissionReversedCents: 0,
    vendorNetReversedCents: 0,
    artfestBorneRefundCents: 0,
    saleUnits: 0,
    returnUnits: 0,
  };
}

/*
 * Liniile eligibile + totalurile, fără scriere. `selfId` = decontul DRAFT
 * recalculat (intrările lui proprii nu blochează liniile).
 */
async function collect(db, { fairId, vendorId, periodFrom, periodTo, selfId = null }) {
  const sales = await db.artfestFairSale.findMany({
    where: { fairId, soldAt: { gte: periodFrom, lt: periodTo } },
    select: { id: true, saleNumber: true, receiptReference: true, soldAt: true, paymentMethod: true, status: true },
  });
  const saleLinesAll = sales.length
    ? await db.artfestFairSaleLine.findMany({ where: { saleId: { in: sales.map((s) => s.id) }, vendorId } })
    : [];
  const returns = await db.artfestFairSaleReturn.findMany({
    where: { fairId, createdAt: { gte: periodFrom, lt: periodTo } },
    select: { id: true, reference: true, type: true, createdAt: true, refundMethod: true, saleId: true },
  });
  const returnLinesAll = returns.length
    ? await db.artfestFairSaleReturnLine.findMany({ where: { returnId: { in: returns.map((r) => r.id) }, vendorId } })
    : [];

  // linii deja incluse în ALT decont (intrările decontului curent nu contează)
  const [saleEntries, returnEntries] = await Promise.all([
    saleLinesAll.length ? db.artfestFairSettlementEntry.findMany({ where: { saleLineId: { in: saleLinesAll.map((l) => l.id) } } }) : [],
    returnLinesAll.length ? db.artfestFairSettlementEntry.findMany({ where: { returnLineId: { in: returnLinesAll.map((l) => l.id) } } }) : [],
  ]);
  const takenSale = new Set(saleEntries.filter((e) => e.settlementId !== selfId).map((e) => e.saleLineId));
  const takenReturn = new Set(returnEntries.filter((e) => e.settlementId !== selfId).map((e) => e.returnLineId));
  const saleLines = saleLinesAll.filter((l) => !takenSale.has(l.id));
  const returnLines = returnLinesAll.filter((l) => !takenReturn.has(l.id));

  const totals = emptyTotals();
  const entries = [];
  for (const l of saleLines) {
    totals.listSalesCents += l.lineListCents;
    totals.discountsCents += l.lineDiscountCents;
    totals.grossSalesCents += l.lineGrossCents;
    totals.commissionCents += l.commissionCents;
    totals.vendorNetCents += l.vendorNetCents;
    totals.artfestFundedDiscountCents += l.artfestFundedDiscountCents || 0;
    totals.saleUnits += l.quantity;
    entries.push({ saleLineId: l.id, returnLineId: null, grossCents: l.lineGrossCents, commissionCents: l.commissionCents, vendorNetCents: l.vendorNetCents });
  }
  for (const rl of returnLines) {
    const hitsVendor = affectsVendor(rl);
    totals.returnsRefundCents += rl.refundCents;
    totals.returnUnits += rl.quantity;
    if (hitsVendor) {
      totals.commissionReversedCents += rl.commissionReversedCents;
      totals.vendorNetReversedCents += rl.vendorNetReversedCents;
    } else {
      totals.artfestBorneRefundCents += rl.refundCents;
    }
    // intrarea = ce se aplică în decont (semn minus); valorile originale rămân pe linia de retur
    entries.push({
      saleLineId: null,
      returnLineId: rl.id,
      grossCents: -rl.refundCents,
      commissionCents: hitsVendor ? -rl.commissionReversedCents : 0,
      vendorNetCents: hitsVendor ? -rl.vendorNetReversedCents : 0,
    });
  }

  return { totals, entries, saleLines, returnLines, sales, returns };
}

// decontul negativ al vendorului încă nepreluat (sau preluat chiar de `selfId`)
async function findCarry(db, { fairId, vendorId, selfId = null }) {
  const candidates = await db.artfestFairSettlement.findMany({
    where: { fairId, vendorId, status: "CARRIED_FORWARD" },
    orderBy: { sequence: "asc" },
  });
  for (const c of candidates) {
    const next = await db.artfestFairSettlement.findFirst({ where: { previousSettlementId: c.id } });
    if (!next || next.id === selfId) return c;
  }
  return null;
}

async function sumAdjustments(db, settlementId) {
  if (!settlementId) return 0;
  const rows = await db.artfestFairSettlementAdjustment.findMany({ where: { settlementId }, select: { amountCents: true } });
  return rows.reduce((s, r) => s + r.amountCents, 0);
}

function finalDueOf({ vendorNetCents, vendorNetReversedCents, adjustmentsCents, carriedInCents }) {
  return vendorNetCents - vendorNetReversedCents + adjustmentsCents + carriedInCents;
}

async function calculate(db, { fair, vendorId, periodFrom, periodTo, selfId = null }) {
  const collected = await collect(db, { fairId: fair.id, vendorId, periodFrom, periodTo, selfId });
  const carry = await findCarry(db, { fairId: fair.id, vendorId, selfId });
  const adjustmentsCents = await sumAdjustments(db, selfId);
  const carriedInCents = carry ? carry.finalDueCents : 0;
  const t = collected.totals;
  return {
    ...collected,
    carry,
    header: {
      listSalesCents: t.listSalesCents,
      discountsCents: t.discountsCents,
      grossSalesCents: t.grossSalesCents,
      commissionCents: t.commissionCents,
      vendorNetCents: t.vendorNetCents,
      returnsRefundCents: t.returnsRefundCents,
      commissionReversedCents: t.commissionReversedCents,
      vendorNetReversedCents: t.vendorNetReversedCents,
      artfestBorneRefundCents: t.artfestBorneRefundCents,
      adjustmentsCents,
      carriedInCents,
      finalDueCents: finalDueOf({ vendorNetCents: t.vendorNetCents, vendorNetReversedCents: t.vendorNetReversedCents, adjustmentsCents, carriedInCents }),
      previousSettlementId: carry?.id || null,
    },
  };
}

/* ===================== Preview ===================== */

export async function previewSettlement({ body = {}, db = prisma }) {
  const fair = await ensureFair(db);
  const vendor = await requireVendor(db, body.vendorId);
  const period = parsePeriod(body);
  const calc = await calculate(db, { fair, vendorId: vendor.id, periodFrom: period.periodFrom, periodTo: period.periodTo });
  return {
    vendorId: vendor.id,
    vendorName: vendor.displayName || null,
    periodFrom: period.periodFrom,
    periodTo: period.periodTo,
    ...calc.header,
    artfestFundedDiscountCents: calc.totals.artfestFundedDiscountCents,
    saleLines: calc.saleLines.length,
    returnLines: calc.returnLines.length,
    saleUnits: calc.totals.saleUnits,
    returnUnits: calc.totals.returnUnits,
    carriedFrom: calc.carry ? { id: calc.carry.id, sequence: calc.carry.sequence, finalDueCents: calc.carry.finalDueCents } : null,
  };
}

/* ===================== Scriere ===================== */

async function writeEntries(tx, settlementId, entries) {
  await tx.artfestFairSettlementEntry.deleteMany({ where: { settlementId } });
  if (entries.length) {
    // @unique pe saleLineId / returnLineId => o linie inclusă concurent în alt decont => P2002 => rollback
    await tx.artfestFairSettlementEntry.createMany({ data: entries.map((e) => ({ ...e, settlementId })) });
  }
}

function conflictOnUnique(error) {
  if (error?.code === "P2002") {
    return new FairError(409, "settlement_conflict", "Unele linii au fost incluse între timp în alt decont. Recalculează.");
  }
  return error;
}

export async function createSettlementDraft({ body = {}, adminId, db = prisma }) {
  const fair = await ensureFair(db);
  const vendor = await requireVendor(db, body.vendorId);
  const period = parsePeriod(body);
  const kind = body.kind === "PERIODIC" ? "PERIODIC" : "FINAL";
  const notes = cleanText(body.notes, 2000);

  try {
    const id = await db.$transaction(async (tx) => {
      await lockVendor(tx, fair.id, vendor.id);
      const draft = await tx.artfestFairSettlement.findFirst({ where: { fairId: fair.id, vendorId: vendor.id, status: "DRAFT" } });
      if (draft) {
        throw new FairError(409, "draft_exists", "Vendorul are deja un decont în ciornă. Finalizează-l sau anulează-l întâi.", { settlementId: draft.id });
      }
      const last = await tx.artfestFairSettlement.findFirst({ where: { fairId: fair.id, vendorId: vendor.id }, orderBy: { sequence: "desc" } });
      const calc = await calculate(tx, { fair, vendorId: vendor.id, periodFrom: period.periodFrom, periodTo: period.periodTo });
      const created = await tx.artfestFairSettlement.create({
        data: {
          fairId: fair.id,
          vendorId: vendor.id,
          sequence: (last?.sequence || 0) + 1,
          kind,
          periodFrom: period.periodFrom,
          periodTo: period.periodTo,
          status: "DRAFT",
          notes,
          ...calc.header,
        },
      });
      await writeEntries(tx, created.id, calc.entries);
      return created.id;
    }, FAIR_TX_OPTIONS);
    return getSettlementForAdmin({ id, db });
  } catch (error) {
    throw conflictOnUnique(error);
  }
}

async function loadDraft(tx, id) {
  const s = await tx.artfestFairSettlement.findUnique({ where: { id: String(id || "") } });
  if (!s) throw new FairError(404, "settlement_not_found", "Decontul nu a fost găsit.");
  if (s.status !== "DRAFT") throw new FairError(409, "settlement_not_draft", "Decontul nu mai este ciornă; nu se mai poate modifica.");
  return s;
}

// recalculare completă (intrări + totaluri + sold preluat); doar DRAFT
async function recalculateInTx(tx, fair, s) {
  const calc = await calculate(tx, { fair, vendorId: s.vendorId, periodFrom: s.periodFrom, periodTo: s.periodTo, selfId: s.id });
  await writeEntries(tx, s.id, calc.entries);
  await tx.artfestFairSettlement.update({ where: { id: s.id }, data: calc.header });
  return calc;
}

export async function recalculateSettlement({ id, db = prisma }) {
  const fair = await ensureFair(db);
  try {
    await db.$transaction(async (tx) => {
      const s0 = await tx.artfestFairSettlement.findUnique({ where: { id: String(id || "") } });
      if (!s0) throw new FairError(404, "settlement_not_found", "Decontul nu a fost găsit.");
      await lockVendor(tx, fair.id, s0.vendorId);
      const s = await loadDraft(tx, s0.id);
      await recalculateInTx(tx, fair, s);
    }, FAIR_TX_OPTIONS);
  } catch (error) {
    throw conflictOnUnique(error);
  }
  return getSettlementForAdmin({ id, db });
}

export async function addAdjustment({ id, body = {}, adminId, db = prisma }) {
  const fair = await ensureFair(db);
  const amountCents = Number(body.amountCents);
  if (!Number.isInteger(amountCents) || amountCents === 0 || Math.abs(amountCents) > MAX_ADJUSTMENT_CENTS) {
    throw new FairError(400, "invalid_amount", "Suma ajustării trebuie să fie un număr întreg de bani, diferit de 0.", {
      fields: { amountCents: "Ex.: 1500 = +15,00 lei; -1500 = -15,00 lei." },
    });
  }
  const reason = cleanText(body.reason, 2000);
  if (!reason || reason.length < 3) {
    throw new FairError(400, "reason_required", "Scrie motivul intern al ajustării.", { fields: { reason: "Minimum 3 caractere." } });
  }
  const vendorNote = cleanText(body.vendorNote, 1000);

  await db.$transaction(async (tx) => {
    const s0 = await tx.artfestFairSettlement.findUnique({ where: { id: String(id || "") } });
    if (!s0) throw new FairError(404, "settlement_not_found", "Decontul nu a fost găsit.");
    await lockVendor(tx, fair.id, s0.vendorId);
    const s = await loadDraft(tx, s0.id);
    await tx.artfestFairSettlementAdjustment.create({ data: { settlementId: s.id, amountCents, reason, vendorNote, createdById: adminId } });
    // adjustmentsCents = suma ajustărilor (niciodată din client)
    const adjustmentsCents = await sumAdjustments(tx, s.id);
    await tx.artfestFairSettlement.update({
      where: { id: s.id },
      data: { adjustmentsCents, finalDueCents: finalDueOf({ ...s, adjustmentsCents }) },
    });
  }, FAIR_TX_OPTIONS);
  return getSettlementForAdmin({ id, db });
}

const sameHeader = (a, b) =>
  ["listSalesCents", "discountsCents", "grossSalesCents", "commissionCents", "vendorNetCents", "returnsRefundCents", "commissionReversedCents",
    "vendorNetReversedCents", "artfestBorneRefundCents", "adjustmentsCents", "carriedInCents", "finalDueCents", "previousSettlementId"].every(
    (k) => (a[k] ?? null) === (b[k] ?? null)
  );

/*
 * Finalizarea îngheață decontul. Recalculează sub lock și refuză dacă datele s-au
 * schimbat față de ce a văzut Admin (vânzări / retururi noi) - Admin recalculează și verifică din nou.
 */
export async function finalizeSettlement({ id, adminId, db = prisma, now = new Date() }) {
  const fair = await ensureFair(db);
  await db.$transaction(async (tx) => {
    const s0 = await tx.artfestFairSettlement.findUnique({ where: { id: String(id || "") } });
    if (!s0) throw new FairError(404, "settlement_not_found", "Decontul nu a fost găsit.");
    await lockVendor(tx, fair.id, s0.vendorId);
    const s = await loadDraft(tx, s0.id);
    const calc = await calculate(tx, { fair, vendorId: s.vendorId, periodFrom: s.periodFrom, periodTo: s.periodTo, selfId: s.id });
    const currentEntries = await tx.artfestFairSettlementEntry.findMany({ where: { settlementId: s.id } });
    const key = (e) => e.saleLineId || `r:${e.returnLineId}`;
    const sameEntries =
      currentEntries.length === calc.entries.length && currentEntries.map(key).sort().join() === calc.entries.map(key).sort().join();
    if (!sameEntries || !sameHeader(s, calc.header)) {
      throw new FairError(409, "settlement_stale", "Datele s-au schimbat de la ultimul calcul. Recalculează decontul și verifică-l înainte de finalizare.");
    }
    // sold negativ => reportat (nu se plătește); altfel finalizat (> 0 de plătit, 0 = nimic de plătit)
    const status = s.finalDueCents < 0 ? "CARRIED_FORWARD" : "FINALIZED";
    await tx.artfestFairSettlement.update({ where: { id: s.id }, data: { status, finalizedAt: now, finalizedById: adminId } });
  }, FAIR_TX_OPTIONS);
  return getSettlementForAdmin({ id, db });
}

export async function markSettlementPaid({ id, body = {}, adminId, db = prisma, now = new Date() }) {
  const paymentReference = cleanText(body.paymentReference, 120);
  if (!paymentReference) {
    throw new FairError(400, "payment_reference_required", "Scrie referința plății (ex. numărul ordinului de plată).", {
      fields: { paymentReference: "Obligatoriu." },
    });
  }
  let paidAt = now;
  if (body.paidAt) {
    paidAt = new Date(body.paidAt);
    if (Number.isNaN(paidAt.getTime()) || paidAt > new Date(now.getTime() + 60_000)) {
      throw new FairError(400, "invalid_paid_at", "Data plății este invalidă.");
    }
  }
  const fair = await ensureFair(db);
  await db.$transaction(async (tx) => {
    const s = await tx.artfestFairSettlement.findUnique({ where: { id: String(id || "") } });
    if (!s) throw new FairError(404, "settlement_not_found", "Decontul nu a fost găsit.");
    await lockVendor(tx, fair.id, s.vendorId);
    const fresh = await tx.artfestFairSettlement.findUnique({ where: { id: s.id } });
    if (fresh.status === "PAID") throw new FairError(409, "already_paid", "Decontul este deja marcat plătit.");
    if (fresh.status !== "FINALIZED") throw new FairError(409, "not_finalized", "Doar un decont finalizat poate fi marcat plătit.");
    if (fresh.finalDueCents <= 0) throw new FairError(409, "nothing_to_pay", "Nu există nimic de plătit pentru acest decont.");
    await tx.artfestFairSettlement.update({ where: { id: s.id }, data: { status: "PAID", paidAt, paidById: adminId, paymentReference } });
  }, FAIR_TX_OPTIONS);
  return getSettlementForAdmin({ id, db });
}

// anularea unei ciorne: liniile și soldul preluat se eliberează; ajustările rămân pentru audit
export async function cancelSettlementDraft({ id, db = prisma }) {
  const fair = await ensureFair(db);
  await db.$transaction(async (tx) => {
    const s0 = await tx.artfestFairSettlement.findUnique({ where: { id: String(id || "") } });
    if (!s0) throw new FairError(404, "settlement_not_found", "Decontul nu a fost găsit.");
    await lockVendor(tx, fair.id, s0.vendorId);
    const s = await loadDraft(tx, s0.id);
    await tx.artfestFairSettlementEntry.deleteMany({ where: { settlementId: s.id } });
    await tx.artfestFairSettlement.update({
      where: { id: s.id },
      data: { status: "CANCELLED", previousSettlementId: null, carriedInCents: 0, finalDueCents: finalDueOf({ ...s, carriedInCents: 0 }) },
    });
  }, FAIR_TX_OPTIONS);
  return getSettlementForAdmin({ id, db });
}

/* ===================== Citire ===================== */

async function vendorNames(db, vendorIds) {
  if (!vendorIds.length) return new Map();
  const [vendors, services] = await Promise.all([
    db.vendor.findMany({ where: { id: { in: vendorIds } }, select: { id: true, displayName: true } }),
    db.vendorService.findMany({ where: { vendorId: { in: vendorIds } }, select: { vendorId: true, profile: { select: { displayName: true } } } }),
  ]);
  return new Map(
    vendorIds.map((vid) => [
      vid,
      services.find((s) => s.vendorId === vid && s.profile?.displayName)?.profile.displayName || vendors.find((v) => v.id === vid)?.displayName || null,
    ])
  );
}

function serializeHeader(s, { admin }) {
  return {
    id: s.id,
    vendorId: s.vendorId,
    sequence: s.sequence,
    kind: s.kind,
    label: s.sequence === 1 ? `Decont #1${s.kind === "FINAL" ? " (final)" : ""}` : `Decont #${s.sequence} (corecție)`,
    periodFrom: s.periodFrom,
    periodTo: s.periodTo,
    status: s.status,
    currency: s.currency,
    listSalesCents: s.listSalesCents,
    discountsCents: s.discountsCents,
    grossSalesCents: s.grossSalesCents,
    commissionCents: s.commissionCents,
    vendorNetCents: s.vendorNetCents,
    returnsRefundCents: s.returnsRefundCents,
    artfestBorneRefundCents: s.artfestBorneRefundCents,
    vendorBorneRefundCents: s.returnsRefundCents - s.artfestBorneRefundCents,
    commissionReversedCents: s.commissionReversedCents,
    vendorNetReversedCents: s.vendorNetReversedCents,
    adjustmentsCents: s.adjustmentsCents,
    carriedInCents: s.carriedInCents,
    finalDueCents: s.finalDueCents,
    previousSettlementId: s.previousSettlementId,
    finalizedAt: s.finalizedAt,
    paidAt: s.paidAt,
    paymentReference: s.paymentReference,
    createdAt: s.createdAt,
    ...(admin ? { finalizedById: s.finalizedById, paidById: s.paidById, notes: s.notes || null } : {}),
  };
}

async function loadDetail(db, s, { admin }) {
  const entries = await db.artfestFairSettlementEntry.findMany({ where: { settlementId: s.id } });
  const saleLineIds = entries.filter((e) => e.saleLineId).map((e) => e.saleLineId);
  const returnLineIds = entries.filter((e) => e.returnLineId).map((e) => e.returnLineId);
  const [saleLines, returnLines, adjustments, previous, next] = await Promise.all([
    saleLineIds.length ? db.artfestFairSaleLine.findMany({ where: { id: { in: saleLineIds } } }) : [],
    returnLineIds.length ? db.artfestFairSaleReturnLine.findMany({ where: { id: { in: returnLineIds } } }) : [],
    db.artfestFairSettlementAdjustment.findMany({ where: { settlementId: s.id }, orderBy: { createdAt: "asc" } }),
    s.previousSettlementId ? db.artfestFairSettlement.findUnique({ where: { id: s.previousSettlementId } }) : null,
    db.artfestFairSettlement.findFirst({ where: { previousSettlementId: s.id } }),
  ]);
  const saleIds = [...new Set(saleLines.map((l) => l.saleId))];
  const returnIds = [...new Set(returnLines.map((l) => l.returnId))];
  const [sales, returns, returnSaleLines] = await Promise.all([
    saleIds.length ? db.artfestFairSale.findMany({ where: { id: { in: saleIds } } }) : [],
    returnIds.length ? db.artfestFairSaleReturn.findMany({ where: { id: { in: returnIds } } }) : [],
    returnLines.length ? db.artfestFairSaleLine.findMany({ where: { id: { in: [...new Set(returnLines.map((l) => l.saleLineId))] } } }) : [],
  ]);
  const saleById = new Map(sales.map((x) => [x.id, x]));
  const returnById = new Map(returns.map((x) => [x.id, x]));
  const titleBySaleLine = new Map([...saleLines, ...returnSaleLines].map((l) => [l.id, l]));
  const entryBy = new Map(entries.map((e) => [e.saleLineId || `r:${e.returnLineId}`, e]));

  return {
    ...serializeHeader(s, { admin }),
    saleLines: saleLines
      .map((l) => {
        const sale = saleById.get(l.saleId);
        return {
          id: l.id,
          saleNumber: sale?.saleNumber ?? null,
          receiptReference: sale?.receiptReference ?? null,
          soldAt: sale?.soldAt ?? null,
          paymentMethod: sale?.paymentMethod ?? null,
          title: l.titleSnapshot,
          variantLabel: l.variantLabel || null,
          barcodeDisplay: formatFairBarcode(l.barcodeSnapshot),
          quantity: l.quantity,
          lineListCents: l.lineListCents,
          lineDiscountCents: l.lineDiscountCents,
          lineGrossCents: l.lineGrossCents,
          commissionCents: l.commissionCents,
          artfestFundedDiscountCents: l.artfestFundedDiscountCents || 0,
          vendorNetCents: l.vendorNetCents,
          entry: entryBy.get(l.id) ? { grossCents: entryBy.get(l.id).grossCents, commissionCents: entryBy.get(l.id).commissionCents, vendorNetCents: entryBy.get(l.id).vendorNetCents } : null,
        };
      })
      .sort((a, b) => new Date(a.soldAt) - new Date(b.soldAt) || a.saleNumber - b.saleNumber),
    returnLines: returnLines
      .map((rl) => {
        const r = returnById.get(rl.returnId);
        const e = entryBy.get(`r:${rl.id}`);
        return {
          id: rl.id,
          reference: r?.reference ?? null,
          type: r?.type ?? null,
          createdAt: r?.createdAt ?? null,
          refundMethod: r?.refundMethod ?? null,
          title: titleBySaleLine.get(rl.saleLineId)?.titleSnapshot || null,
          quantity: rl.quantity,
          disposition: rl.disposition,
          affectsVendorNet: affectsVendor(rl),
          refundCents: rl.refundCents,
          commissionReversedCents: rl.commissionReversedCents,
          artfestFundedReversedCents: rl.artfestFundedReversedCents || 0,
          vendorNetReversedCents: rl.vendorNetReversedCents,
          entry: e ? { grossCents: e.grossCents, commissionCents: e.commissionCents, vendorNetCents: e.vendorNetCents } : null,
          // doar Admin: cine suportă + motivul intern
          ...(admin ? { refundResponsibility: rl.refundResponsibility || null, responsibilityReason: rl.responsibilityReason || null, returnReason: r?.reason || null } : {}),
        };
      })
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
    adjustments: adjustments.map((a) =>
      admin
        ? { id: a.id, amountCents: a.amountCents, reason: a.reason, vendorNote: a.vendorNote || null, createdById: a.createdById, createdAt: a.createdAt }
        : { id: a.id, amountCents: a.amountCents, vendorNote: a.vendorNote || null, createdAt: a.createdAt }
    ),
    carriedFrom: previous ? { id: previous.id, sequence: previous.sequence, finalDueCents: previous.finalDueCents } : null,
    carriedInto: next && next.status !== "CANCELLED" ? { id: next.id, sequence: next.sequence, status: next.status } : null,
  };
}

export async function getSettlementForAdmin({ id, db = prisma }) {
  const s = await db.artfestFairSettlement.findUnique({ where: { id: String(id || "") } });
  if (!s) throw new FairError(404, "settlement_not_found", "Decontul nu a fost găsit.");
  const detail = await loadDetail(db, s, { admin: true });
  detail.vendorName = (await vendorNames(db, [s.vendorId])).get(s.vendorId) || null;
  // reconciliere: antetul = suma intrărilor + ajustări + sold preluat
  const entries = await db.artfestFairSettlementEntry.findMany({ where: { settlementId: s.id } });
  const adjustmentsSum = detail.adjustments.reduce((t, a) => t + a.amountCents, 0);
  const net = entries.reduce((t, e) => t + e.vendorNetCents, 0);
  detail.consistent = adjustmentsSum === s.adjustmentsCents && net + adjustmentsSum + s.carriedInCents === s.finalDueCents;
  detail.actions = {
    canRecalculate: s.status === "DRAFT",
    canAdjust: s.status === "DRAFT",
    canFinalize: s.status === "DRAFT",
    canCancel: s.status === "DRAFT",
    canMarkPaid: s.status === "FINALIZED" && s.finalDueCents > 0,
  };
  return detail;
}

export async function listSettlementsForAdmin({ vendorId = null, status = null, db = prisma } = {}) {
  const fair = await ensureFair(db);
  const rows = await db.artfestFairSettlement.findMany({
    where: { fairId: fair.id, ...(vendorId ? { vendorId } : {}), ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
  });
  // vendorii care pot avea decont: participări aprobate / anulate (cele anulate pot avea vânzări / retururi)
  const regs = await db.artfestFairRegistration.findMany({
    where: { fairId: fair.id, status: { in: ["APPROVED", "CANCELLED"] } },
    select: { vendorId: true, status: true },
  });
  const names = await vendorNames(db, [...new Set([...rows.map((r) => r.vendorId), ...regs.map((r) => r.vendorId)])]);
  const lastBy = new Map();
  for (const r of rows) {
    if (r.status !== "CANCELLED" && (!lastBy.get(r.vendorId) || lastBy.get(r.vendorId).sequence < r.sequence)) lastBy.set(r.vendorId, r);
  }
  return {
    fair: { startsAt: fair.startsAt || null, endsAt: fair.endsAt || null, ended: fair.endsAt ? new Date(fair.endsAt) <= new Date() : false },
    vendors: regs
      .map((r) => ({
        vendorId: r.vendorId,
        vendorName: names.get(r.vendorId) || null,
        registrationStatus: r.status,
        hasDraft: rows.some((x) => x.vendorId === r.vendorId && x.status === "DRAFT"),
        // perioada propusă pentru decontul următor începe unde s-a oprit ultimul
        nextPeriodFrom: lastBy.get(r.vendorId)?.periodTo || null,
      }))
      .sort((a, b) => String(a.vendorName || "").localeCompare(String(b.vendorName || ""), "ro")),
    items: rows.map((r) => ({ ...serializeHeader(r, { admin: true }), vendorName: names.get(r.vendorId) || null })),
  };
}

// vendorul vede doar deconturile lui, finalizate (ciornele și anulările sunt interne)
const VENDOR_VISIBLE = ["FINALIZED", "PAID", "CARRIED_FORWARD"];

export async function listSettlementsForVendor({ vendorId, db = prisma }) {
  const fair = await ensureFair(db);
  const rows = await db.artfestFairSettlement.findMany({
    where: { fairId: fair.id, vendorId, status: { in: VENDOR_VISIBLE } },
    orderBy: { sequence: "desc" },
  });
  return { items: rows.map((r) => serializeHeader(r, { admin: false })) };
}

export async function getSettlementForVendor({ id, vendorId, db = prisma }) {
  const s = await db.artfestFairSettlement.findUnique({ where: { id: String(id || "") } });
  // alt vendor / ciornă => 404 (nu dezvăluim existența)
  if (!s || s.vendorId !== vendorId || !VENDOR_VISIBLE.includes(s.status)) {
    throw new FairError(404, "settlement_not_found", "Decontul nu a fost găsit.");
  }
  return loadDetail(db, s, { admin: false });
}

/* ===================== CSV ===================== */

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
const lei = (cents) => (Number(cents || 0) / 100).toFixed(2).replace(".", ",");
const signedLei = (cents) => `${cents > 0 ? "+" : ""}${lei(cents)}`;
const toCsv = (rows) => "﻿" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n") + "\r\n";
const localDate = (d) => (d ? todayLocal(new Date(d)) : "");
const DISPOSITION_CSV = { RESTOCKED: "Returnat, revandabil", NOT_RESTOCKED: "Returnat, nevandabil", NOT_RETURNED: "Rambursare fără produs" };

function totalsRows(d) {
  const lastDay = new Date(new Date(d.periodTo).getTime() - 1);
  return [
    ["Perioada", `${localDate(d.periodFrom)} – ${localDate(lastDay)}`],
    ["Status", SETTLEMENT_STATUS_LABEL[d.status] || d.status],
    ["Vânzări - valoare de listă (lei)", lei(d.listSalesCents)],
    ["Reduceri (lei)", lei(d.discountsCents)],
    ["Vânzări brute încasate (lei)", lei(d.grossSalesCents)],
    ["Comision Artfest (lei)", lei(d.commissionCents)],
    ["Net din vânzări (lei)", lei(d.vendorNetCents)],
    ["Rambursări către clienți - total (lei)", lei(d.returnsRefundCents)],
    ["Rambursări suportate de Artfest (lei)", lei(d.artfestBorneRefundCents)],
    ["Comision inversat - imputat vendorului (lei)", lei(d.commissionReversedCents)],
    ["Net retur care afectează vendorul (lei)", lei(d.vendorNetReversedCents)],
    ["Ajustări (lei)", signedLei(d.adjustmentsCents)],
    ["Sold reportat (lei)", lei(d.carriedInCents)],
    ["Sumă finală (lei)", lei(d.finalDueCents)],
    ["Finalizat la", localDate(d.finalizedAt)],
    ["Plătit la", localDate(d.paidAt)],
    ["Referința plății", d.paymentReference || ""],
  ];
}

export function settlementCsv(d, { admin }) {
  const rows = [
    [`Decont Târg Artfest${admin && d.vendorName ? ` - ${d.vendorName}` : ""}`, d.label],
    ["Document intern - nu este factură / document fiscal"],
    [],
    ["Indicator", "Valoare"],
    ...totalsRows(d),
    [],
    ["Vânzare", "Data", "Produs", "Variantă", "Cantitate", "Listă (lei)", "Reducere (lei)", "Încasat (lei)", "Comision (lei)", "Net (lei)"],
    ...d.saleLines.map((l) => [l.receiptReference, localDate(l.soldAt), l.title, l.variantLabel || "", l.quantity, lei(l.lineListCents), lei(l.lineDiscountCents), lei(l.lineGrossCents), lei(l.commissionCents), lei(l.vendorNetCents)]),
    [],
    [
      "Retur", "Data", "Produs", "Cantitate", "Stare", "Rambursat (lei)", "Îți afectează netul", "Comision inversat aplicat (lei)", "Net inversat aplicat (lei)",
      ...(admin ? ["Suportat de", "Motiv intern"] : []),
    ],
    ...d.returnLines.map((r) => [
      r.reference, localDate(r.createdAt), r.title || "", r.quantity, DISPOSITION_CSV[r.disposition] || r.disposition, lei(r.refundCents),
      r.affectsVendorNet ? "Da" : "Nu (suportat de Artfest)", lei(-(r.entry?.commissionCents || 0)), lei(-(r.entry?.vendorNetCents || 0)),
      ...(admin ? [r.refundResponsibility || (r.disposition === "RESTOCKED" ? "retur normal" : ""), r.responsibilityReason || ""] : []),
    ]),
    [],
    ["Ajustare", "Data", "Sumă (lei)", admin ? "Motiv intern" : "Notă", ...(admin ? ["Notă pentru vendor"] : [])],
    ...d.adjustments.map((a, i) => [`#${i + 1}`, localDate(a.createdAt), signedLei(a.amountCents), admin ? a.reason : a.vendorNote || "", ...(admin ? [a.vendorNote || ""] : [])]),
    [],
    ["Sold reportat din decontul anterior", d.carriedFrom ? `Decont #${d.carriedFrom.sequence}: ${lei(d.carriedFrom.finalDueCents)} lei` : "—"],
  ];
  return toCsv(rows);
}
