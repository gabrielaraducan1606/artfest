// src/payments/depositGuards.js
//
// Regula unică: o comandă anulată (sau o livrare anulată) NU mai poate
// primi plata avansului. Verificarea se face pe STATUSUL CURENT din DB
// (Order.status / Shipment.status), nu doar pe depositStatus - anularea
// de către Client, vendor sau admin lasă depositStatus = PENDING, iar
// linkul/sesiunea Stripe de avans rămânea plătibilă (audit: avans PENDING
// după cancel).
//
// Folosită de: orchestrator (createDepositPaymentForShipment - punct
// central pentru user/guest/vendor), rutele user/guest de pay-deposit
// (răspuns 409 explicit) și webhook-ul Stripe (plasă de siguranță).

export const BLOCKED_SHIPMENT_STATUSES = ["REFUSED", "RETURNED"];

export const DEPOSIT_BLOCK_MESSAGES = {
  order_cancelled:
    "Comanda a fost anulată, iar avansul nu mai poate fi plătit.",
  shipment_cancelled:
    "Livrarea a fost anulată, iar avansul nu mai poate fi plătit.",
};

/*
 * Întoarce null dacă avansul poate fi plătit, altfel motivul blocării.
 */
export function getDepositBlockReason({ order, shipment }) {
  if (String(order?.status || "").toUpperCase() === "CANCELLED") {
    return "order_cancelled";
  }

  if (
    BLOCKED_SHIPMENT_STATUSES.includes(
      String(shipment?.status || "").toUpperCase()
    )
  ) {
    return "shipment_cancelled";
  }

  return null;
}

export class DepositPaymentBlockedError extends Error {
  constructor(reason) {
    super(DEPOSIT_BLOCK_MESSAGES[reason] || "Avansul nu mai poate fi plătit.");
    this.name = "DepositPaymentBlockedError";
    this.code = reason;
    this.status = 409;
  }
}
