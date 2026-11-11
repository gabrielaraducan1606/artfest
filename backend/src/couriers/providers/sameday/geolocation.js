// backend/src/couriers/providers/sameday/geolocation.js

import { samedayGet } from "./client.js";

/*
 * Nomenclatorul Sameday de județe / localități (doc v3.6):
 *   GET /api/geolocation/county?name=&countryCode=   -> data: [{ id, name, code }]
 *   GET /api/geolocation/city?name=&county=<ID județ>&countryCode= -> data: [{ id, name, county: { id, name, code }, postalCode, ... }]
 *
 * Artfest nu are încă o mapare proprie. Rezolvăm ID-urile DOAR la potrivire
 * EXACTĂ a numelui (fără diacritice / majuscule / spații în plus) și, pentru
 * localitate, în județul găsit; ID-urile se trimit doar ca pereche (județ +
 * localitate). Orice ambiguitate sau eroare -> null, iar
 * AWB-ul pleacă doar cu numele (countyString / cityString), varianta
 * permisă de documentație („automatic mapping ... manual review”).
 * NICIUN ID ghicit. Rezultatele (inclusiv „negăsit”) se păstrează în
 * memorie - documentația spune că nomenclatorul nu se schimbă.
 */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map();

export function _clearGeolocationCache() {
  cache.clear();
}

export function normalizePlaceName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^(judetul|jud\.?|municipiul|mun\.?|orasul|oras|comuna|com\.?)\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function listOf(data) {
  return Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
}

async function cached(key, load) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await load();
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

function uniqueMatch(rows, name, extra = () => true) {
  const wanted = normalizePlaceName(name);
  const found = rows.filter((row) => normalizePlaceName(row?.name) === wanted && extra(row));
  return found.length === 1 && found[0]?.id != null ? found[0] : null;
}

const validId = (v) => v != null && v !== "" && /^\d{1,9}$/.test(String(v));

/** Localitățile cu acest nume DIN județul dat (filtrul `county` = ID-ul județului). */
async function citiesNamed(ctx, env, countyId, city) {
  return cached(`${env}|cities|${countyId}|${normalizePlaceName(city)}`, async () => {
    /*
     * API-ul REAL acceptă la `county` DOAR ID-ul județului (confirmat pe
     * producție 2026-10-31: county=Buzau -> 400 „Valoarea selectată este
     * invalidă”, county=11 -> 200). PDF v3.6 arată un exemplu cu denumirea,
     * Swagger spune doar „string” - ne luăm după comportamentul real.
     */
    const q = new URLSearchParams({ name: String(city).trim(), county: String(countyId), countryCode: "RO", countPerPage: "100" });
    // rezultatul trebuie să aparțină județului cerut (nu ne bazăm doar pe filtru)
    return listOf(await samedayGet(ctx, `/api/geolocation/city?${q}`)).filter((row) => String(row?.county?.id ?? "") === String(countyId));
  });
}

/**
 * ID-urile Sameday de județ / localitate.
 *  - countyId + cityId deja cunoscute (ex. VendorPickupAddress.providerRefs)
 *    -> verificate în nomenclator (localitatea trebuie să fie în acel județ);
 *    dacă nomenclatorul nu răspunde, se păstrează (fuseseră validate);
 *  - altfel: județul după denumire, apoi localitatea în județul găsit,
 *    DOAR la potrivire exactă și unică.
 * Fără excepții. `status`:
 *   "resolved"    - countyId + cityId sigure
 *   "not_found"   - nomenclatorul răspunde, dar locul nu există / e ambiguu / e în alt județ
 *   "unavailable" - nomenclatorul nu a putut fi consultat
 *   "missing"     - județ sau localitate lipsă
 * @returns {Promise<{countyId:number|string|null, cityId:number|string|null, status:string, source?:string}>}
 */
export async function resolveSamedayPlace(ctx, { county, city, countyId = null, cityId = null } = {}) {
  const empty = (status) => ({ countyId: null, cityId: null, status });
  const env = ctx?.publicConfig?.environment || "production";

  // ID-uri existente: verificare în nomenclator (pe ID-ul județului)
  if (validId(countyId) && validId(cityId)) {
    try {
      if (normalizePlaceName(city)) {
        const rows = await citiesNamed(ctx, env, countyId, city);
        const wanted = normalizePlaceName(city);
        if (rows.some((row) => String(row.id) === String(cityId) && normalizePlaceName(row?.name) === wanted)) {
          return { countyId, cityId, status: "resolved", source: "refs" };
        }
        // ID-urile nu (mai) corespund numelui -> rezolvare din nou după nume, mai jos
      } else {
        return { countyId, cityId, status: "resolved", source: "refs" };
      }
    } catch {
      // nomenclator indisponibil: ID-urile salvate au fost validate anterior
      return { countyId, cityId, status: "resolved", source: "refs" };
    }
  }

  if (!normalizePlaceName(county) || !normalizePlaceName(city)) return empty("missing");

  try {
    const countyRow = await cached(`${env}|county|${normalizePlaceName(county)}`, async () => {
      const q = new URLSearchParams({ name: String(county).trim(), countryCode: "RO", countPerPage: "50" });
      return uniqueMatch(listOf(await samedayGet(ctx, `/api/geolocation/county?${q}`)), county);
    });
    if (!countyRow) return empty("not_found");

    const cityRow = uniqueMatch(await citiesNamed(ctx, env, countyRow.id, city), city);
    // ID-uri doar ca pereche completă; altfel doar numele (countyString / cityString)
    return cityRow ? { countyId: countyRow.id, cityId: cityRow.id, status: "resolved", source: "nomenclator" } : empty("not_found");
  } catch {
    return empty("unavailable");
  }
}
