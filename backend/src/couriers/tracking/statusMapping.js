// backend/src/couriers/tracking/statusMapping.js
//
// Statusurile Sameday (statusId din status-sync) -> ShipmentStatus Artfest.
// Maparea e EXPLICITĂ și CONFIGURABILĂ (CourierAccount.publicConfig.statusMap,
// { "<statusId>": "IN_TRANSIT" | "DELIVERED" | "REFUSED" | "RETURNED" }),
// completată DOAR după confirmarea din GET /api/public/status-list /
// documentație. Implicit: nicio mapare -> mappedStatus = null (evenimentul
// rămâne în timeline, Shipment.status nu se schimbă).
//
// FAZA 1 (decizia userului, 2026-11-02): se aplică automat DOAR tranziția
// operațională sigură spre IN_TRANSIT. DELIVERED / REFUSED / RETURNED se
// salvează ca evenimente confirmate de Sameday, cu applied = false - fără
// ledger, comisioane, FULFILLED, refund sau flux de retur.
//
// Fluxuri SEPARATE (decizia userului, 2026-11-02): statusMap descrie DOAR
// coletul de vânzare pe drumul spre client (Shipment OUTBOUND, inReturn=false).
// Coletul de vânzare întors la expeditor (OUTBOUND + inReturn=true) și
// expedierile RETURN rămân doar în timeline, fără mapare - semantica lor
// nu e confirmată de Sameday. Statusurile nu se deduc din texte (label).
//
// RETUR (2026-11-07): expedierile RETURN au o mapare SEPARATĂ, tot explicită
// și configurabilă - CourierAccount.publicConfig.returnStatusMap,
// { "<statusId>": "PICKUP_REQUESTED" | "PICKED_UP" | "IN_TRANSIT" |
//   "PICKUP_FAILED" | "DELIVERED_TO_VENDOR" }. Implicit goală (ID-urile
// Sameday se completează doar după confirmare). Se aplică DOAR pe Shipment
// RETURN, AWB curent, fără downgrade; fără refund, fără CLOSED, fără ledger.
// Coletul de vânzare întors (OUTBOUND + inReturn) rămâne nemapat.

export const STATUS_FLOWS = Object.freeze({ OUTBOUND: "OUTBOUND", RETURN: "RETURN" });

export const MAPPABLE_STATUSES = Object.freeze(["IN_TRANSIT", "DELIVERED", "REFUSED", "RETURNED"]);
export const TERMINAL_STATUSES = Object.freeze(["DELIVERED", "REFUSED", "RETURNED"]);

export const RETURN_EVENTS = Object.freeze(["PICKUP_REQUESTED", "PICKED_UP", "IN_TRANSIT", "PICKUP_FAILED", "DELIVERED_TO_VENDOR"]);

// eveniment de retur -> Shipment.status (RETURN) + stările din care e un pas înainte.
// PICKUP_FAILED: doar timeline (nu există o stare dedicată; nu se inventează).
export const RETURN_EVENT_TO_SHIPMENT_STATUS = Object.freeze({
  PICKUP_REQUESTED: { toStatus: "PICKUP_SCHEDULED", fromStatuses: ["PENDING", "PREPARING", "READY_FOR_PICKUP", "AWB"] },
  PICKED_UP: { toStatus: "IN_TRANSIT", fromStatuses: ["PENDING", "PREPARING", "READY_FOR_PICKUP", "PICKUP_SCHEDULED", "AWB"] },
  IN_TRANSIT: { toStatus: "IN_TRANSIT", fromStatuses: ["PENDING", "PREPARING", "READY_FOR_PICKUP", "PICKUP_SCHEDULED", "AWB"] },
  DELIVERED_TO_VENDOR: { toStatus: "DELIVERED", fromStatuses: ["PENDING", "PREPARING", "READY_FOR_PICKUP", "PICKUP_SCHEDULED", "AWB", "IN_TRANSIT"] },
  PICKUP_FAILED: null,
});

// stările de dinainte de predare din care IN_TRANSIT e un pas înainte (fără downgrade)
const PRE_TRANSIT_STATUSES = new Set(["PENDING", "PREPARING", "READY_FOR_PICKUP", "PICKUP_SCHEDULED", "AWB"]);

/**
 * Maparea configurată, validată: chei = statusId întregi, valori doar din
 * MAPPABLE_STATUSES (orice altceva e ignorat, nu ghicit).
 * @returns {Map<number, string>}
 */
export function parseStatusMap(raw) {
  const out = new Map();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const id = Number(key);
    if (Number.isInteger(id) && MAPPABLE_STATUSES.includes(value)) out.set(id, value);
  }
  return out;
}

