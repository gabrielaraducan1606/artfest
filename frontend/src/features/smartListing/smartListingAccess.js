// src/features/smartListing/smartListingAccess.js
//
// Cine poate folosi Smart Listing (crearea de produse NOI).
//
// ACUM: EXCLUSIV dezvoltare locală. În build-ul de producție (`isDev = false`)
// răspunsul e mereu „nu”, indiferent de variabile - nu se poate activa din
// greșeală pe Vercel.
//
//   VITE_SMART_LISTING_ENABLED=1   pornește funcția local
//
// Roluri (local, cu flag):
//   - Vendor: formularul REAL (upload, AI, creare produs) - `mode: "live"`;
//   - Admin: doar previzualizare, pentru că nu are magazin: fără upload, AI,
//     salvare sau tichete (smartListingPreview.js) - `mode: "preview"`;
//   - restul: fără acces.
//
// Editarea produselor existente: tot doar local (vezi openSmartListingEdit); în producție
// „Editează produsul” deschide ProductModal-ul existent, neschimbat.

export const SMART_LISTING_CREATE_PATH = "/vendor/produs-nou";

/*
 * Activarea în producție cere o modificare de cod aprobată, în aceste locuri
 * (toate condiționate de `import.meta.env.DEV`, deci eliminate la build):
 *   App.jsx (modalul și ruta directă), smartListingAccess.js (`isDev`), ProfilMagazin.jsx,
 *   CatalogProduse.jsx, VendorAssistant.jsx, AdminProductsTab (SmartListingDevLink).
 */
export const ROLLOUT_NOTES = Object.freeze([
  "Acum: doar `vite dev` + VITE_SMART_LISTING_ENABLED; „Adaugă produs” deschide Smart Listing pentru Vendor.",
  "După testare și aprobare: se elimină condiția `import.meta.env.DEV` din locurile de mai sus, prin cod revizuit.",
]);

/*
 * Modalul e montat o singură dată în App.jsx (SmartListingModal); orice buton
 * „Adaugă produs” îl deschide cu un eveniment, fără să schimbe pagina.
 */
export const SMART_LISTING_OPEN_EVENT = "smartlisting:open";
export const SMART_LISTING_ADVANCED_EVENT = "smartlisting:advanced";

export function openSmartListing(storeSlug = "") {
  window.dispatchEvent(new CustomEvent(SMART_LISTING_OPEN_EVENT, { detail: { storeSlug } }));
}

/*
 * EDITAREA unui produs existent în aceeași fereastră (doar `vite dev` + flag, din
 * ProfilMagazin). „Editorul avansat” închide fereastra și deschide ProductModal-ul
 * existent pentru același produs (SMART_LISTING_EDIT_ADVANCED_EVENT) - fără ferestre
 * suprapuse. Producția nu folosește nimic de aici.
 */
export const SMART_LISTING_EDIT_EVENT = "smartlisting:edit";
export const SMART_LISTING_EDIT_ADVANCED_EVENT = "smartlisting:edit-advanced";

export function openSmartListingEdit({ storeSlug = "", productId }) {
  if (!productId) return;
  window.dispatchEvent(new CustomEvent(SMART_LISTING_EDIT_EVENT, { detail: { storeSlug, productId: String(productId) } }));
}

function isOn(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

export function smartListingCreatePath(storeSlug = "") {
  return storeSlug ? `${SMART_LISTING_CREATE_PATH}?magazin=${encodeURIComponent(storeSlug)}` : SMART_LISTING_CREATE_PATH;
}

/**
 * @param {{ isDev: boolean, enabled: unknown, me: Object|null }} input
 * @returns {{ allowed: boolean, canSave: boolean, mode: "off"|"preview"|"live", reason: string }}
 */
export function resolveSmartListingAccess({ isDev, enabled, me }) {
  if (!isDev) return { allowed: false, canSave: false, mode: "off", reason: "not_dev" };
  if (!isOn(enabled)) return { allowed: false, canSave: false, mode: "off", reason: "flag_off" };
  if (!me) return { allowed: false, canSave: false, mode: "off", reason: "not_logged_in" };

  const role = String(me.role || "").toUpperCase();
  if (role === "VENDOR") return { allowed: true, canSave: true, mode: "live", reason: "vendor" };
  if (role === "ADMIN") return { allowed: true, canSave: false, mode: "preview", reason: "admin_preview" };
  return { allowed: false, canSave: false, mode: "off", reason: "role" };
}

const BUILD_ENV = (typeof import.meta !== "undefined" && import.meta.env) || {};

/** Accesul pentru utilizatorul curent, cu variabilele build-ului curent. */
export function smartListingAccessFor(me) {
  return resolveSmartListingAccess({
    isDev: Boolean(BUILD_ENV.DEV),
    enabled: BUILD_ENV.VITE_SMART_LISTING_ENABLED,
    me,
  });
}
