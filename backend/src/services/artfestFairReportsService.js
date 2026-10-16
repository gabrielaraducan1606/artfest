// backend/src/services/artfestFairReportsService.js
//
// Târgul Artfest - vânzările văzute de vendor și rapoartele zilnice (vendor / Admin).
//
// Sursa financiară: ArtfestFairSale + ArtfestFairSaleLine (+ alocările de reducere).
// Comisionul, netul vendorului și compensația Artfest se iau DIN SNAPSHOT-urile
// liniilor (nu se recalculează). Inventarul și mișcările de stoc NU intră în bani.
//
// Ziua raportului = ziua locală a târgului (Europe/Bucharest):
//   [D 00:00 local, D+1 00:00 local), convertit corect în UTC (inclusiv la schimbarea orei).
//
// Vânzările se raportează în ziua vânzării, cu valorile de la vânzare (orice
// status ulterior); retururile / anulările se raportează în ZIUA RETURULUI
// (ArtfestFairSaleReturn.createdAt) - istoricul zilei vânzării nu se rescrie.
//
// Vendorul vede EXCLUSIV liniile lui (vendorId din sesiune): într-o vânzare
// multi-vendor nu vede liniile, totalul sau netul altor vendori.

import { prisma } from "../db.js";
import { ARTFEST_FAIR_TIMEZONE } from "../config/artfestFair.js";
import { FairError, ensureFair } from "./artfestFairService.js";
import { formatFairBarcode } from "./artfestFairInventoryService.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ===================== Ziua locală ===================== */

// diferența (ms) dintre ora locală din `timeZone` și UTC, la momentul `utcMs`
function zoneOffsetMs(utcMs, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

// momentul UTC al lui „Y-M-D 00:00” în fusul dat
function localMidnightUtc(y, m, d, timeZone) {
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  let utc = guess - zoneOffsetMs(guess, timeZone);
  // a doua trecere: offsetul corect e cel de la momentul găsit (schimbarea orei)
  utc = guess - zoneOffsetMs(utc, timeZone);
  return utc;
}

export function todayLocal(now = new Date(), timeZone = ARTFEST_FAIR_TIMEZONE) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function localDayRange(date, timeZone = ARTFEST_FAIR_TIMEZONE) {
  if (!DATE_RE.test(String(date || ""))) throw new FairError(400, "invalid_date", "Data trebuie să fie în formatul AAAA-LL-ZZ.");
  const [y, m, d] = date.split("-").map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new FairError(400, "invalid_date", "Data nu există.");
  }
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return {
    date,
    timeZone,
    start: new Date(localMidnightUtc(y, m, d, timeZone)),
    end: new Date(localMidnightUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone)),
  };
}

