// src/features/smartListing/smartListingAccess.js
//
// Cine poate folosi Smart Listing (adăugarea și editarea produselor).
//
// Activarea se face EXCLUSIV prin flag (Vercel / .env local), la build:
//
//   VITE_SMART_LISTING_ENABLED=1   Smart Listing e formularul implicit
//   lipsă / orice altă valoare     formularele vechi, exact ca înainte
//
// Editoarele vechi (ProductModal, VendorProductWizard) rămân accesibile prin
// „Editorul avansat”, pentru configurațiile pe care Smart Listing nu le editează.
//
// Roluri (cu flag):
//   - Vendor: formularul REAL (upload, AI, creare produs) - `mode: "live"`;
//   - Admin: doar previzualizare, pentru că nu are magazin: fără upload, AI,
//     salvare sau tichete (smartListingPreview.js) - `mode: "preview"`;
//   - restul: fără acces.
//
// Editarea produselor existente: openSmartListingEdit (pagina magazinului + Catalog).

export const SMART_LISTING_CREATE_PATH = "/vendor/produs-nou";

/*
 * Locurile care citesc flagul (prin smartListingAccessFor): App.jsx (fereastra și ruta),
 * ProfilMagazin.jsx, CatalogProduse.jsx, VendorAssistant.jsx. Fără flag, niciunul nu
 * schimbă comportamentul. Dezactivare = ștergerea variabilei din Vercel + redeploy.
 */
export const ROLLOUT_NOTES = Object.freeze([
  "VITE_SMART_LISTING_ENABLED=1 (Vercel): Smart Listing pentru adăugare și editare, la vânzători.",
  "Fără flag: ProductModal / VendorProductWizard, neschimbate.",
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
 * EDITAREA unui produs existent în aceeași fereastră (cu flag, din pagina magazinului
 * și din Catalog). „Editorul avansat” închide fereastra și deschide editorul vechi al
 * paginii pentru același produs (SMART_LISTING_EDIT_ADVANCED_EVENT) - fără ferestre suprapuse.
 */
export const SMART_LISTING_EDIT_EVENT = "smartlisting:edit";
export const SMART_LISTING_EDIT_ADVANCED_EVENT = "smartlisting:edit-advanced";

export function openSmartListingEdit({ storeSlug = "", productId }) {
  if (!productId) return;
  window.dispatchEvent(new CustomEvent(SMART_LISTING_EDIT_EVENT, { detail: { storeSlug, productId: String(productId) } }));
}

const BUILD_ENV = (typeof import.meta !== "undefined" && import.meta.env) || {};

function isOn(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

export function smartListingCreatePath(storeSlug = "") {
  return storeSlug ? `${SMART_LISTING_CREATE_PATH}?magazin=${encodeURIComponent(storeSlug)}` : SMART_LISTING_CREATE_PATH;
}

/** Flagul de activare al build-ului curent (VITE_SMART_LISTING_ENABLED). */
export function isSmartListingEnabled(env = BUILD_ENV) {
  return isOn(env?.VITE_SMART_LISTING_ENABLED);
}

/**
 * @param {{ enabled: unknown, me: Object|null }} input  (`isDev` nu mai e folosit: doar flagul decide)
 * @returns {{ allowed: boolean, canSave: boolean, mode: "off"|"preview"|"live", reason: string }}
 */
export function resolveSmartListingAccess({ enabled, me }) {
  if (!isOn(enabled)) return { allowed: false, canSave: false, mode: "off", reason: "flag_off" };
  if (!me) return { allowed: false, canSave: false, mode: "off", reason: "not_logged_in" };

  const role = String(me.role || "").toUpperCase();
  if (role === "VENDOR") return { allowed: true, canSave: true, mode: "live", reason: "vendor" };
  if (role === "ADMIN") return { allowed: true, canSave: false, mode: "preview", reason: "admin_preview" };
  return { allowed: false, canSave: false, mode: "off", reason: "role" };
}

/** Accesul pentru utilizatorul curent, cu variabilele build-ului curent. */
export function smartListingAccessFor(me) {
  return resolveSmartListingAccess({ enabled: BUILD_ENV.VITE_SMART_LISTING_ENABLED, me });
}
