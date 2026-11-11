// backend/src/couriers/providers/sameday/catalog.js
//
// Date de catalog Sameday pentru checkout (doar citiri, cache în memorie):
//
//   GET /api/client/services        serviciile ACTIVE ale contului (Swagger);
//   GET /api/client/ooh-locations   lockere easybox + puncte PUDO (Swagger:
//                                   listingType 1 = lockere + PUDO; fără
//                                   filtrare după oraș / text -> lista se ia
//                                   paginat și se filtrează la noi);
//   GET /api/geolocation/county     județele (Swagger: name, countryCode, page, countPerPage);
//   GET /api/geolocation/city       localitățile unui județ: filtrul `county` = ID-ul
//                                   județului (API-ul real respinge numele; PDF v3.6
//                                   arată un exemplu cu numele - depășit).
//
// Endpoint-ul vechi GET /api/client/lockers NU e folosit (PDF v3.6: înlocuit
// de ooh-locations; Swagger: lockerId depreciat).
//
// Reguli din documentație:
//   - oohType 0 = easybox, 1 = PUDO / Sameday Point (PDF v3.6, Swagger);
//   - doar locațiile cu clientVisible = 1 se afișează clientului;
//   - serviciile se activează doar de Sameday - folosim ce întoarce contul.

import { samedayGet } from "./client.js";

/* ===================== cache TTL (cu „stale” la eroare) ===================== */

/**
 * Cache simplu: valoare proaspătă `ttlMs`; la eroare de reîncărcare se
 * folosește valoarea veche cel mult `staleMs`. O singură încărcare în zbor
 * per cheie (cererile simultane o așteaptă pe aceeași).
 */
