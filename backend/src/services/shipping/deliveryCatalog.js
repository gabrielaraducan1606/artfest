// backend/src/services/shipping/deliveryCatalog.js
//
// Catalogul de livrare pentru checkout (servicii active, nomenclator,
// easybox / Sameday Point), peste contul Sameday al ARTFEST (CourierAccount
// PLATFORM). Tokenul și credentialele rămân pe server; frontend-ul vede doar
// date publice (nume, adresă, program, coordonate) - niciun ID de serviciu.
//
// Fără cont Sameday funcțional -> catalog „indisponibil”: checkout-ul
// rămâne pe livrarea la adresă de până acum (nimic nu se rupe).

import { prisma as defaultDb } from "../../db.js";
import { findPlatformCourierAccount, platformConfig } from "../../couriers/platformAccount.js";
import { getCourierProvider } from "../../couriers/registry.js";
import { openCredentials } from "../../couriers/credentials/store.js";
import {
  classifySamedayServices,
  fetchOohLocationById,
  listActiveServicesCached,
  listCitiesCached,
  listCountiesCached,
  listOohLocationsCached,
} from "../../couriers/providers/sameday/catalog.js";
import { publicOoh } from "./oohPublic.js";

export const MAX_OOH_RESULTS = 300;

/*
 * Termen maxim pentru o citire Sameday în checkout. Clientul HTTP are 10 s per
 * cerere (+ autentificare), iar un Sameday care nu răspunde ar ține quote-ul /
 * plasarea zeci de secunde (frontend-ul ar raporta „comanda nu a putut fi
 * plasată”). Peste termen -> „indisponibil”, iar checkout-ul trece pe rezervă
 * (adresă text, tariful vendorului). Încărcarea începută continuă și umple cache-ul.
 */
export const CATALOG_DEADLINE_MS = 4_000;
export const OOH_LIST_DEADLINE_MS = 8_000;

export class CatalogDeadlineError extends Error {
  constructor() {
    super("Catalogul de livrare nu a răspuns la timp.");
    this.name = "CatalogDeadlineError";
    this.code = "catalog_timeout";
  }
}

