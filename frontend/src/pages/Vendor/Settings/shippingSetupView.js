// src/pages/Vendor/Settings/shippingSetupView.js
//
// Starea livrării unui magazin (calculată pe server: GET /api/vendors/me/services
// -> shippingSetup). Tariful de rezervă e obligatoriu la magazinele cu produse
// livrate prin curier; lipsa lui = „Configurare livrare incompletă”. Tariful e cel al curierului
// propriu (nu al livrării Sameday prin Artfest, care are tarifele Artfest); lipsa lui NU e 0 lei.

export const SHIPPING_INCOMPLETE_TITLE = "Configurare livrare incompletă";
export const SHIPPING_FALLBACK_MISSING =
  "Completează tariful tău de transport (livrarea prin curierul propriu). Fără el, clienții nu pot alege această livrare: lipsa tarifului nu înseamnă transport gratuit. Dacă vrei să oferi transport gratuit, scrie 0.";

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
