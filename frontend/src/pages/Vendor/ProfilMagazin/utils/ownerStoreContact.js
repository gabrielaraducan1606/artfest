// src/pages/Vendor/ProfilMagazin/utils/ownerStoreContact.js

/*
 * Datele de contact dedicate ale magazinului (telefon, email, website)
 * nu mai vin din răspunsul PUBLIC al magazinului (backend
 * lib/publicStoreContact.js). Proprietarul le vede și le editează în
 * continuare: le completăm din ruta PRIVATĂ (GET /api/vendors/store/:slug,
 * cu verificare de ownership server-side), cu aceleași chei pe care le
 * folosește deja pagina (phone / publicEmail / website).
 *
 * Pur - fără rețea; apelat doar când utilizatorul e proprietarul.
 */

export function mergeOwnerContactFields(publicShop, privateShop) {
  if (!publicShop || !privateShop || typeof privateShop !== "object") {
    return publicShop;
  }

  return {
    ...publicShop,
    phone: privateShop.phone || "",
    publicEmail: privateShop.email || privateShop.publicEmail || "",
    website: privateShop.website || "",
  };
}
