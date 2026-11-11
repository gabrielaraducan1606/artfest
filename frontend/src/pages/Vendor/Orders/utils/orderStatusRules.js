// Statusuri finale ale comenzii vendorului (coletul de vânzare): „fulfilled”
// (livrat) și „cancelled” (refuzat / returnat). Din ele nu mai există acțiuni
// generice de status - backend-ul le refuză oricum (409 shipment_status_final);
// interfața doar nu le mai oferă. Corecțiile se fac de echipa Artfest.

export const FINAL_VENDOR_ORDER_STATUSES = Object.freeze(["fulfilled", "cancelled"]);

export function isFinalVendorOrderStatus(status) {
  return FINAL_VENDOR_ORDER_STATUSES.includes(String(status || ""));
}

/** Mutarea pe board (drag & drop) e permisă? */
export function canMoveOrderOnBoard(order, targetStatus) {
  if (!order || !targetStatus) return false;
  if (isFinalVendorOrderStatus(order.status)) return false;
  return order.status !== targetStatus;
}

/** Mesajul de afișat pentru o eroare a schimbării de status. */
export function statusChangeErrorMessage(err) {
  const data = err?.data || err?.response?.data || {};
  if (data.error === "shipment_status_final" && data.message) return data.message;
  return data.message || "Nu am putut actualiza statusul comenzii. Încearcă din nou.";
}