function localDateTime(value, timeZone = ARTFEST_FAIR_TIMEZONE) {
  const d = new Date(value);
  const date = todayLocal(d, timeZone);
  const time = new Intl.DateTimeFormat("ro-RO", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return { date, time };
}
/* ===================== Încărcarea datelor ===================== */

async function salesInRange(db, fairId, range) {
  return db.artfestFairSale.findMany({
    where: { fairId, soldAt: { gte: range.start, lt: range.end } },
    orderBy: { soldAt: "asc" },
  });
}

async function returnsInRange(db, fairId, range) {
  return db.artfestFairSaleReturn.findMany({
    where: { fairId, createdAt: { gte: range.start, lt: range.end } },
    orderBy: { createdAt: "asc" },
  });
}

async function discountsFor(db, lineIds) {
  if (!lineIds.length) return new Map();
  const rows = await db.artfestFairSaleLineDiscount.findMany({ where: { saleLineId: { in: lineIds } } });
  return new Map(rows.map((r) => [r.saleLineId, r.snapshot || null]));
}

function emptyMoney() {
  return {
    listCents: 0,
    discountCents: 0,
    grossCents: 0,
    commissionCents: 0,
    vendorNetCents: 0,
    artfestFundedDiscountCents: 0,
    cashCents: 0,
    cardCents: 0,
    units: 0,
  };
}

// adună o linie (snapshot) la un total; CASH / CARD după metoda vânzării
function addLine(total, line, sale) {
  total.listCents += line.lineListCents;
  total.discountCents += line.lineDiscountCents;
  total.grossCents += line.lineGrossCents;
  total.commissionCents += line.commissionCents;
  total.vendorNetCents += line.vendorNetCents;
  total.artfestFundedDiscountCents += line.artfestFundedDiscountCents || 0;
  total.units += line.quantity;
  if (sale.paymentMethod === "CASH") total.cashCents += line.lineGrossCents;
  else if (sale.paymentMethod === "CARD") total.cardCents += line.lineGrossCents;
}

function addProduct(map, line) {
  const key = `${line.inventoryItemId}`;
  const p = map.get(key) || {
    inventoryItemId: line.inventoryItemId,
    vendorId: line.vendorId,
    title: line.titleSnapshot,
    variantLabel: line.variantLabel || null,
    barcodeDisplay: formatFairBarcode(line.barcodeSnapshot),
    quantity: 0,
    grossCents: 0,
  };
  p.quantity += line.quantity;
  p.grossCents += line.lineGrossCents;
  map.set(key, p);
}

function sortProducts(map) {
  return [...map.values()].sort((a, b) => b.quantity - a.quantity || b.grossCents - a.grossCents || (a.title < b.title ? -1 : 1));
}

/* ===================== Retururi (ziua returului) ===================== */

function emptyReversal() {
  return { units: 0, refundCents: 0, commissionReversedCents: 0, artfestFundedReversedCents: 0, vendorNetReversedCents: 0 };
}

/*
 * Retururile se raportează în ZIUA RETURULUI (return.createdAt), nu în ziua
 * vânzării. Separat, după cine suportă rambursarea:
 *   vendorBorne  - RESTOCKED (retur normal) + responsabil VENDOR: scad comisionul
 *                  și netul vendorului al zilei;
 *   artfestBorne - responsabil ARTFEST: vendorul rămâne neafectat; refundCents
 *                  e suportat de Artfest (sumele inversate rămân pentru audit).
 * Rambursările (numerar / card) includ toate liniile - banii au ieșit din casă.
 */
function emptyReturns() {
  return {
    count: 0,
    voidCount: 0,
    units: 0,
    refundCents: 0,
    cashRefundCents: 0,
    cardRefundCents: 0,
    vendorBorne: emptyReversal(),
    artfestBorne: emptyReversal(),
    byDisposition: { RESTOCKED: 0, NOT_RESTOCKED: 0, NOT_RETURNED: 0 },
  };
}

function addReversal(target, rl) {
  target.units += rl.quantity;
  target.refundCents += rl.refundCents;
  target.commissionReversedCents += rl.commissionReversedCents;
  target.artfestFundedReversedCents += rl.artfestFundedReversedCents || 0;
  target.vendorNetReversedCents += rl.vendorNetReversedCents;
}

function addReturnLine(total, rl, saleReturn) {
  total.units += rl.quantity;
  total.refundCents += rl.refundCents;
  if (saleReturn.refundMethod === "CASH") total.cashRefundCents += rl.refundCents;
  else if (saleReturn.refundMethod === "CARD") total.cardRefundCents += rl.refundCents;
  addReversal(rl.refundResponsibility === "ARTFEST" ? total.artfestBorne : total.vendorBorne, rl);
  total.byDisposition[rl.disposition] = (total.byDisposition[rl.disposition] || 0) + rl.quantity;
}

function finishReturns(total, returnsById, returnIds) {
  total.count = returnIds.size;
  total.voidCount = [...returnIds].filter((id) => returnsById.get(id)?.type === "VOID").length;
  return total;
}

// netul zilei = net din vânzările zilei − net inversat din retururile zilei imputate vendorului
function dayNet(salesTotals, returns) {
  return {
    dayCommissionCents: salesTotals.commissionCents - returns.vendorBorne.commissionReversedCents,
    dayVendorNetCents: salesTotals.vendorNetCents - returns.vendorBorne.vendorNetReversedCents,
    dayArtfestFundedCents: salesTotals.artfestFundedDiscountCents - returns.vendorBorne.artfestFundedReversedCents,
  };
}

// starea liniei pentru vendor (fără a dezvălui ce s-a întâmplat cu liniile altor vendori)
function lineStatus(line, sale) {
  if (sale.status === "VOIDED") return "VOIDED";
  if (!line.returnedQty) return "COMPLETED";
  return line.returnedQty >= line.quantity ? "RETURNED" : "PARTIALLY_RETURNED";
}

/* ===================== Vânzările vendorului ===================== */

// vendorul vede returul liniei lui: cantitate, stare, sume - fără motiv / note (pot conține date client)
function vendorReturnView(rl, saleReturn) {
  const { date, time } = localDateTime(saleReturn.createdAt);
  return {
    reference: saleReturn.reference,
    type: saleReturn.type,
    localDate: date,
    localTime: time,
    quantity: rl.quantity,
    disposition: rl.disposition,
    refundMethod: saleReturn.refundMethod,
    refundCents: rl.refundCents,
    commissionReversedCents: rl.commissionReversedCents,
    artfestFundedReversedCents: rl.artfestFundedReversedCents || 0,
    vendorNetReversedCents: rl.vendorNetReversedCents,
    // dacă rambursarea i-a afectat netul (false = suportată de Artfest); fără motivul intern
    affectsVendorNet: rl.refundResponsibility !== "ARTFEST",
    vendorNetImpactCents: rl.refundResponsibility === "ARTFEST" ? 0 : rl.vendorNetReversedCents,
  };
}

function serializeVendorLine(line, sale, discount, returnViews = []) {
  const { date, time } = localDateTime(sale.soldAt);
  const returned = returnViews.reduce(
    (t, r) => ({
      quantity: t.quantity + r.quantity,
      refundCents: t.refundCents + r.refundCents,
      commissionReversedCents: t.commissionReversedCents + r.commissionReversedCents,
      artfestFundedReversedCents: t.artfestFundedReversedCents + r.artfestFundedReversedCents,
      vendorNetReversedCents: t.vendorNetReversedCents + r.vendorNetReversedCents,
      vendorNetImpactCents: t.vendorNetImpactCents + r.vendorNetImpactCents,
    }),
    { quantity: 0, refundCents: 0, commissionReversedCents: 0, artfestFundedReversedCents: 0, vendorNetReversedCents: 0, vendorNetImpactCents: 0 }
  );
  return {
    saleLineId: line.id,
    saleNumber: sale.saleNumber,
    receiptReference: sale.receiptReference,
    soldAt: sale.soldAt,
    localDate: date,
    localTime: time,
    status: lineStatus(line, sale),
    paymentMethod: sale.paymentMethod,
    titleSnapshot: line.titleSnapshot,
    variantLabel: line.variantLabel || null,
    barcodeDisplay: formatFairBarcode(line.barcodeSnapshot),
    quantity: line.quantity,
    listUnitPriceCents: line.listUnitPriceCents,
    lineListCents: line.lineListCents,
    lineDiscountCents: line.lineDiscountCents,
    lineGrossCents: line.lineGrossCents,
    effectiveUnitPriceCents: line.effectiveUnitPriceCents,
    commissionCents: line.commissionCents,
    artfestFundedDiscountCents: line.artfestFundedDiscountCents || 0,
    vendorNetCents: line.vendorNetCents,
    // doar ce privește linia vendorului (fără alte linii / totalul vânzării / date client)
    discount: discount ? { name: discount.name || null, fundingSource: discount.fundingSource || null } : null,
    returnedQty: line.returnedQty || 0,
    returned,
    returns: returnViews,
  };
}

async function returnViewsFor(db, saleLineIds) {
  const map = new Map();
  if (!saleLineIds.length) return map;
  const rls = await db.artfestFairSaleReturnLine.findMany({ where: { saleLineId: { in: saleLineIds } } });
  if (!rls.length) return map;
  const headers = await db.artfestFairSaleReturn.findMany({ where: { id: { in: [...new Set(rls.map((r) => r.returnId))] } } });
  const byId = new Map(headers.map((h) => [h.id, h]));
  for (const rl of rls.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))) {
    const list = map.get(rl.saleLineId) || [];
    list.push(vendorReturnView(rl, byId.get(rl.returnId)));
    map.set(rl.saleLineId, list);
  }
  return map;
}

