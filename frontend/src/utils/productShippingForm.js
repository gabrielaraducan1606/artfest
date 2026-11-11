// src/utils/productShippingForm.js
//
// Profilul logistic al produsului (produsul ambalat, gata de expediere) în
// formularele de produs: valorile salvate -> câmpuri text și înapoi. Serverul
// (backend/src/lib/productShipping.js) validează; aici doar transportăm.

import { SHIPPING_PROFILE_FIELDS } from "../../../backend/src/lib/productShipping.js";

export { SHIPPING_PROFILE_FIELDS };

/** Produsul salvat -> câmpurile formularului (text; gol = necompletat). */
export function shippingFormFromProduct(product = {}) {
  return Object.fromEntries(
    SHIPPING_PROFILE_FIELDS.map((field) => [field, product?.[field] == null ? "" : String(product[field])])
  );
}

/**
 * Formularul -> payload. Doar câmpurile prezente în formular (un formular
 * fără ele nu șterge valorile salvate); gol -> null, restul trimis ca text.
 */
export function shippingPayloadFromForm(form = {}) {
  const payload = {};
  for (const field of SHIPPING_PROFILE_FIELDS) {
    if (!form || !Object.prototype.hasOwnProperty.call(form, field)) continue;
    const value = form[field];
    payload[field] = value === null || value === undefined || String(value).trim() === "" ? null : String(value).trim();
  }
  return payload;
}
