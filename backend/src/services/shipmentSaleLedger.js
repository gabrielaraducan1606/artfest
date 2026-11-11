// backend/src/services/shipmentSaleLedger.js
//
// O SINGURĂ logică financiară pentru un Shipment OUTBOUND ajuns efectiv în
// IN_TRANSIT / DELIVERED, indiferent de calea autorizată (vendor, Admin,
// „Predată curierului”, status-sync Sameday, reconciliere).
//
// NU calculează nimic nou - doar ordonează helper-ele existente din
// vendorOrdersRoutes.js (aceleași formule: comision standard / mixt,
// own-sale, VendorCollection, campanii, reduceri):
//   1. SALE vendor      (ensureSaleLedgerEntry, upsert pe shipmentId)
//   2. influencer       (ensureInfluencerSaleLedgerEntry, citește SALE-ul)
//   3. referral vendor  (ensureVendorReferralSaleLedgerEntry, citește SALE-ul)
//
// Reguli de plată (decizia userului, 2026-11-03):
//  - CARD online (Stripe): SALE-ul îl creează DOAR webhook-ul, odată cu
//    transferul (cardSaleLedger.js). Aici nu se creează niciodată un SALE și
//    nu se atinge Stripe; dacă SALE-ul webhook-ului există, se completează
//    doar influencer / referral. CARD online neplătit -> nimic.
//  - COD și CARD offline (comandă manuală a vendorului, fără Stripe): SALE
//    creat idempotent aici, ca până acum în ruta vendorului.
//  - RETURN: niciodată vânzare.
//
// Idempotență: unicitatea pe shipmentId din schemă (cele 3 modele). Două
// căi simultane (ex. vendor + status-sync) pot ajunge amândouă la create:
// a doua primește P2002 și reîncearcă o dată - upsert-ul găsește rândul.

import { prisma as defaultPrisma } from "../db.js";
import { computeVendorOrderPaymentState } from "./vendorOrderPaymentState.js";
import {
  ensureInfluencerSaleLedgerEntry,
  ensureSaleLedgerEntry,
  ensureVendorReferralSaleLedgerEntry,
} from "../routes/vendorOrdersRoutes.js";

export const SALE_LEDGER_SHIPMENT_STATUSES = Object.freeze(["IN_TRANSIT", "DELIVERED"]);

const isUniqueViolation = (e) => e?.code === "P2002";

async function withUniqueRetry(fn) {
  try {
    return await fn();
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return fn();
  }
}

/**
 * Cum se tratează plata comenzii pentru ledger.
 * @returns {"online_card_paid"|"online_card_unpaid"|"cod"|"offline"}
 */
export function saleLedgerPaymentKind(order) {
  const state = computeVendorOrderPaymentState(order);
  if (state.isOnlineCard) return state.paid ? "online_card_paid" : "online_card_unpaid";
  return state.paymentMethod === "COD" ? "cod" : "offline";
}

/**
 * Înregistrările financiare pentru un Shipment OUTBOUND în IN_TRANSIT /
 * DELIVERED. Idempotentă; nu schimbă statusul și nu atinge Stripe / SmartBill.
 *
 * @param {Object} p
 * @param {string} p.shipmentId
 * @param {string} [p.metaSource]  sursa salvată pe un SALE NOU (implicit cea istorică)
 * @returns {Promise<{ ok: boolean, reason: string, sale?: string, influencer?: boolean, referral?: boolean }>}
 */
export async function ensureShipmentSaleLedgers({ shipmentId, metaSource, db = defaultPrisma, deps = {} }) {
  const ensureSale = deps.ensureSaleLedgerEntry || ensureSaleLedgerEntry;
  const ensureInfluencer = deps.ensureInfluencerSaleLedgerEntry || ensureInfluencerSaleLedgerEntry;
  const ensureReferral = deps.ensureVendorReferralSaleLedgerEntry || ensureVendorReferralSaleLedgerEntry;

  const shipment = await db.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true,
      vendorId: true,
      status: true,
      direction: true,
      order: { select: { paymentMethod: true, status: true, paidAt: true, userId: true, isGuestOrder: true, stripeCheckoutSessionId: true, stripePaymentIntentId: true } },
      vendorEarningEntry: { select: { id: true } },
    },
  });
  if (!shipment) return { ok: false, reason: "shipment_not_found" };
  if (String(shipment.direction || "OUTBOUND") === "RETURN") return { ok: true, reason: "return_shipment" };
  if (!SALE_LEDGER_SHIPMENT_STATUSES.includes(String(shipment.status))) return { ok: true, reason: "status_not_eligible" };

  const kind = saleLedgerPaymentKind(shipment.order);
  let sale;
  if (kind === "online_card_unpaid") return { ok: true, reason: "card_unpaid" };
  if (kind === "online_card_paid") {
    // SALE-ul vine doar din webhook-ul Stripe; fără el nu inventăm nimic
    if (!shipment.vendorEarningEntry) return { ok: false, reason: "card_sale_missing" };
    sale = "existing";
  } else {
    sale = shipment.vendorEarningEntry ? "existing" : "created";
    await withUniqueRetry(() => ensureSale({ vendorId: shipment.vendorId, shipmentId: shipment.id, ...(metaSource ? { metaSource } : {}) }));
  }

  // după SALE (citesc comisionul Artfest din el); fiecare întoarce null când nu se aplică
  const influencer = await withUniqueRetry(() => ensureInfluencer({ shipmentId: shipment.id }));
  const referral = await withUniqueRetry(() => ensureReferral({ shipmentId: shipment.id }));
  return { ok: true, reason: kind, sale, influencer: Boolean(influencer), referral: Boolean(referral) };
}
