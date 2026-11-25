// backend/src/services/artfestFairSummaryService.js
//
// Târgul Artfest - situația pe scurt (doar citire), pentru vendor și Admin:
//   - azi (ziua locală Europe/Bucharest) și total la târg;
//   - încasări din produse, suma cuvenită vendorului, partea Artfest
//     (comisionul de 10% din prețul efectiv, pentru toate vânzările);
//   - anulările (VOID) și retururile (RETURN), separat;
//   - decontat (deconturi PLĂTITE) și rest de primit.
//
// Sursa: valorile SALVATE la vânzare / retur (liniile de vânzare și de retur) și
// deconturile existente. Nimic nu se recalculează și nimic nu se scrie.
// Taxa de participare NU intră aici (se gestionează separat).
//
// Reguli (aceleași ca rapoartele zilnice și decontul):
//   - vânzările: în ziua vânzării, cu valorile inițiale (orice status ulterior);
//   - anulările / retururile: în ziua lor; rambursarea suportată de ARTFEST nu
//     scade suma vendorului (refundResponsibility = ARTFEST);
//   - cuvenit vendor = net din vânzări − net inversat la retururile imputate vendorului;
//   - rest de primit = cuvenit + ajustări din deconturile închise − plătit.

import { prisma } from "../db.js";
import { ensureFair } from "./artfestFairService.js";
import { formatFairBarcode } from "./artfestFairInventoryService.js";
import { localDayRange, todayLocal } from "./artfestFairReportsService.js";
import { ownerName } from "../lib/artfestFairOwner.js";

const CLOSED_SETTLEMENT_STATUSES = ["FINALIZED", "PAID", "CARRIED_FORWARD"];

function emptySales() {
  return { units: 0, grossCents: 0, vendorNetCents: 0, artfestCents: 0 };
}

function emptyReversals() {
  return { count: 0, units: 0, refundCents: 0, vendorNetReversedCents: 0, artfestReversedCents: 0 };
}

function emptyBucket() {
  return { sales: emptySales(), voids: emptyReversals(), returns: emptyReversals() };
}

function addSale(bucket, line) {
  bucket.sales.units += line.quantity;
  bucket.sales.grossCents += line.lineGrossCents;
  bucket.sales.vendorNetCents += line.vendorNetCents;
  bucket.sales.artfestCents += line.commissionCents;
}

// suma inversată a vendorului: doar dacă rambursarea îl privește (nu ARTFEST)
function vendorImpact(rl) {
  return rl.refundResponsibility === "ARTFEST" ? 0 : rl.vendorNetReversedCents;
}

function addReversal(target, rl) {
  target.units += rl.quantity;
  target.refundCents += rl.refundCents;
  target.vendorNetReversedCents += vendorImpact(rl);
  target.artfestReversedCents += rl.refundCents - vendorImpact(rl);
}

function finish(bucket) {
  const refunds = bucket.voids.refundCents + bucket.returns.refundCents;
  const vendorReversed = bucket.voids.vendorNetReversedCents + bucket.returns.vendorNetReversedCents;
  const collectedCents = bucket.sales.grossCents - refunds;
  const vendorDueCents = bucket.sales.vendorNetCents - vendorReversed;
  return {
    ...bucket,
    net: {
      // încasări din produse, după anulări și retururi
      collectedCents,
      // suma cuvenită vendorului / vendorilor
      vendorDueCents,
      // partea cuvenită Artfest (comisionul, după anulări / retururi)
      artfestCents: collectedCents - vendorDueCents,
      unitsSold: bucket.sales.units - bucket.voids.units - bucket.returns.units,
    },
  };
}

