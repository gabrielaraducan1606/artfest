// src/pages/Vendor/Settings/shippingSetupView.js
//
// Starea livrării unui magazin (calculată pe server: GET /api/vendors/me/services
// -> shippingSetup). Tariful de rezervă e obligatoriu la magazinele cu produse
// livrate prin curier; lipsa lui = „Configurare livrare incompletă”.

export const SHIPPING_INCOMPLETE_TITLE = "Configurare livrare incompletă";
export const SHIPPING_FALLBACK_MISSING =
  "Completează tariful de rezervă pentru transport. Se folosește doar dacă tariful Sameday nu poate fi calculat temporar; fără el, comenzile pot fi oprite în acele momente.";

/** null = nimic de afișat; altfel avertismentul pentru vendor. */
export function shippingSetupWarning(setup) {
  if (!setup || setup.status !== "incomplete") return null;
  return { title: SHIPPING_INCOMPLETE_TITLE, message: SHIPPING_FALLBACK_MISSING };
}

/** Starea după o salvare reușită (tariful e validat obligatoriu în formular). */
export function shippingSetupAfterSave(setup, savedFeeCents) {
  if (!setup) return setup;
  if (!setup.fallbackRequired) return { ...setup, fallbackConfigured: savedFeeCents != null };
  return savedFeeCents != null
    ? { ...setup, status: "complete", fallbackConfigured: true, missing: [] }
    : { ...setup, status: "incomplete", fallbackConfigured: false };
}
