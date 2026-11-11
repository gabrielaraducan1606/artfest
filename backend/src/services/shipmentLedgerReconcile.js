// backend/src/services/shipmentLedgerReconcile.js
//
// Reconcilierea ledger-ului de vânzare pentru Shipment OUTBOUND ajunse în
// IN_TRANSIT / DELIVERED, după un eșec al ledger-ului apărut DUPĂ schimbarea
// statusului (vendor, Admin, „Marchează ridicat”, status-sync).
//
// OPRITĂ implicit:
//  - SHIPMENT_LEDGER_RECONCILE_ENABLED=true  -> jobul rulează (doar raport);
//  - SHIPMENT_LEDGER_RECONCILE_REPAIR=true   -> în plus, reface intrările lipsă.
//
// Ce face:
//  - DETECTEAZĂ: SALE vendor lipsă, influencer lipsă (atribuit, bps > 0),
//    referral vendor lipsă (atribuit);
//  - REFACE doar prin logica comună (services/shipmentSaleLedger.js), adică
//    aceleași helper-e și formule ca fluxurile normale - nicio recalculare
//    proprie; idempotent (unicitate pe shipmentId).
//
// Ce NU face:
//  - nu modifică / nu șterge intrări existente (upsert cu update: {});
//  - nu atinge perioade închise: o intrare refăcută primește occurredAt =
//    momentul creării efective (regula existentă), are payoutId = null și
//    intră o singură dată în luna deschisă - fără factură dublă;
//  - CARD online: nu creează SALE (doar webhook-ul Stripe), nu atinge Stripe;
//    SALE CARD lipsă = doar raportat (card_sale_missing);
//  - expedieri cu REFUND înregistrat sau comenzi anulate: doar raportate
//    (refund_recorded / order_cancelled) - fără vânzare după rambursare;
//  - RETURN: niciodată.

import { prisma as defaultPrisma } from "../db.js";
import { ensureShipmentSaleLedgers, saleLedgerPaymentKind, SALE_LEDGER_SHIPMENT_STATUSES } from "./shipmentSaleLedger.js";

export const LEDGER_RECONCILE_META_SOURCE = "ledger_reconcile";

const DEFAULT_LOOKBACK_DAYS = 30;
const MAX_LOOKBACK_DAYS = 365;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;

const isTrue = (v) => String(v ?? "").trim().toLowerCase() === "true";

function boundedInt(raw, { fallback, min, max }) {
  const n = Number(raw);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

export function shipmentLedgerReconcileConfig(env = process.env) {
  return {
    enabled: isTrue(env.SHIPMENT_LEDGER_RECONCILE_ENABLED),
    repair: isTrue(env.SHIPMENT_LEDGER_RECONCILE_REPAIR),
    lookbackDays: boundedInt(env.SHIPMENT_LEDGER_RECONCILE_LOOKBACK_DAYS, { fallback: DEFAULT_LOOKBACK_DAYS, min: 1, max: MAX_LOOKBACK_DAYS }),
    limit: boundedInt(env.SHIPMENT_LEDGER_RECONCILE_LIMIT, { fallback: DEFAULT_LIMIT, min: 1, max: MAX_LIMIT }),
  };
}

/**
 * Ce lipsește și ce e voie să se facă (funcție pură).
 * @param {Object} row  Shipment cu order + cele 3 intrări (doar id) + hasVendorRefund
 * @returns {{ missing: string[], action: "ok"|"repair"|"report"|"skip", reason: string }}
 */
export function classifyShipmentLedgerGap(row) {
  if (String(row?.direction || "OUTBOUND") !== "OUTBOUND") return { missing: [], action: "skip", reason: "not_outbound" };
  if (!SALE_LEDGER_SHIPMENT_STATUSES.includes(String(row?.status))) return { missing: [], action: "skip", reason: "status_not_eligible" };

  const missing = [];
  if (!row.vendorEarningEntry) missing.push("SALE");
  // aceleași condiții ca helper-ele existente (bps > 0), altfel nu e o lipsă
  const positiveBps = (v) => Number.isInteger(Number(v || 0)) && Number(v || 0) > 0;
  if (row.influencerId && positiveBps(row.influencerCommissionBpsSnapshot) && !row.influencerEarningEntry) missing.push("INFLUENCER");
  if (row.referrerVendorId && positiveBps(row.referrerVendorCommissionBpsSnapshot) && !row.vendorReferralEarningEntry) missing.push("REFERRAL");
  if (!missing.length) return { missing, action: "ok", reason: "complete" };

  // fără vânzare după anulare / rambursare: decizie umană, nu automată
  if (String(row.order?.status || "").toUpperCase() === "CANCELLED") return { missing, action: "report", reason: "order_cancelled" };
  if (row.hasVendorRefund) return { missing, action: "report", reason: "refund_recorded" };

  const kind = saleLedgerPaymentKind(row.order);
  if (kind === "online_card_unpaid") return { missing, action: "report", reason: "card_unpaid" };
  // SALE-ul CARD online îl creează DOAR webhook-ul Stripe (cu transferul)
  if (kind === "online_card_paid" && missing.includes("SALE")) return { missing, action: "report", reason: "card_sale_missing" };
  return { missing, action: "repair", reason: kind };
}

const CANDIDATE_SELECT = {
  id: true,
  vendorId: true,
  orderId: true,
  status: true,
  direction: true,
  updatedAt: true,
  influencerId: true,
  influencerCommissionBpsSnapshot: true,
  referrerVendorId: true,
  referrerVendorCommissionBpsSnapshot: true,
  order: { select: { status: true, paymentMethod: true, paidAt: true, userId: true, isGuestOrder: true, stripeCheckoutSessionId: true, stripePaymentIntentId: true } },
  vendorEarningEntry: { select: { id: true } },
  influencerEarningEntry: { select: { id: true } },
  vendorReferralEarningEntry: { select: { id: true } },
};

/**
 * Expedierile OUTBOUND în IN_TRANSIT / DELIVERED, actualizate după `since`,
 * cărora le lipsește cel puțin o intrare. Doar citiri.
 */
export async function findShipmentLedgerGaps({ db = defaultPrisma, since, limit = DEFAULT_LIMIT }) {
  const rows = await db.shipment.findMany({
    where: {
      direction: "OUTBOUND",
      status: { in: [...SALE_LEDGER_SHIPMENT_STATUSES] },
      updatedAt: { gte: since },
      OR: [
        { vendorEarningEntry: { is: null } },
        { influencerId: { not: null }, influencerCommissionBpsSnapshot: { gt: 0 }, influencerEarningEntry: { is: null } },
        { referrerVendorId: { not: null }, referrerVendorCommissionBpsSnapshot: { gt: 0 }, vendorReferralEarningEntry: { is: null } },
      ],
    },
    select: CANDIDATE_SELECT,
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT),
  });
  if (!rows.length) return [];

  // REFUND-ul vendorului referă expedierea prin meta.refShipmentId (ensureRefundLedgerEntry)
  const ids = rows.map((r) => r.id);
  const refunded = await db.$queryRaw`
    SELECT DISTINCT meta->>'refShipmentId' AS "shipmentId"
      FROM "VendorEarningEntry"
     WHERE type = 'REFUND'
       AND meta->>'refShipmentId' = ANY(${ids}::text[])`;
  const refundedIds = new Set(refunded.map((r) => r.shipmentId));

  return rows.map((row) => {
    const enriched = { ...row, hasVendorRefund: refundedIds.has(row.id) };
    return { row: enriched, ...classifyShipmentLedgerGap(enriched) };
  });
}

