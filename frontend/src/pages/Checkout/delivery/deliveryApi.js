// src/pages/Checkout/delivery/deliveryApi.js
//
// Apelurile către proxy-ul de livrare Artfest (/api/shipping). Frontend-ul nu
// vorbește niciodată direct cu Sameday. Cache scurt în memorie pentru
// nomenclator (aceleași date la fiecare deschidere).

import { api } from "../../../lib/api";

const memo = new Map();
function cached(key, load) {
  if (!memo.has(key)) {
    memo.set(
      key,
      load().catch((error) => {
        memo.delete(key);
        throw error;
      })
    );
  }
  return memo.get(key);
}

/**
 * { ok, enabled, nomenclator, methods: [{ method, label }] }.
 * La eroare: ok = false (doar adresa). Checkout-ul NU schimbă formularul pe
 * baza unei cereri eșuate - vezi mergeDeliveryOptions (deliveryState.js).
 */
export async function fetchDeliveryOptions() {
  try {
    const data = await api("/api/shipping/options");
    const methods = Array.isArray(data?.methods) ? data.methods.filter((m) => ["HOME", "LOCKER", "PUDO"].includes(m?.method)) : [];
    return {
      ok: true,
      enabled: Boolean(data?.enabled),
      nomenclator: Boolean(data?.nomenclator),
      methods: methods.length ? methods : [{ method: "HOME", label: "Livrare la adresă" }],
    };
  } catch {
    return { ok: false, enabled: false, nomenclator: false, methods: [{ method: "HOME", label: "Livrare la adresă" }] };
  }
}

export function fetchCounties() {
  return cached("counties", async () => (await api("/api/shipping/counties"))?.items || []);
}

export function fetchCities(countyId, q = "") {
  const params = new URLSearchParams({ countyId: String(countyId), q: String(q || "") });
  return cached(`cities:${params}`, async () => (await api(`/api/shipping/cities?${params}`))?.items || []);
}

/**
 * Locațiile vizibile: { items, total }. type = LOCKER | PUDO | ALL.
 * city / county = zona din adresa clientului (doar ordonare, nu filtru);
 * near = { lat, lng } doar dacă clientul a permis poziția - rotunjită la ~1 km,
 * trimisă doar pentru ordonare, nesalvată nicăieri.
 */
export async function searchOohLocations({ q = "", type = "ALL", city = "", county = "", near = null, signal } = {}) {
  const params = new URLSearchParams({ q: String(q || "").slice(0, 80), type });
  if (near && Number.isFinite(near.lat) && Number.isFinite(near.lng)) {
    params.set("near", `${near.lat.toFixed(2)},${near.lng.toFixed(2)}`);
  } else {
    if (city) params.set("city", String(city).slice(0, 160));
    if (county) params.set("county", String(county).slice(0, 120));
  }
  const data = await api(`/api/shipping/ooh-locations?${params}`, { signal });
  return { items: Array.isArray(data?.items) ? data.items : [], total: Number(data?.total) || 0 };
}

/** Text comparabil (fără diacritice), ca pe server. */
export function foldText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