export async function listVendorSales({ vendorId, date = null, from = null, to = null, page = 1, limit = 50, db = prisma } = {}) {
  const fair = await ensureFair(db);
  let range = null;
  if (date) range = localDayRange(date);
  else if (from || to) {
    range = {
      start: from ? localDayRange(from).start : new Date(0),
      end: to ? localDayRange(to).end : new Date(8.64e15),
    };
  }

  const lines = await db.artfestFairSaleLine.findMany({ where: { fairId: fair.id, vendorId } });
  const saleIds = [...new Set(lines.map((l) => l.saleId))];
  const sales = saleIds.length
    ? await db.artfestFairSale.findMany({
        where: { id: { in: saleIds }, ...(range ? { soldAt: { gte: range.start, lt: range.end } } : {}) },
      })
    : [];
  const salesById = new Map(sales.map((s) => [s.id, s]));
  const own = lines
    .filter((l) => salesById.has(l.saleId))
    .sort((a, b) => new Date(salesById.get(b.saleId).soldAt) - new Date(salesById.get(a.saleId).soldAt) || (a.id < b.id ? -1 : 1));

  const size = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const current = Math.max(Number(page) || 1, 1);
  const pageLines = own.slice((current - 1) * size, current * size);
  const ids = pageLines.map((l) => l.id);
  const [discounts, returnViews] = await Promise.all([discountsFor(db, ids), returnViewsFor(db, ids)]);
  return {
    page: current,
    limit: size,
    total: own.length,
    items: pageLines.map((l) => serializeVendorLine(l, salesById.get(l.saleId), discounts.get(l.id), returnViews.get(l.id) || [])),
  };
}