function addProduct(map, line) {
  const p = map.get(line.inventoryItemId) || {
    inventoryItemId: line.inventoryItemId,
    title: line.titleSnapshot,
    variantLabel: line.variantLabel || null,
    barcodeDisplay: formatFairBarcode(line.barcodeSnapshot),
    quantity: 0,
    grossCents: 0,
    vendorNetCents: 0,
    unitPricesCents: [],
  };
  p.quantity += line.quantity;
  p.grossCents += line.lineGrossCents;
  p.vendorNetCents += line.vendorNetCents;
  // prețul final efectiv pe bucată (poate diferi între vânzări: reduceri / preț editat)
  const unit = Math.round(line.lineGrossCents / line.quantity);
  if (!p.unitPricesCents.includes(unit)) p.unitPricesCents.push(unit);
  map.set(line.inventoryItemId, p);
}

async function loadFairData(db, fairId, vendorId) {
  const lineWhere = { fairId, ...(vendorId ? { vendorId } : {}) };
  const lines = await db.artfestFairSaleLine.findMany({ where: lineWhere });
  const saleIds = [...new Set(lines.map((l) => l.saleId))];
  const sales = saleIds.length
    ? await db.artfestFairSale.findMany({ where: { id: { in: saleIds } }, select: { id: true, soldAt: true, status: true } })
    : [];
  const returns = await db.artfestFairSaleReturn.findMany({ where: { fairId } });
  const returnLines = returns.length
    ? await db.artfestFairSaleReturnLine.findMany({
        where: { returnId: { in: returns.map((r) => r.id) }, ...(vendorId ? { vendorId } : {}) },
      })
    : [];
  const settlements = await db.artfestFairSettlement.findMany({
    where: { fairId, ...(vendorId ? { vendorId } : {}), status: { in: CLOSED_SETTLEMENT_STATUSES } },
  });
  const adjustments = settlements.length
    ? await db.artfestFairSettlementAdjustment.findMany({ where: { settlementId: { in: settlements.map((s) => s.id) } } })
    : [];
  return { lines, sales, returns, returnLines, settlements, adjustments };
}

function inRange(value, range) {
  const t = new Date(value).getTime();
  return t >= range.start.getTime() && t < range.end.getTime();
}

/*
 * Totalurile, pe vendor și pe târg. `vendorId` limitează TOTUL la vendorul dat
 * (vendorul nu vede niciodată liniile / sumele altor vendori).
 */
