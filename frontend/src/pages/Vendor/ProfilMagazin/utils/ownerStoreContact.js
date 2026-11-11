// src/pages/Vendor/ProfilMagazin/utils/ownerStoreContact.js

/*
 * Datele de contact dedicate ale magazinului (telefon, email, website) și
 * adresa de RETUR (ServiceProfile.address) nu vin din răspunsul PUBLIC al
 * magazinului (backend lib/publicStoreContact.js + lib/publicVendorData.js).
 * Proprietarul le vede și le editează în continuare: le completăm din ruta
 * PRIVATĂ (GET /api/vendors/store/:slug, cu verificare de ownership
 * server-side), cu aceleași chei pe care le folosește deja pagina
 * (address / phone / publicEmail / website).
 *
 * Pur - fără rețea; apelat doar când utilizatorul e proprietarul.
 */

export function mergeOwnerContactFields(publicShop, privateShop) {
  if (!publicShop || !privateShop || typeof privateShop !== "object") {
    return publicShop;
  }

  return {
    ...publicShop,
    address: privateShop.address || "",
    phone: privateShop.phone || "",
    publicEmail: privateShop.email || privateShop.publicEmail || "",
    website: privateShop.website || "",
  };
}

/*
 * Ce trimite salvarea automată a datelor de contact: DOAR câmpurile pe care
 * proprietarul le-a schimbat față de valorile încărcate. Fără această
 * regulă, dacă ruta privată nu răspunde (adresa rămâne necunoscută în
 * pagină), o editare a telefonului ar trimite și `address: null` și ar
 * șterge adresa de retur salvată.
 *
 * @param {{ address?: string, phone?: string, email?: string }} draft
 * @param {{ address?: string, phone?: string, publicEmail?: string }} loaded
 * @returns {{ address?: string, phone?: string, email?: string }}
 */
export function changedOwnerContactFields(draft = {}, loaded = {}) {
  const same = (a, b) => String(a ?? "").trim() === String(b ?? "").trim();
  const patch = {};
  if (!same(draft.address, loaded?.address)) patch.address = draft.address;
  if (!same(draft.phone, loaded?.phone)) patch.phone = draft.phone;
  if (!same(draft.email, loaded?.publicEmail)) patch.email = draft.email;
  return patch;
}