/* ===================== Raport zilnic vendor ===================== */

export async function vendorDailyReport({ vendorId, date = null, db = prisma, now = new Date() } = {}) {
  const fair = await ensureFair(db);
  const range = localDayRange(date || todayLocal(now));

  // vânzările zilei (valorile de la vânzare, indiferent de retururile ulterioare)
  const sales = await salesInRange(db, fair.id, range);
  const salesById = new Map(sales.map((s) => [s.id, s]));
  const lines = sales.length
    ? await db.artfestFairSaleLine.findMany({ where: { saleId: { in: sales.map((s) => s.id) }, vendorId } })
    : [];
  const totals = emptyMoney();
  const products = new Map();
  const ownSales = new Set();
  for (const line of lines) {
    const sale = salesById.get(line.saleId);
    ownSales.add(sale.id);
    addLine(totals, line, sale);
    addProduct(products, line);
  }

  // retururile zilei pe liniile vendorului
  const returnHeaders = await returnsInRange(db, fair.id, range);
  const returnsById = new Map(returnHeaders.map((r) => [r.id, r]));
  const rls = returnHeaders.length
    ? await db.artfestFairSaleReturnLine.findMany({ where: { returnId: { in: returnHeaders.map((r) => r.id) }, vendorId } })
    : [];
  const returnedSaleLines = rls.length
    ? await db.artfestFairSaleLine.findMany({ where: { id: { in: [...new Set(rls.map((r) => r.saleLineId))] } } })
    : [];
  const saleLineById = new Map(returnedSaleLines.map((l) => [l.id, l]));
  const returnSaleIds = [...new Set(returnedSaleLines.map((l) => l.saleId))];
  const returnSales = returnSaleIds.length ? await db.artfestFairSale.findMany({ where: { id: { in: returnSaleIds } } }) : [];
  const returnSaleById = new Map(returnSales.map((s) => [s.id, s]));
  const returns = emptyReturns();
  const returnIds = new Set();
  for (const rl of rls) {
    addReturnLine(returns, rl, returnsById.get(rl.returnId));
    returnIds.add(rl.returnId);
  }
  finishReturns(returns, returnsById, returnIds);

  return {
    date: range.date,
    timeZone: range.timeZone,
    interval: { from: range.start, to: range.end },
    salesCount: ownSales.size,
    ...totals,
    products: sortProducts(products),
    returns,
    returnLines: rls
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map((rl) => {
        const sl = saleLineById.get(rl.saleLineId);
        return {
          ...vendorReturnView(rl, returnsById.get(rl.returnId)),
          saleNumber: returnSaleById.get(sl?.saleId)?.saleNumber ?? null,
          titleSnapshot: sl?.titleSnapshot || null,
          variantLabel: sl?.variantLabel || null,
        };
      }),
    ...dayNet(totals, returns),
  };
}

/* ===================== Raport zilnic Admin ===================== */