/**
 * O rulare. Implicit DOAR raport (dryRun = true). Nu aruncă pentru o
 * expediere eșuată - o numără și continuă.
 */
export async function reconcileShipmentLedgers({
  db = defaultPrisma,
  dryRun = true,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  limit = DEFAULT_LIMIT,
  now = () => new Date(),
  ensure = ensureShipmentSaleLedgers,
  log = console,
} = {}) {
  const days = boundedInt(lookbackDays, { fallback: DEFAULT_LOOKBACK_DAYS, min: 1, max: MAX_LOOKBACK_DAYS });
  const since = new Date(now().getTime() - days * 24 * 60 * 60 * 1000);
  const summary = { status: "ok", dryRun: Boolean(dryRun), since: since.toISOString(), scanned: 0, repairable: 0, repaired: 0, reported: 0, failed: 0, items: [] };

  const gaps = await findShipmentLedgerGaps({ db, since, limit });
  for (const gap of gaps) {
    summary.scanned++;
    const item = { shipmentId: gap.row.id, orderId: gap.row.orderId, status: gap.row.status, missing: gap.missing, action: gap.action, reason: gap.reason };
    if (gap.action === "report") summary.reported++;
    if (gap.action === "repair") {
      summary.repairable++;
      if (!dryRun) {
        try {
          // aceeași logică ca fluxurile normale; rezultat recitit din DB (stare proaspătă)
          const result = await ensure({ shipmentId: gap.row.id, metaSource: LEDGER_RECONCILE_META_SOURCE, db });
          item.result = result;
          if (result?.ok) summary.repaired++;
          else summary.failed++;
        } catch (e) {
          summary.failed++;
          item.result = { ok: false, reason: e?.code || e?.name || "error" };
          log.error?.(`[ledger-reconcile] eșuat pentru ${gap.row.id}: ${e?.name || "Error"}`);
        }
      }
    }
    if (gap.action !== "ok" && gap.action !== "skip") summary.items.push(item);
  }
  if (summary.failed) summary.status = "partial";
  return summary;
}

/**
 * Jobul periodic. OPRIT implicit (SHIPMENT_LEDGER_RECONCILE_ENABLED != true).
 * Pornit fără SHIPMENT_LEDGER_RECONCILE_REPAIR=true doar raportează.
 * @returns {{ stop: Function, tick: Function } | null}
 */
export function startShipmentLedgerReconcileJob({
  env = process.env,
  intervalMs = DEFAULT_INTERVAL_MS,
  run = reconcileShipmentLedgers,
  log = console,
} = {}) {
  const cfg = shipmentLedgerReconcileConfig(env);
  if (!cfg.enabled) {
    log.info?.("[ledger-reconcile] job oprit (SHIPMENT_LEDGER_RECONCILE_ENABLED != true)");
    return null;
  }
  let running = false;
  const tick = async () => {
    if (running) return null;
    running = true;
    try {
      const r = await run({ dryRun: !cfg.repair, lookbackDays: cfg.lookbackDays, limit: cfg.limit });
      if (r.repairable || r.reported || r.failed) {
        log.warn?.(`[ledger-reconcile] ${r.dryRun ? "raport" : "reparare"}: de refăcut ${r.repairable}, refăcute ${r.repaired}, doar raportate ${r.reported}, eșuate ${r.failed}`);
      }
      return r;
    } catch (e) {
      log.error?.(`[ledger-reconcile] eroare neașteptată: ${e?.name || "Error"}`);
      return null;
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer), tick };
}