export function createTtlCache({ ttlMs, staleMs = 0, now = () => Date.now() }) {
  const entries = new Map();
  const inflight = new Map();

  async function get(key, load) {
    const hit = entries.get(key);
    const t = now();
    if (hit && t - hit.at < ttlMs) return hit.value;
    if (inflight.has(key)) return inflight.get(key);

    const promise = (async () => {
      try {
        const value = await load();
        entries.set(key, { value, at: now() });
        return value;
      } catch (error) {
        if (hit && now() - hit.at < ttlMs + staleMs) return hit.value;
        throw error;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, promise);
    return promise;
  }

  return { get, clear: () => entries.clear(), size: () => entries.size };
}

const HOUR = 60 * 60 * 1000;
// servicii / nomenclator: date „care nu se schimbă” (PDF v3.6) -> cache lung
const servicesCache = createTtlCache({ ttlMs: 6 * HOUR, staleMs: 24 * HOUR });
const geoCache = createTtlCache({ ttlMs: 24 * HOUR, staleMs: 7 * 24 * HOUR });
// OOH: locațiile pot dispărea / apărea -> cache scurt, „stale” limitat
const oohCache = createTtlCache({ ttlMs: 30 * 60 * 1000, staleMs: 2 * HOUR });

export function _clearSamedayCatalogCache() {
  servicesCache.clear();
  geoCache.clear();
  oohCache.clear();
}

const listOf = (data) => (Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []);
const envKey = (ctx) => `${ctx?.accountId || "-"}|${ctx?.publicConfig?.environment || "production"}`;

/** Toate paginile unui endpoint paginat (total / pages / data), în loturi mici. */
async function fetchAllPages(ctx, path, params, { countPerPage = 100, maxPages = 200, batch = 4 } = {}) {
  const url = (page) => `${path}?${new URLSearchParams({ ...params, page: String(page), countPerPage: String(countPerPage) })}`;
  const first = await samedayGet(ctx, url(1));
  const rows = [...listOf(first)];
  const pages = Math.min(Number(first?.pages) || 1, maxPages);
  for (let start = 2; start <= pages; start += batch) {
    const chunk = [];
    for (let p = start; p < start + batch && p <= pages; p += 1) chunk.push(samedayGet(ctx, url(p)));
    for (const data of await Promise.all(chunk)) rows.push(...listOf(data));
  }
  return rows;
}

/* ===================== servicii ===================== */

export const DELIVERY_METHODS = Object.freeze(["HOME", "LOCKER", "PUDO"]);

// denumirile din PDF v3.6 („Services”): folosite DOAR pentru a recunoaște
// serviciul în lista activă a contului; ID-ul e întotdeauna cel întors de cont
const SERVICE_NAME_RULES = {
  HOME: [/^24\s*h$/i, /nextday\s*24\s*h/i, /home\s*delivery/i],
  LOCKER: [/^locker\s*next\s*day$/i],
  PUDO: [/^pudo\s*next\s*day$/i],
};
const EXCLUDED_NAME = /crossborder|retur|return|c2c|pdo|first\s*mile/i;

/**
 * Serviciul activ pentru fiecare metodă de livrare.
 * Prioritate: ID configurat explicit (publicConfig.serviceId pentru HOME,
 * lockerServiceId, pudoServiceId) - doar dacă e ACTIV pe cont; altfel
 * recunoașterea după denumirea documentată. Metodele fără serviciu activ
 * lipsesc din rezultat.
 * @param {{id, name, code, deliveryType}[]} services  GET /api/client/services (mapat)
 * @param {{serviceId?, lockerServiceId?, pudoServiceId?}} config
 * @returns {{HOME?: Object, LOCKER?: Object, PUDO?: Object}}
 */
export function classifySamedayServices(services = [], config = {}) {
  const active = (services || []).filter((s) => s && s.id != null);
  const byId = (id) => (id == null || id === "" ? null : active.find((s) => String(s.id) === String(id)) || null);
  const byName = (method) =>
    active.find((s) => {
      const name = String(s.name || "").trim();
      return name && !EXCLUDED_NAME.test(name) && SERVICE_NAME_RULES[method].some((re) => re.test(name));
    }) || null;

  const configured = { HOME: config.serviceId, LOCKER: config.lockerServiceId, PUDO: config.pudoServiceId };
  const out = {};
  for (const method of DELIVERY_METHODS) {
    const service = byId(configured[method]) || byName(method);
    if (service) out[method] = { id: String(service.id), name: service.name || null, source: byId(configured[method]) ? "config" : "name" };
  }
  return out;
}

export async function listActiveServicesCached(def, ctx) {
  return servicesCache.get(`${envKey(ctx)}|services`, () => def.listServices(ctx));
}

/* ===================== OOH (easybox + PUDO) ===================== */

const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const hhmm = (value) => {
  const m = String(value || "").match(/(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
};

/** Forma internă (fără câmpuri logistice interne Sameday). */
export function normalizeOohLocation(raw) {
  const oohId = toNumber(raw?.oohId);
  const oohType = toNumber(raw?.oohType);
  if (oohId == null || (oohType !== 0 && oohType !== 1)) return null;
  return {
    oohId,
    oohType,
    method: oohType === 0 ? "LOCKER" : "PUDO",
    name: String(raw?.name || "").trim(),
    address: String(raw?.address || "").trim(),
    city: String(raw?.city || "").trim(),
    cityId: toNumber(raw?.cityId),
    county: String(raw?.county || "").trim(),
    countyId: toNumber(raw?.countyId),
    postalCode: raw?.postalCode ? String(raw.postalCode).trim() : null,
    lat: toNumber(raw?.lat),
    lng: toNumber(raw?.lng),
    clientVisible: toNumber(raw?.clientVisible) === 1,
    // PDF v3.6: supportedPayment 0 = locația NU acceptă plata cu cardul, 1 = acceptă.
    // Doar plata cu CARDUL la locație e documentată (nu și numerarul) -> informativ;
    // null = câmp lipsă / necunoscut (nu se presupune nimic).
    acceptsCardPayment: toNumber(raw?.supportedPayment) === 1 ? true : toNumber(raw?.supportedPayment) === 0 ? false : null,
    schedule: (Array.isArray(raw?.schedule) ? raw.schedule : [])
      .map((s) => ({ day: toNumber(s?.day), open: hhmm(s?.openingHour), close: hhmm(s?.closingHour) }))
      .filter((s) => s.day != null),
    specialSchedule: (Array.isArray(raw?.specialSchedule) ? raw.specialSchedule : [])
      .map((s) => ({ day: toNumber(s?.day), month: toNumber(s?.month), closed: toNumber(s?.freeDay) === 1, open: hhmm(s?.openingHour), close: hhmm(s?.closingHour) }))
      .filter((s) => s.day != null && s.month != null),
  };
}

/** Toate locațiile OOH din RO (inclusiv cele ascunse - filtrarea se face la afișare / validare). */
export async function listOohLocationsCached(ctx) {
  return oohCache.get(`${envKey(ctx)}|ooh`, async () => {
    const rows = await fetchAllPages(ctx, "/api/client/ooh-locations", { listingType: "1", countryCode: "RO" }, { countPerPage: 100 });
    const byId = new Map();
    for (const row of rows) {
      const loc = normalizeOohLocation(row);
      if (loc) byId.set(loc.oohId, loc);
    }
    return [...byId.values()];
  });
}

/**
 * Revalidare PUNCTUALĂ, fără cache: GET /api/client/ooh-locations?oohList=<id>
 * (Swagger: `oohList` = „List with location ids separated by comma”;
 * PDF v3.6 are exact acest exemplu: oohList=500162&listingType=1).
 * Folosită înainte de reutilizarea „Ultimului punct folosit” și la plasare.
 * Swagger: 404 = „no results were found” -> locația nu mai există (null).
 * Orice altă eroare (auth, timeout, 5xx) se propagă - apelantul decide.
 * @returns {Promise<Object|null>} locația normalizată (inclusiv clientVisible) sau null
 */
export async function fetchOohLocationById(ctx, oohId) {
  const id = Number(oohId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const params = new URLSearchParams({ oohList: String(id), listingType: "1", countryCode: "RO", page: "1", countPerPage: "10" });
  let data;
  try {
    data = await samedayGet(ctx, `/api/client/ooh-locations?${params}`);
  } catch (error) {
    if (error?.providerStatus === 404) return null;
    throw error;
  }
  for (const row of listOf(data)) {
    const loc = normalizeOohLocation(row);
    if (loc && loc.oohId === id) return loc;
  }
  return null;
}

/* ===================== nomenclator ===================== */

export async function listCountiesCached(ctx) {
  return geoCache.get(`${envKey(ctx)}|counties`, async () => {
    const rows = await fetchAllPages(ctx, "/api/geolocation/county", { countryCode: "RO" }, { countPerPage: 500 });
    return rows
      .map((r) => ({ id: toNumber(r?.id), name: String(r?.name || "").trim(), code: r?.code ? String(r.code) : null }))
      .filter((r) => r.id != null && r.name)
      .sort((a, b) => a.name.localeCompare(b.name, "ro"));
  });
}

export async function listCitiesCached(ctx, county) {
  return geoCache.get(`${envKey(ctx)}|cities|${county.id}`, async () => {
    // `county` = ID-ul județului: API-ul real respinge denumirea (county=Buzau -> 400, county=11 -> 200;
    // confirmat pe producție 2026-10-31). Denumirea rămâne doar pentru afișare.
    const rows = await fetchAllPages(ctx, "/api/geolocation/city", { county: String(county.id), countryCode: "RO" }, { countPerPage: 500 });
    return rows
      .filter((r) => String(r?.county?.id ?? county.id) === String(county.id))
      .map((r) => ({
        id: toNumber(r?.id),
        name: String(r?.name || "").trim(),
        postalCode: r?.postalCode ? String(r.postalCode).trim() : null,
        village: r?.village ? String(r.village).trim() : null,
      }))
      .filter((r) => r.id != null && r.name)
      .sort((a, b) => a.name.localeCompare(b.name, "ro"));
  });
}