export async function adminDailyReport({ date = null, db = prisma, now = new Date() } = {}) {
  const fair = await ensureFair(db);
  const range = localDayRange(date || todayLocal(now));
  const sales = await salesInRange(db, fair.id, range);
  const salesById = new Map(sales.map((s) => [s.id, s]));
  const lines = sales.length ? await db.artfestFairSaleLine.findMany({ where: { saleId: { in: sales.map((s) => s.id) } } }) : [];

  // totalul târgului din liniile vânzărilor (snapshot); verificat cu antetul vânzărilor
  const totals = emptyMoney();
  const byVendor = new Map();
  const products = new Map();
  const vendorEntry = (vendorId) => {
    const v = byVendor.get(vendorId) || { vendorId, ...emptyMoney(), salesIds: new Set(), returns: emptyReturns(), returnIds: new Set() };
    byVendor.set(vendorId, v);
    return v;
  };
  for (const line of lines) {
    const sale = salesById.get(line.saleId);
    addLine(totals, line, sale);
    const v = vendorEntry(line.vendorId);
    addLine(v, line, sale);
    v.salesIds.add(sale.id);
    addProduct(products, line);
  }

  const headerTotals = sales.reduce(
    (acc, s) => {
      acc.listCents += s.listCents;
      acc.discountCents += s.discountCents;
      acc.totalPaidCents += s.totalPaidCents;
      acc.commissionCents += s.commissionCents;
      acc.vendorNetCents += s.vendorNetCents;
      acc.cashCents += s.cashCents || 0;
      acc.cardCents += s.cardCents || 0;
      return acc;
    },
    { listCents: 0, discountCents: 0, totalPaidCents: 0, commissionCents: 0, vendorNetCents: 0, cashCents: 0, cardCents: 0 }
  );

  // retururile zilei (ziua returului)
  const returnHeaders = await returnsInRange(db, fair.id, range);
  const returnsById = new Map(returnHeaders.map((r) => [r.id, r]));
  const rls = returnHeaders.length
    ? await db.artfestFairSaleReturnLine.findMany({ where: { returnId: { in: returnHeaders.map((r) => r.id) } } })
    : [];
  const returns = emptyReturns();
  for (const rl of rls) {
    const header = returnsById.get(rl.returnId);
    addReturnLine(returns, rl, header);
    const v = vendorEntry(rl.vendorId);
    addReturnLine(v.returns, rl, header);
    v.returnIds.add(rl.returnId);
  }
  finishReturns(returns, returnsById, new Set(returnHeaders.map((r) => r.id)));
  const returnHeaderTotals = returnHeaders.reduce(
    (acc, r) => ({
      refundCents: acc.refundCents + r.refundCents,
      commissionReversedCents: acc.commissionReversedCents + r.commissionReversedCents,
      vendorNetReversedCents: acc.vendorNetReversedCents + r.vendorNetReversedCents,
    }),
    { refundCents: 0, commissionReversedCents: 0, vendorNetReversedCents: 0 }
  );
  const lineReversal = (k) => returns.vendorBorne[k] + returns.artfestBorne[k];

  const vendorIds = [...byVendor.keys()];
  const [vendors, services] = vendorIds.length
    ? await Promise.all([
        db.vendor.findMany({ where: { id: { in: vendorIds } }, select: { id: true, displayName: true } }),
        db.vendorService.findMany({ where: { vendorId: { in: vendorIds } }, select: { vendorId: true, profile: { select: { displayName: true } } } }),
      ])
    : [[], []];
  const storeName = (vendorId) =>
    services.find((s) => s.vendorId === vendorId && s.profile?.displayName)?.profile.displayName ||
    vendors.find((v) => v.id === vendorId)?.displayName ||
    null;

  return {
    date: range.date,
    timeZone: range.timeZone,
    interval: { from: range.start, to: range.end },
    salesCount: sales.length,
    units: totals.units,
    listCents: totals.listCents,
    discountCents: totals.discountCents,
    totalPaidCents: totals.grossCents,
    cashCents: headerTotals.cashCents,
    cardCents: headerTotals.cardCents,
    commissionCents: totals.commissionCents,
    vendorNetCents: totals.vendorNetCents,
    artfestFundedDiscountCents: totals.artfestFundedDiscountCents,
    returns,
    // încasat net al zilei = încasări − toate rambursările (banii ieșiți din casă)
    netCollectedCents: totals.grossCents - returns.refundCents,
    netCashCents: headerTotals.cashCents - returns.cashRefundCents,
    netCardCents: headerTotals.cardCents - returns.cardRefundCents,
    ...dayNet(totals, returns),
    // reconcilierea antet <-> linii, pentru vânzări și retururi
    consistent:
      headerTotals.listCents === totals.listCents &&
      headerTotals.discountCents === totals.discountCents &&
      headerTotals.totalPaidCents === totals.grossCents &&
      headerTotals.commissionCents === totals.commissionCents &&
      headerTotals.vendorNetCents === totals.vendorNetCents &&
      returnHeaderTotals.refundCents === lineReversal("refundCents") &&
      returnHeaderTotals.commissionReversedCents === lineReversal("commissionReversedCents") &&
      returnHeaderTotals.vendorNetReversedCents === lineReversal("vendorNetReversedCents"),
    vendors: [...byVendor.values()]
      .map(({ salesIds, returnIds, returns: vReturns, ...v }) => ({
        ...v,
        storeName: storeName(v.vendorId),
        salesCount: salesIds.size,
        returns: finishReturns(vReturns, returnsById, returnIds),
        ...dayNet(v, vReturns),
      }))
      .sort((a, b) => b.grossCents - a.grossCents),
    products: sortProducts(products).map((p) => ({ ...p, storeName: storeName(p.vendorId) })),
    returnList: returnHeaders.map((r) => {
      const own = rls.filter((l) => l.returnId === r.id);
      const { date: d, time } = localDateTime(r.createdAt);
      return {
        id: r.id,
        reference: r.reference,
        type: r.type,
        saleId: r.saleId,
        localDate: d,
        localTime: time,
        refundMethod: r.refundMethod,
        reason: r.reason,
        refundCents: r.refundCents,
        commissionReversedCents: r.commissionReversedCents,
        vendorNetReversedCents: r.vendorNetReversedCents,
        vendorBorneRefundCents: own.filter((l) => l.refundResponsibility !== "ARTFEST").reduce((s, l) => s + l.refundCents, 0),
        artfestBorneRefundCents: own.filter((l) => l.refundResponsibility === "ARTFEST").reduce((s, l) => s + l.refundCents, 0),
        units: own.reduce((s, l) => s + l.quantity, 0),
        dispositions: [...new Set(own.map((l) => l.disposition))],
      };
    }),
  };
}

