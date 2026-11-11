// src/pages/Checkout/delivery/placeFields.js
//
// Reguli (fără React) pentru județ / localitate / cod poștal la livrarea la
// adresă, cu nomenclatorul Sameday:
//  - județele vin din nomenclator (ID Sameday) + codul folosit de checkout
//    (asociat pe server după denumire); fără nomenclator -> lista locală;
//  - localitatea trebuie ALEASĂ din listă cât timp lista e disponibilă;
//    dacă lista nu răspunde, textul e acceptat (nevalidat - serverul
//    reîncearcă la plasare);
//  - codul poștal NU se completează singur: GET /api/geolocation/city
//    întoarce UN cod per localitate, fără coduri pe stradă, deci nu putem
//    ști dacă e cel corect pentru adresă (orașele mari au coduri pe stradă).
//    Îl oferim doar ca sugestie, cu un buton.

// ca deliveryApi.foldText (fără import: modulul rămâne pur, testabil fără lib/api)
const foldText = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Județele Sameday -> opțiunile câmpului „Județ”: { code, name, samedayId }.
 * code = codul checkout-ului (ex. „CJ”), altfel denumirea. Fără date -> fallback.
 */
export function mergeSamedayCounties(samedayItems = [], fallback = []) {
  const list = (Array.isArray(samedayItems) ? samedayItems : [])
    .filter((c) => c && c.id != null && c.name)
    .map((c) => ({ code: c.code || c.name, name: c.name, samedayId: Number(c.id) }));
  if (!list.length) return fallback;
  return list.sort((a, b) => a.name.localeCompare(b.name, "ro"));
}

/** Codul poștal de sugerat după alegerea localității (doar 6 cifre și diferit de cel scris). */
export function postalSuggestion(pickedCity, currentPostal = "") {
  const code = String(pickedCity?.postalCode || "").trim();
  if (!/^\d{6}$/.test(code)) return null;
  if (String(currentPostal || "").trim() === code) return null;
  return code;
}

/**
 * Trebuie aleasă localitatea din listă? Da, când nomenclatorul e activ, lista
 * răspunde și localitatea scrisă nu are încă ID Sameday.
 */
export function cityNeedsPick({ nomenclatorActive, citiesAvailable = true, samedayCityId = null, city = "" }) {
  return Boolean(nomenclatorActive && citiesAvailable && foldText(city) && !samedayCityId);
}

export const CITY_PICK_MESSAGE = "Alege localitatea din listă.";
export const CITIES_FALLBACK_MESSAGE =
  "Lista de localități nu este disponibilă acum. Poți scrie localitatea - o verificăm la plasarea comenzii.";
