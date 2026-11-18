// backend/src/services/shipping/fulfillment.js
//
// Sursa UNICĂ pentru „al cui e transportul încasat de la client” (Shipment.fulfillment):
//
//   ARTFEST_SAMEDAY  curierat prin contractul Artfest -> transportul e al ARTFEST
//                    (nu intră în transferul Stripe al vendorului; Artfest plătește Sameday);
//   VENDOR_COURIER   curierul vânzătorului -> transportul rămâne în fluxul vendorului;
//   null / lipsă     comenzile existente -> EXACT comportamentul de dinainte
//                    (transportul în fluxul vendorului).
//
// Orice calcul financiar (split, taxa Stripe, transfer, ledger, rapoarte) întreabă AICI,
// nu citește direct shipment.fulfillment. Funcții pure, fără DB / rețea.

export const FULFILLMENT = Object.freeze({
  ARTFEST_SAMEDAY: "ARTFEST_SAMEDAY",
  VENDOR_COURIER: "VENDOR_COURIER",
});

export const SHIPPING_OWNER = Object.freeze({ VENDOR: "VENDOR", ARTFEST: "ARTFEST" });

/** Valoarea normalizată: "ARTFEST_SAMEDAY" | "VENDOR_COURIER" | null (necunoscut => null = comportamentul existent). */
export function normalizeFulfillment(value) {
  const v = String(value ?? "").trim().toUpperCase();
  return v === FULFILLMENT.ARTFEST_SAMEDAY || v === FULFILLMENT.VENDOR_COURIER ? v : null;
}

export function isArtfestSameday(shipment) {
  return normalizeFulfillment(shipment?.fulfillment) === FULFILLMENT.ARTFEST_SAMEDAY;
}

/** Proprietarul economic al transportului unui shipment. */
export function shippingOwner(shipment) {
  return isArtfestSameday(shipment) ? SHIPPING_OWNER.ARTFEST : SHIPPING_OWNER.VENDOR;
}

/**
 * Împarte suma de transport încasată pe shipment între vendor și Artfest.
 * Exact una dintre sume e nenulă; suma lor = shippingGross (fără rotunjiri noi).
 * @param {object} shipment             (folosește doar `fulfillment`)
 * @param {number} shippingGross        transportul brut încasat de la client (lei, 2 zecimale)
 * @returns {{ fulfillment: string|null, owner: "VENDOR"|"ARTFEST", vendorShippingGross: number, artfestShippingGross: number }}
 */
export function shippingOwnership(shipment, shippingGross) {
  const fulfillment = normalizeFulfillment(shipment?.fulfillment);
  const amount = Number(shippingGross) || 0;
  if (fulfillment === FULFILLMENT.ARTFEST_SAMEDAY) {
    return { fulfillment, owner: SHIPPING_OWNER.ARTFEST, vendorShippingGross: 0, artfestShippingGross: amount };
  }
  return { fulfillment, owner: SHIPPING_OWNER.VENDOR, vendorShippingGross: amount, artfestShippingGross: 0 };
}

/**
 * Gardă de imuabilitate: după plata comenzii, modul de livrare (deci suma transferului
 * către vendor) nu se mai poate schimba. Folosită de orice viitoare scriere a câmpului.
 * @returns {{ ok: true } | { ok: false, code: string }}
 */
export function canChangeFulfillment({ current, next, orderPaid }) {
  const a = normalizeFulfillment(current);
  const b = normalizeFulfillment(next);
  if (a === b) return { ok: true };
  if (orderPaid) return { ok: false, code: "fulfillment_locked_after_payment" };
  return { ok: true };
}

/*
 * Evidența separată a costurilor de transport (doar date, nu documente):
 *   collected      = tariful încasat de la client (Shipment.price);
 *   estimated      = ShipmentDelivery.carrierCost - ESTIMAREA Sameday salvată la plasare;
 *   awbReported    = ShipmentDelivery.carrierCostAwbReported - awbCost raportat la AWB (informativ);
 *   final          = ShipmentDelivery.carrierCostFinal - DOAR costul confirmat (ex. factura Sameday).
 * awbReported NU e considerat cost final.
 */
const toCents = (v) => (v === null || v === undefined || v === "" ? null : Math.round(Number(v) * 100));

export function shippingCostEvidence(shipment, delivery = null) {
  const final = toCents(delivery?.carrierCostFinal);
  return {
    owner: shippingOwner(shipment),
    collectedCents: toCents(shipment?.price) ?? 0,
    estimatedCostCents: toCents(delivery?.carrierCost),
    awbReportedCostCents: toCents(delivery?.carrierCostAwbReported),
    finalCostCents: final,
    finalCostSource: final == null ? null : delivery?.carrierCostFinalSource || null,
    isFinal: final != null,
  };
}