/* ===================== CSV ===================== */

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const lei = (cents) => (Number(cents || 0) / 100).toFixed(2).replace(".", ",");

// separator „;” + BOM: se deschide corect în Excel cu setări românești
function toCsv(rows) {
  return "﻿" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n") + "\r\n";
}

const DISPOSITION_CSV = { RESTOCKED: "Returnat, revandabil", NOT_RESTOCKED: "Returnat, nevandabil", NOT_RETURNED: "Rambursare fără produs" };

function returnRows(returns) {
  return [
    ["Retururi / anulări", returns.count],
    ["Bucăți returnate / rambursate", returns.units],
    ["Rambursat total (lei)", lei(returns.refundCents)],
    ["Rambursat numerar (lei)", lei(returns.cashRefundCents)],
    ["Rambursat card (lei)", lei(returns.cardRefundCents)],
    ["Rambursări suportate de vendor (lei)", lei(returns.vendorBorne.refundCents)],
    ["Rambursări suportate de Artfest (lei)", lei(returns.artfestBorne.refundCents)],
    ["Comision inversat - imputat vendorului (lei)", lei(returns.vendorBorne.commissionReversedCents)],
    ["Net vendor inversat - imputat vendorului (lei)", lei(returns.vendorBorne.vendorNetReversedCents)],
  ];
}