export function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new CatalogDeadlineError()), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/** Distanța aproximativă în km (haversine) - doar pentru ordonare. */
export function distanceKm(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Text comparabil: fără diacritice, litere mici, spații normalizate. */
export function foldText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Forma publică a unei locații (ce vede clientul) - definită în oohPublic.js. */
export { publicOoh };

/**
 * @param {Object} [deps]  injectate în teste
 * @param {Function} [deps.loadContext]  () => Promise<ctx|null>
 * @param {Object} [deps.provider]       providerul Sameday (listServices)
 * @param {Function} [deps.fetchOohById] (ctx, oohId) => locație | null (revalidare punctuală)
 */
export function createDeliveryCatalog({
  db = defaultDb,
  loadContext = null,
  provider = null,
  fetchOohById = fetchOohLocationById,
  deadlineMs = CATALOG_DEADLINE_MS,
  oohListDeadlineMs = OOH_LIST_DEADLINE_MS,
} = {}) {
  let ctxCache = { value: undefined, at: 0 };

  async function context() {
    if (loadContext) return loadContext();
    if (ctxCache.value !== undefined && Date.now() - ctxCache.at < 60_000) return ctxCache.value;
    let value = null;
    try {
      const account = await findPlatformCourierAccount(db);
      if (account && account.provider === "SAMEDAY" && account.status === "ACTIVE") {
        value = { accountId: account.id, credentials: openCredentials(account), publicConfig: account.publicConfig || {} };
      }
    } catch {
      value = null;
    }
    ctxCache = { value, at: Date.now() };
    return value;
  }

  const def = () => provider || getCourierProvider("SAMEDAY");

  /**
   * Metodele disponibile acum: HOME e mereu disponibilă (livrarea de până
   * acum); LOCKER / PUDO doar cu serviciul activ pe contul Artfest.
   * @returns {{ courierAvailable: boolean, services: {HOME?, LOCKER?, PUDO?}, reason?: string }}
   */
  async function getServices() {
    const ctx = await context();
    if (!ctx) return { courierAvailable: false, services: {}, reason: "courier_account_missing" };
    try {
      const services = await withDeadline(listActiveServicesCached(def(), ctx), deadlineMs);
      const cfg = platformConfig({ publicConfig: ctx.publicConfig });
      return {
        courierAvailable: true,
        services: classifySamedayServices(services, {
          serviceId: cfg.serviceId,
          lockerServiceId: ctx.publicConfig?.lockerServiceId,
          pudoServiceId: ctx.publicConfig?.pudoServiceId,
        }),
      };
    } catch (e) {
      return { courierAvailable: false, services: {}, reason: e instanceof CatalogDeadlineError ? "courier_timeout" : "courier_unavailable" };
    }
  }

  async function allOoh() {
    const ctx = await context();
    if (!ctx) return [];
    return withDeadline(listOohLocationsCached(ctx), oohListDeadlineMs);
  }

  /**
   * Căutare locații vizibile (clientVisible = 1), doar pentru metodele active.
   * Ordinea (fără a filtra în plus):
   *   - `near` (poziția din browser, doar dacă clientul a permis-o; NU se
   *     salvează / loghează) -> după distanță;
   *   - altfel `city` / `county` (din adresa clientului) -> întâi localitatea,
   *     apoi județul, apoi restul;
   *   - altfel ordinea catalogului.
   * @param {{ q?: string, type?: "LOCKER"|"PUDO"|"ALL", limit?: number, city?: string, county?: string, near?: {lat:number,lng:number}|null }} params
   */
  async function searchOoh({ q = "", type = "ALL", limit = MAX_OOH_RESULTS, city = "", county = "", near = null } = {}) {
    const { services } = await getServices();
    const allowed = new Set(["LOCKER", "PUDO"].filter((m) => services[m] && (type === "ALL" || type === m)));
    if (!allowed.size) return { items: [], total: 0 };
    const terms = foldText(q).split(" ").filter(Boolean);
    const rows = (await allOoh()).filter((l) => l.clientVisible && allowed.has(l.method));
    const matched = terms.length
      ? rows.filter((l) => {
          const hay = foldText(`${l.name} ${l.address} ${l.city} ${l.county} ${l.postalCode || ""}`);
          return terms.every((t) => hay.includes(t));
        })
      : rows;

    let ordered = matched;
    const withNear = near && Number.isFinite(near.lat) && Number.isFinite(near.lng);
    if (withNear) {
      ordered = matched
        .map((l) => ({ l, d: Number.isFinite(l.lat) && Number.isFinite(l.lng) ? distanceKm(near, l) : Infinity }))
        .sort((a, b) => a.d - b.d)
        .map((x) => Object.assign({}, x.l, { distanceKm: Number.isFinite(x.d) ? Math.round(x.d * 10) / 10 : null }));
    } else {
      const fc = foldText(city);
      const fj = foldText(county);
      if (fc || fj) {
        const rank = (l) => (fc && foldText(l.city) === fc ? 0 : fj && foldText(l.county) === fj ? 1 : 2);
        ordered = matched.map((l, i) => ({ l, r: rank(l), i })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.l);
      }
    }

    const max = Math.min(Math.max(1, Number(limit) || MAX_OOH_RESULTS), MAX_OOH_RESULTS);
    return {
      items: ordered.slice(0, max).map((l) => (withNear ? { ...publicOoh(l), distanceKm: l.distanceKm } : publicOoh(l))),
      total: ordered.length,
    };
  }

  /** Locația cu ID-ul dat, DOAR dacă există și e vizibilă clientului. */
  async function findOoh(oohId) {
    const id = Number(oohId);
    if (!Number.isInteger(id) || id <= 0) return null;
    return (await allOoh()).find((l) => l.oohId === id && l.clientVisible) || null;
  }

  /**
   * Revalidare PUNCTUALĂ (oohList=<id>, fără cache) - pentru „Ultimul punct
   * folosit” și la plasarea comenzii. Locația e acceptată DOAR dacă există
   * și are clientVisible = 1. Dacă Sameday nu răspunde (timeout / 5xx),
   * cădem pe lista din cache (tot catalogul Sameday, doar mai vechi);
   * un 404 de la Sameday înseamnă „nu mai există” -> null, fără fallback.
   * Nici live, nici cache -> source "unavailable" (locația NU e considerată
   * validă; checkout-ul cere altă metodă sau o nouă încercare).
   * @returns {Promise<{ loc: Object|null, source: "live"|"cache"|"none"|"unavailable" }>}
   */
  async function findOohFresh(oohId) {
    const id = Number(oohId);
    if (!Number.isInteger(id) || id <= 0) return { loc: null, source: "none" };
    const ctx = await context();
    if (!ctx) return { loc: null, source: "none" };
    try {
      const loc = await withDeadline(fetchOohById(ctx, id), deadlineMs);
      return { loc: loc && loc.clientVisible ? loc : null, source: "live" };
    } catch {
      try {
        return { loc: await findOoh(id), source: "cache" };
      } catch {
        return { loc: null, source: "unavailable" };
      }
    }
  }

  async function counties() {
    const ctx = await context();
    if (!ctx) return [];
    return withDeadline(listCountiesCached(ctx), deadlineMs);
  }

  async function findCounty(countyId) {
    return (await counties()).find((c) => String(c.id) === String(countyId)) || null;
  }

  async function cities(countyId, q = "") {
    const ctx = await context();
    const county = ctx ? await findCounty(countyId) : null;
    if (!county) return [];
    const list = await withDeadline(listCitiesCached(ctx, county), deadlineMs);
    const term = foldText(q);
    return term ? list.filter((c) => foldText(`${c.name} ${c.village || ""}`).includes(term)) : list;
  }

  async function findCity(countyId, cityId) {
    return (await cities(countyId)).find((c) => String(c.id) === String(cityId)) || null;
  }

  return { getServices, searchOoh, findOoh, findOohFresh, counties, findCounty, cities, findCity };
}

let shared = null;
export function deliveryCatalog() {
  if (!shared) shared = createDeliveryCatalog();
  return shared;
}