async function buildSummary({ db, vendorId = null, now = new Date() }) {
  const fair = await ensureFair(db);
  const date = todayLocal(now);
  const today = localDayRange(date);
  const data = await loadFairData(db, fair.id, vendorId);
  const salesById = new Map(data.sales.map((s) => [s.id, s]));
  const returnsById = new Map(data.returns.map((r) => [r.id, r]));

  const vendors = new Map();
  const vendorBucket = (id) => {
    if (!vendors.has(id)) {
      vendors.set(id, { vendorId: id, today: emptyBucket(), total: emptyBucket(), todayProducts: new Map(), paidCents: 0, adjustmentsCents: 0 });
    }
    return vendors.get(id);
  };
  const fairTotal = { today: emptyBucket(), total: emptyBucket() };

  for (const line of data.lines) {
    const sale = salesById.get(line.saleId);
    if (!sale) continue;
    const v = vendorBucket(line.vendorId);
    addSale(v.total, line);
    addSale(fairTotal.total, line);
    if (inRange(sale.soldAt, today)) {
      addSale(v.today, line);
      addSale(fairTotal.today, line);
      addProduct(v.todayProducts, line);
    }
  }

  const reversalIds = { today: { voids: new Set(), returns: new Set() }, total: { voids: new Set(), returns: new Set() } };
  for (const rl of data.returnLines) {
    const header = returnsById.get(rl.returnId);
    if (!header) continue;
    const kind = header.type === "VOID" ? "voids" : "returns";
    const v = vendorBucket(rl.vendorId);
    addReversal(v.total[kind], rl);
    addReversal(fairTotal.total[kind], rl);
    reversalIds.total[kind].add(header.id);
    if (inRange(header.createdAt, today)) {
      addReversal(v.today[kind], rl);
      addReversal(fairTotal.today[kind], rl);
      reversalIds.today[kind].add(header.id);
    }
  }
  for (const scope of ["today", "total"]) {
    for (const kind of ["voids", "returns"]) fairTotal[scope][kind].count = reversalIds[scope][kind].size;
  }

  const settlementVendor = new Map(data.settlements.map((s) => [s.id, s.vendorId]));
  for (const s of data.settlements) if (s.status === "PAID") vendorBucket(s.vendorId).paidCents += s.finalDueCents;
  for (const a of data.adjustments) vendorBucket(settlementVendor.get(a.settlementId)).adjustmentsCents += a.amountCents;

  // liniile Artfest (stoc propriu) au vendorId NULL: rând „Artfest (stoc propriu)”, fără sumă de plătit
  const vendorIds = [...vendors.keys()].filter(Boolean);
  const names = vendorIds.length
    ? new Map(
        (await db.vendor.findMany({ where: { id: { in: vendorIds } }, select: { id: true, displayName: true } })).map((v) => [
          v.id,
          v.displayName,
        ])
      )
    : new Map();

  const rows = [...vendors.values()].map((v) => {
    const total = finish(v.total);
    const dueCents = total.net.vendorDueCents + v.adjustmentsCents;
    return {
      vendorId: v.vendorId,
      vendorName: ownerName(v.vendorId, names),
      artfestOwned: !v.vendorId,
      today: finish(v.today),
      total,
      todayProducts: [...v.todayProducts.values()].sort((a, b) => b.quantity - a.quantity || (a.title < b.title ? -1 : 1)),
      settlement: {
        // suma cuvenită, cu ajustările din deconturile închise
        dueCents,
        adjustmentsCents: v.adjustmentsCents,
        // deja decontat = deconturi PLĂTITE
        paidCents: v.paidCents,
        remainingCents: dueCents - v.paidCents,
      },
    };
  });
  rows.sort((a, b) => b.total.sales.grossCents - a.total.sales.grossCents || String(a.vendorName).localeCompare(String(b.vendorName), "ro"));

  const settlementTotal = rows.reduce(
    (t, r) => ({
      dueCents: t.dueCents + r.settlement.dueCents,
      adjustmentsCents: t.adjustmentsCents + r.settlement.adjustmentsCents,
      paidCents: t.paidCents + r.settlement.paidCents,
      remainingCents: t.remainingCents + r.settlement.remainingCents,
    }),
    { dueCents: 0, adjustmentsCents: 0, paidCents: 0, remainingCents: 0 }
  );

  return {
    date,
    timeZone: today.timeZone,
    fairTitle: fair.title || null,
    rows,
    totals: { today: finish(fairTotal.today), total: finish(fairTotal.total), settlement: settlementTotal },
  };
}

/** Situația vendorului din sesiune (doar liniile lui). */
export async function vendorFairSummary({ vendorId, db = prisma, now = new Date() }) {
  const summary = await buildSummary({ db, vendorId, now });
  const own = summary.rows.find((r) => r.vendorId === vendorId);
  const empty = finish(emptyBucket());
  return {
    date: summary.date,
    timeZone: summary.timeZone,
    today: own ? own.today : empty,
    todayProducts: own ? own.todayProducts : [],
    total: own ? own.total : empty,
    settlement: own ? own.settlement : { dueCents: 0, adjustmentsCents: 0, paidCents: 0, remainingCents: 0 },
  };
}

/** Situația Admin: pe vendor + total târg (azi și total). Taxa de participare e separată. */
export async function adminFairSummary({ db = prisma, now = new Date() } = {}) {
  const summary = await buildSummary({ db, now });
  return {
    ...summary,
    // lista de produse vândute azi rămâne la vendor; Adminul vede totalurile pe vendor
    rows: summary.rows.map(({ todayProducts, ...rest }) => ({ ...rest, todayUnits: todayProducts.reduce((s, p) => s + p.quantity, 0) })),
    participationFeeIncluded: false,
  };
}