export function vendorReportCsv(report) {
  const rows = [
    ["Raport zilnic Târg Artfest", report.date, `fus orar ${report.timeZone}`],
    ["Vânzările zilei (valori la vânzare) și retururile înregistrate în această zi"],
    [],
    ["Indicator", "Valoare"],
    ["Vânzări", report.salesCount],
    ["Bucăți vândute", report.units],
    ["Valoare brută (lei)", lei(report.listCents)],
    ["Reduceri (lei)", lei(report.discountCents)],
    ["Încasat pentru produsele tale (lei)", lei(report.grossCents)],
    ["Comision Artfest (lei)", lei(report.commissionCents)],
    ["Compensație Artfest pentru reduceri (lei)", lei(report.artfestFundedDiscountCents)],
    ["Net vendor din vânzări (lei)", lei(report.vendorNetCents)],
    ["Numerar (lei)", lei(report.cashCents)],
    ["Card (lei)", lei(report.cardCents)],
    ...returnRows(report.returns),
    ["Net al zilei = net vânzări − net retururi imputate ție (lei)", lei(report.dayVendorNetCents)],
    [],
    ["Produs", "Variantă", "Cod", "Cantitate", "Total (lei)"],
    ...report.products.map((p) => [p.title, p.variantLabel || "", p.barcodeDisplay, p.quantity, lei(p.grossCents)]),
    [],
    ["Retur", "Ora", "Vânzare", "Produs", "Variantă", "Cantitate", "Stare", "Rambursat (lei)", "Îți afectează netul", "Net scăzut din netul tău (lei)"],
    ...report.returnLines.map((r) => [
      r.reference, r.localTime, r.saleNumber ?? "", r.titleSnapshot || "", r.variantLabel || "", r.quantity,
      DISPOSITION_CSV[r.disposition] || r.disposition, lei(r.refundCents), r.affectsVendorNet ? "Da" : "Nu (suportat de Artfest)", lei(r.vendorNetImpactCents),
    ]),
  ];
  return toCsv(rows);
}

export function adminReportCsv(report) {
  const rows = [
    ["Raport zilnic Târg Artfest (Admin)", report.date, `fus orar ${report.timeZone}`],
    ["Vânzările zilei (valori la vânzare) și retururile înregistrate în această zi"],
    [],
    ["Indicator", "Valoare"],
    ["Vânzări", report.salesCount],
    ["Bucăți", report.units],
    ["Vânzări brute (lei)", lei(report.listCents)],
    ["Reduceri (lei)", lei(report.discountCents)],
    ["Total încasat (lei)", lei(report.totalPaidCents)],
    ["Numerar (lei)", lei(report.cashCents)],
    ["Card (lei)", lei(report.cardCents)],
    ["Comision Artfest (lei)", lei(report.commissionCents)],
    ["Net datorat vendorilor din vânzări (lei)", lei(report.vendorNetCents)],
    ["Compensații Artfest pentru reduceri (lei)", lei(report.artfestFundedDiscountCents)],
    ...returnRows(report.returns),
    ["Încasat net al zilei (lei)", lei(report.netCollectedCents)],
    ["Numerar net (lei)", lei(report.netCashCents)],
    ["Card net (lei)", lei(report.netCardCents)],
    ["Comision net al zilei (lei)", lei(report.dayCommissionCents)],
    ["Net vendori al zilei (lei)", lei(report.dayVendorNetCents)],
    [],
    ["Magazin", "Vânzări", "Bucăți", "Brut (lei)", "Reduceri (lei)", "Încasat (lei)", "Comision (lei)", "Net vendor (lei)", "Rambursat total (lei)", "Rambursat - suportat de vendor (lei)", "Rambursat - suportat de Artfest (lei)", "Net inversat imputat (lei)", "Net al zilei (lei)"],
    ...report.vendors.map((v) => [
      v.storeName || v.vendorId, v.salesCount, v.units, lei(v.listCents), lei(v.discountCents), lei(v.grossCents), lei(v.commissionCents), lei(v.vendorNetCents),
      lei(v.returns.refundCents), lei(v.returns.vendorBorne.refundCents), lei(v.returns.artfestBorne.refundCents), lei(v.returns.vendorBorne.vendorNetReversedCents), lei(v.dayVendorNetCents),
    ]),
    [],
    ["Produs", "Variantă", "Magazin", "Cod", "Cantitate", "Valoare (lei)"],
    ...report.products.map((p) => [p.title, p.variantLabel || "", p.storeName || "", p.barcodeDisplay, p.quantity, lei(p.grossCents)]),
    [],
    ["Retur", "Tip", "Ora", "Metodă", "Bucăți", "Rambursat (lei)", "Suportat de vendor (lei)", "Suportat de Artfest (lei)", "Comision inversat (lei)", "Net vendor inversat (lei)", "Motiv"],
    ...report.returnList.map((r) => [r.reference, r.type, r.localTime, r.refundMethod, r.units, lei(r.refundCents), lei(r.vendorBorneRefundCents), lei(r.artfestBorneRefundCents), lei(r.commissionReversedCents), lei(r.vendorNetReversedCents), r.reason]),
  ];
  return toCsv(rows);
}