/** returnStatusMap validat: chei = statusId întregi, valori doar din RETURN_EVENTS. */
export function parseReturnStatusMap(raw) {
  const out = new Map();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const id = Number(key);
    if (Number.isInteger(id) && RETURN_EVENTS.includes(value)) out.set(id, value);
  }
  return out;
}

export function mapSamedayStatus(statusMap, statusId) {
  return statusMap.get(Number(statusId)) ?? null;
}

/**
 * Interpretarea unui eveniment, separat pe flux:
 *  - Shipment RETURN                 -> flux RETURN, fără mapare (neconfirmată)
 *  - Shipment OUTBOUND, inReturn=true -> flux RETURN (colet întors), fără mapare
 *  - Shipment OUTBOUND, inReturn=false -> flux OUTBOUND, statusMap
 *  - direcție necunoscută             -> fără mapare
 * @returns {{ flow: string|null, mappedStatus: string|null, reason: string }}
 */
export function interpretStatusEvent({ statusMap, returnStatusMap = null, statusId, inReturn, direction }) {
  if (direction === "RETURN") {
    const returnEvent = returnStatusMap?.get?.(Number(statusId)) ?? null;
    // mappedStatus = statusul țintă al expedierii de retur (timeline); PICKUP_FAILED
    // nu are stare -> null. Aplicarea e separată (decideReturnApplication).
    const mappedStatus = returnEvent ? RETURN_EVENT_TO_SHIPMENT_STATUS[returnEvent]?.toStatus ?? null : null;
    return { flow: STATUS_FLOWS.RETURN, mappedStatus, returnEvent, reason: returnEvent ? "return_mapped" : "return_shipment_unmapped" };
  }
  if (direction !== "OUTBOUND") return { flow: null, mappedStatus: null, reason: "unknown_direction" };
  if (inReturn === true) return { flow: STATUS_FLOWS.RETURN, mappedStatus: null, reason: "outbound_in_return_unmapped" };
  const mappedStatus = mapSamedayStatus(statusMap, statusId);
  return { flow: STATUS_FLOWS.OUTBOUND, mappedStatus, reason: mappedStatus ? "mapped" : "unmapped" };
}

/**
 * Se aplică evenimentul pe Shipment.status? (faza 1)
 * Doar IN_TRANSIT, doar dintr-o stare de dinainte de predare, doar pentru
 * coletul de vânzare (OUTBOUND, inReturn=false) al AWB-ului CURENT al
 * expedierii. Restul: doar timeline.
 * @returns {{ apply: boolean, reason: string }}
 */
export function decideApplication({ mappedStatus, shipment, isCurrentAwb, inReturn = false, awbCancelState = null }) {
  if (!mappedStatus) return { apply: false, reason: "unmapped" };
  if (TERMINAL_STATUSES.includes(mappedStatus)) return { apply: false, reason: "terminal_phase1" };
  if (!isCurrentAwb) return { apply: false, reason: "not_current_awb" };
  // anulare în curs / cu rezultat incert la curier -> nu marcăm predarea
  if (awbCancelState) return { apply: false, reason: "awb_cancel_pending" };
  if (shipment?.direction !== "OUTBOUND") return { apply: false, reason: "not_outbound" };
  if (inReturn === true) return { apply: false, reason: "in_return" };
  if (mappedStatus === "IN_TRANSIT" && PRE_TRANSIT_STATUSES.has(String(shipment?.status))) {
    return { apply: true, reason: "in_transit" };
  }
  // deja IN_TRANSIT / livrat / refuzat / returnat (sau eveniment întârziat) -> fără downgrade
  return { apply: false, reason: "no_downgrade" };
}

/**
 * Se aplică un eveniment de RETUR pe Shipment.status? Doar Shipment RETURN,
 * AWB curent, fără anulare în curs, doar ca pas înainte (fără downgrade).
 * @returns {{ apply: boolean, reason: string, toStatus?: string, fromStatuses?: string[] }}
 */
export function decideReturnApplication({ returnEvent, shipment, isCurrentAwb, awbCancelState = null }) {
  if (!RETURN_EVENTS.includes(returnEvent)) return { apply: false, reason: "unmapped" };
  if (shipment?.direction !== "RETURN") return { apply: false, reason: "not_return" };
  if (!isCurrentAwb) return { apply: false, reason: "not_current_awb" };
  if (awbCancelState) return { apply: false, reason: "awb_cancel_pending" };
  const rule = RETURN_EVENT_TO_SHIPMENT_STATUS[returnEvent];
  if (!rule) return { apply: false, reason: "timeline_only" };
  if (!rule.fromStatuses.includes(String(shipment?.status))) return { apply: false, reason: "no_downgrade" };
  return { apply: true, reason: "return_" + returnEvent.toLowerCase(), toStatus: rule.toStatus, fromStatuses: [...rule.fromStatuses] };
}
