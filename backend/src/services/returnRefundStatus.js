// backend/src/services/returnRefundStatus.js

/*
 * Starea RETURURILOR văzută din Admin > Comenzi - DOAR citire, derivată din
 * ReturnRequest.status + ledger (VendorEarningEntry REFUND), fără coloane noi.
 *
 * Plus eligibilitatea pentru retururile INTEGRALE (fără refund parțial):
 *   - CARD: refund integral al comenzii (fluxul existent refundCardOrderFully)
 *     DOAR dacă retururile primite acoperă TOATE coletele de vânzare ale
 *     comenzii, integral (fiecare linie, toată cantitatea).
 *   - COD: corecție integrală de comision pe UN colet (ensureRefundLedgerEntry
 *     existent) DOAR dacă retururile primite acoperă tot coletul. Banii
 *     către client rămân rambursați de vânzător, în afara platformei.
 *
 * "Corectat" = există REFUND în ledger pentru coletul original
 * (meta.refShipmentId === originalShipmentId) - exact ce scriu
 * ensureRefundLedgerEntry / refundCardOrderFully.
 */

import { prisma as defaultPrisma } from "../db.js";

export const RETURN_BADGES = Object.freeze({
  REQUESTED: "Retur solicitat",
  ACCEPTED: "Retur acceptat",
  RECEIVED_PENDING_REFUND: "Produs returnat · rambursare în așteptare",
  REFUNDED: "Rambursat / corectat",
  REJECTED: "Retur respins",
});

export function returnBadgeCode({ status, corrected }) {
  if (status === "REJECTED") return "REJECTED";
  if (corrected) return "REFUNDED";
  if (status === "CLOSED") return "RECEIVED_PENDING_REFUND";
  if (status === "APPROVED" || status === "PICKUP_REQUESTED") return "ACCEPTED";
  return "REQUESTED"; // NEW / IN_REVIEW
}

const isOutbound = (shipment) => String(shipment?.direction || "OUTBOUND") !== "RETURN";

/*
 * Coletul e acoperit integral dacă, însumând articolele din retururile
 * PRIMITE (CLOSED) pe el, fiecare linie are cel puțin cantitatea livrată.
 * Articolele fără shipmentItemId nu pot fi potrivite -> neacoperit.
 */
export function returnCoversShipment(shipment, returns = []) {
  const items = shipment?.items || [];
  if (!items.length) return false;

  const returnedQty = new Map();

  for (const rr of returns) {
    if (rr.status !== "CLOSED" || rr.originalShipmentId !== shipment.id) continue;

    for (const item of rr.items || []) {
      if (!item.shipmentItemId) continue;
      returnedQty.set(item.shipmentItemId, (returnedQty.get(item.shipmentItemId) || 0) + Number(item.qty || 0));
    }
  }

  return items.every((item) => (returnedQty.get(item.id) || 0) >= Number(item.qty || 0));
}

/*
 * order: cu shipments (id, vendorId, direction, status, items[id, qty])
 * returns: ReturnRequest-urile comenzii (id, status, vendorId,
 *          originalShipmentId, items[shipmentItemId, qty])
 * refundedShipmentIds: Set cu coletele care au deja REFUND în ledger
 * saleShipmentIds: Set cu coletele care au SALE propriu în ledger
 */
export function evaluateReturnRefunds({ order, returns = [], refundedShipmentIds = new Set(), saleShipmentIds = new Set() }) {
  const paymentMethod = String(order?.paymentMethod || "").toUpperCase();
  const outbound = (order?.shipments || []).filter(isOutbound);

  const returnSummaries = returns.map((rr) => {
    const corrected = refundedShipmentIds.has(rr.originalShipmentId);
    const code = returnBadgeCode({ status: rr.status, corrected });

    return {
      returnRequestId: rr.id,
      vendorId: rr.vendorId,
      originalShipmentId: rr.originalShipmentId,
      status: rr.status,
      corrected,
      badge: code,
      badgeLabel: RETURN_BADGES[code],
    };
  });

  let cardFullRefund = { eligible: false, reason: "not_card" };

  if (paymentMethod === "CARD") {
    const uncovered = outbound.filter((s) => !returnCoversShipment(s, returns));
    const allRefunded = outbound.length > 0 && outbound.every((s) => refundedShipmentIds.has(s.id));

    if (!returns.length) cardFullRefund = { eligible: false, reason: "no_returns" };
    else if (!order.stripeChargeId) cardFullRefund = { eligible: false, reason: "card_charge_missing" };
    else if (allRefunded) cardFullRefund = { eligible: false, reason: "already_refunded" };
    else if (!outbound.length || uncovered.length)
      cardFullRefund = {
        eligible: false,
        reason: "return_not_full_order",
        uncoveredShipmentIds: uncovered.map((s) => s.id),
      };
    else cardFullRefund = { eligible: true, reason: null };
  }

  const codCorrections =
    paymentMethod === "COD"
      ? outbound
          .filter((s) => returns.some((rr) => rr.originalShipmentId === s.id))
          .map((s) => {
            let reason = null;
            if (refundedShipmentIds.has(s.id)) reason = "already_corrected";
            else if (!returnCoversShipment(s, returns)) reason = "return_not_full_shipment";
            else if (!saleShipmentIds.has(s.id)) reason = "no_sale_to_correct";

            return { shipmentId: s.id, vendorId: s.vendorId, eligible: !reason, reason };
          })
      : [];

  return { returns: returnSummaries, cardFullRefund, codCorrections };
}

/*
 * Încarcă retururile + REFUND/SALE din ledger pentru mai multe comenzi.
 * Întoarce Map orderId -> { returns, refundedShipmentIds, saleShipmentIds }.
 */
export async function loadReturnLedgerState({ db = defaultPrisma, orderIds = [] }) {
  const byOrder = new Map();
  if (!orderIds.length) return byOrder;

  const [returns, entries] = await Promise.all([
    db.returnRequest.findMany({
      where: { orderId: { in: orderIds } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        orderId: true,
        vendorId: true,
        status: true,
        originalShipmentId: true,
        createdAt: true,
        items: { select: { shipmentItemId: true, qty: true } },
      },
    }),
    db.vendorEarningEntry.findMany({
      where: { orderId: { in: orderIds }, type: { in: ["SALE", "REFUND"] } },
      select: { orderId: true, type: true, shipmentId: true, meta: true },
    }),
  ]);

  for (const orderId of orderIds) {
    byOrder.set(orderId, { returns: [], refundedShipmentIds: new Set(), saleShipmentIds: new Set() });
  }

  for (const rr of returns) byOrder.get(rr.orderId)?.returns.push(rr);

  for (const entry of entries) {
    const state = byOrder.get(entry.orderId);
    if (!state) continue;

    if (entry.type === "SALE" && entry.shipmentId) state.saleShipmentIds.add(entry.shipmentId);
    if (entry.type === "REFUND" && entry.meta?.refShipmentId) state.refundedShipmentIds.add(entry.meta.refShipmentId);
  }

  return byOrder;
}
