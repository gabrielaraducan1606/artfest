// backend/src/couriers/providers/sameday/geolocation.js

import { samedayGet } from "./client.js";

/*
 * Nomenclatorul Sameday de județe / localități (doc v3.6):
 *   GET /api/geolocation/county?name=&countryCode=   -> data: [{ id, name, code }]
 *   GET /api/geolocation/city?name=&county=&countryCode= -> data: [{ id, name, county: { id, name, code }, postalCode, ... }]
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

/**
 * @returns {Promise<{countyId:number|string|null, cityId:number|string|null}>}
 *   fără excepții: orice problemă -> null (se trimit doar numele)
 */
export async function resolveSamedayPlace(ctx, { county, city }) {
  const empty = { countyId: null, cityId: null };
  if (!normalizePlaceName(county) || !normalizePlaceName(city)) return empty;

  const env = ctx?.publicConfig?.environment || "production";

  try {
    const countyRow = await cached(`${env}|county|${normalizePlaceName(county)}`, async () => {
      const q = new URLSearchParams({ name: String(county).trim(), countryCode: "RO", countPerPage: "50" });
      return uniqueMatch(listOf(await samedayGet(ctx, `/api/geolocation/county?${q}`)), county);
    });
    if (!countyRow) return empty;

    const cityRow = await cached(`${env}|city|${countyRow.id}|${normalizePlaceName(city)}`, async () => {
      const q = new URLSearchParams({
        name: String(city).trim(),
        county: String(countyRow.name),
        countryCode: "RO",
        countPerPage: "100",
      });
      return uniqueMatch(
        listOf(await samedayGet(ctx, `/api/geolocation/city?${q}`)),
        city,
        (row) => String(row?.county?.id ?? "") === String(countyRow.id)
      );
    });

    // ID-uri doar ca pereche completă; altfel doar numele
    return cityRow ? { countyId: countyRow.id, cityId: cityRow.id } : empty;
  } catch {
    // nomenclator indisponibil -> doar numele (AWB-ul nu e blocat de asta)
    return empty;
  }
}
