// backend/src/services/shipping/samedayCheckoutPricer.js
//
// Sursa principală de preț la checkout: tariful real Sameday, prin
// POST /api/awb/estimate-cost (Swagger; PDF v3.6 nu documentează endpoint-ul),
// pe contul Artfest (CourierAccount PLATFORM), cu ridicare de la vendor
// (thirdPartyPickup = 1) - exact ca la crearea AWB-ului.
//
// Dacă estimarea nu poate fi făcută (configurare lipsă, greutate necunoscută,
// colet peste 38 kg, adresă de ridicare lipsă, timeout, 5xx, răspuns invalid,
// autentificare indisponibilă, date respinse), aruncă ShippingPricingUnavailable cu motivul;
// resolveGroupShippingPrice folosește atunci tariful de rezervă al vendorului.
//
// Fără autentificare la fiecare estimare: tokenul e reținut de client.js.
// Cache de preț: cheia = hash-ul formularului complet trimis la Sameday
// (cont, mediu, serviciu, greutate / colete, destinatar, locație OOH, punct
// de ridicare, vendor) -> nu poate întoarce prețul altui vendor / altei
// adrese / altei greutăți / altui locker / altui serviciu.

import crypto from "node:crypto";

import { prisma as defaultDb } from "../../db.js";
import { findPlatformCourierAccount, platformConfig } from "../../couriers/platformAccount.js";
import { getCourierProvider } from "../../couriers/registry.js";
import { openCredentials } from "../../couriers/credentials/store.js";
import { buildPickupParty } from "../../couriers/awb/addresses.js";
import { buildSamedayAwbForm } from "../../couriers/providers/sameday/awbMapper.js";
import { buildShipmentParcels } from "../../lib/productShipping.js";
import {
  CourierAuthError,
  CourierTimeoutError,
  CourierUnavailableError,
  CourierValidationError,
} from "../../couriers/errors.js";

export const SAMEDAY_PRICING_REASONS = Object.freeze({
  NOT_CONFIGURED: "primary_pricing_not_configured",
  SERVICE_UNAVAILABLE: "sameday_service_unavailable",
  PARCEL_UNKNOWN: "parcel_weight_unknown",
  PARCEL_OVERSIZED: "parcel_oversized",
  PICKUP_MISSING: "vendor_pickup_address_missing",
  TIMEOUT: "sameday_timeout",
  UNAVAILABLE: "sameday_unavailable",
  AUTH: "sameday_auth_unavailable",
  REJECTED: "sameday_rejected",
  INVALID_RESPONSE: "sameday_invalid_response",
  ERROR: "primary_pricing_error",
});

export const CHECKOUT_ESTIMATE_TIMEOUT_MS = 5_000;
// după o cădere Sameday (timeout / 5xx / autentificare) nu mai încercăm o
// scurtă perioadă: quote-urile următoare iau direct tariful de rezervă
export const SAMEDAY_OUTAGE_COOLDOWN_MS = 30_000;
const OUTAGE_REASONS = new Set(["sameday_timeout", "sameday_unavailable", "sameday_auth_unavailable"]);
const PRICE_CACHE_TTL_MS = 10 * 60 * 1000;
const PRICE_CACHE_MAX = 2_000;
const CONTEXT_TTL_MS = 60 * 1000;
const OOH_TYPE = Object.freeze({ LOCKER: 0, PUDO: 1 });

export class ShippingPricingUnavailable extends Error {
  constructor(fallbackReason) {
    super(`Tariful Sameday nu este disponibil (${fallbackReason}).`);
    this.name = "ShippingPricingUnavailable";
    this.fallbackReason = fallbackReason;
  }
}

const unavailable = (reason) => new ShippingPricingUnavailable(reason);

/** Eroare de la curier / rețea -> motivul salvat în fallbackReason. */
export function fallbackReasonForError(e) {
  if (e instanceof ShippingPricingUnavailable) return e.fallbackReason;
  if (e instanceof CourierTimeoutError) return SAMEDAY_PRICING_REASONS.TIMEOUT;
  if (e instanceof CourierAuthError) return SAMEDAY_PRICING_REASONS.AUTH;
  if (e instanceof CourierValidationError) return SAMEDAY_PRICING_REASONS.REJECTED;
  if (e instanceof CourierUnavailableError) {
    return e.invalidResponse ? SAMEDAY_PRICING_REASONS.INVALID_RESPONSE : SAMEDAY_PRICING_REASONS.UNAVAILABLE;
  }
  return SAMEDAY_PRICING_REASONS.ERROR;
}

/** Răspunsul estimate-cost ({ amount, currency, time }) -> bani; altfel null. */
export function carrierCostCentsFromEstimate(estimate) {
  const amount = Number(estimate?.amount);
  if (estimate?.amount == null || estimate.amount === "" || !Number.isFinite(amount) || amount < 0) return null;
  const currency = estimate?.currency == null ? null : String(estimate.currency).trim().toUpperCase();
  if (currency && currency !== "RON") return null;
  return Math.round(amount * 100);
}

/*
 * Coletul unui shipment la checkout, din profilul logistic al produselor
 * (lib/productShipping.js): greutatea însumată (greutate × cantitate),
 * un singur colet, dimensiuni doar pentru un produs cu qty = 1.
 * Un produs fără greutate -> parcel_weight_unknown; peste 38 kg ->
 * parcel_oversized (fără estimare automată). Nu inventăm valori.
 */
export function checkoutParcelsFromGroup({ group }) {
  return buildShipmentParcels(group?.items || []);
}

function cleanParcels(parcels) {
  if (!Array.isArray(parcels) || !parcels.length) return null;
  const list = parcels.map((p) => ({
    weightKg: Number(p?.weightKg),
    lengthCm: p?.lengthCm ?? null,
    widthCm: p?.widthCm ?? null,
    heightCm: p?.heightCm ?? null,
  }));
  return list.every((p) => Number.isFinite(p.weightKg) && p.weightKg > 0) ? list : null;
}

function recipientFor({ method, address, place, ooh }) {
  const base = {
    name: address?.name || [address?.firstName, address?.lastName].filter(Boolean).join(" ") || null,
    phone: address?.phone || null,
    email: address?.email || null,
  };
  if (method === "HOME") {
    return {
      ...base,
      county: place?.countyName || address?.county || null,
      city: place?.cityName || address?.city || null,
      countyId: place?.countyId ?? null,
      cityId: place?.cityId ?? null,
      address: address?.street || null,
      postalCode: address?.postalCode || null,
    };
  }
  // easybox / Sameday Point: destinația e locația aleasă
  return { ...base, county: ooh.county, city: ooh.city, address: ooh.address, postalCode: ooh.postalCode || null };
}

/**
 * @param {Object} [deps]  injectate în teste
 * @param {Function} [deps.loadContext]     () => Promise<{ ctx, config }|null>
 * @param {Object}   [deps.provider]        providerul Sameday (estimateCost, resolvePlace)
 * @param {Function} [deps.resolveParcels]  ({ group }) => parcels[] | null
 * @param {Function} [deps.loadPickup]      (vendorId) => Promise<{ party, blockers }>
 */
export function createSamedayCheckoutPricer({
  db = defaultDb,
  loadContext = null,
  provider = null,
  resolveParcels = checkoutParcelsFromGroup,
  loadPickup = null,
  timeoutMs = CHECKOUT_ESTIMATE_TIMEOUT_MS,
  // rezolvarea ID-urilor de județ / localitate ale vendorului (opțională pentru estimare)
  placeTimeoutMs = Math.min(2_000, timeoutMs),
  cacheTtlMs = PRICE_CACHE_TTL_MS,
  outageCooldownMs = SAMEDAY_OUTAGE_COOLDOWN_MS,
  now = () => Date.now(),
  log = (msg) => console.warn(msg),
} = {}) {
  const def = () => provider || getCourierProvider("SAMEDAY");
  const priceCache = new Map();
  let ctxCache = { value: undefined, at: 0 };
  let outage = null; // { reason, until }

  async function context() {
    if (loadContext) return loadContext();
    if (ctxCache.value !== undefined && now() - ctxCache.at < CONTEXT_TTL_MS) return ctxCache.value;
    let value = null;
    try {
      const account = await findPlatformCourierAccount(db);
      const config = platformConfig(account);
      if (account && account.provider === "SAMEDAY" && account.status === "ACTIVE" && config.pickupPointId) {
        value = {
          ctx: { accountId: account.id, credentials: openCredentials(account), publicConfig: account.publicConfig || {} },
          config,
        };
      }
    } catch {
      value = null;
    }
    ctxCache = { value, at: now() };
    return value;
  }

  async function pickupFor(vendorId) {
    if (loadPickup) return loadPickup(vendorId);
    const [vendor, billing, pickup] = await Promise.all([
      db.vendor.findUnique({ where: { id: vendorId }, select: { id: true, displayName: true } }),
      db.vendorBilling.findUnique({ where: { vendorId }, select: { legalType: true, companyName: true, cui: true, regCom: true } }),
      db.vendorPickupAddress.findFirst({ where: { vendorId }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }),
    ]);
    return buildPickupParty({ vendor, billing, pickup });
  }

  async function withPlaceIds(ctx, party) {
    // ID-urile salvate (providerRefs) doar propuse resolverului; în formular ajung doar cele confirmate
    const { samedayCountyId, samedayCityId, ...clean } = party || {};
    if (typeof def().resolvePlace !== "function") return clean;
    try {
      // în termenul estimării: un nomenclator lent nu ține checkout-ul (rămân numele)
      let timer;
      const place = await Promise.race([
        def().resolvePlace(ctx, { county: clean.county, city: clean.city, countyId: samedayCountyId, cityId: samedayCityId }),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(null), placeTimeoutMs);
        }),
      ]).finally(() => clearTimeout(timer));
      return place?.countyId && place?.cityId ? { ...clean, countyId: place.countyId, cityId: place.cityId } : clean;
    } catch {
      return clean; // doar numele (Sameday le mapează automat)
    }
  }

  function cached(key) {
    const hit = priceCache.get(key);
    if (hit && hit.expiresAt > now()) return hit.cents;
    if (hit) priceCache.delete(key);
    return null;
  }

  function remember(key, cents) {
    if (priceCache.size >= PRICE_CACHE_MAX) priceCache.delete(priceCache.keys().next().value);
    priceCache.set(key, { cents, expiresAt: now() + cacheTtlMs });
  }

  async function estimateWithTimeout(ctx, input) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new CourierTimeoutError()), timeoutMs);
    });
    try {
      return await Promise.race([def().estimateCost(ctx, input), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * @returns {Promise<{ amountCents:number, carrierCostCents:number, source:"SAMEDAY" }>}
   * @throws {ShippingPricingUnavailable}
   */
  async function price({ group, method, serviceId, ooh = null, place = null, address = null }) {
    try {
      const platform = await context();
      if (!platform) throw unavailable(SAMEDAY_PRICING_REASONS.NOT_CONFIGURED);
      if (!serviceId) throw unavailable(SAMEDAY_PRICING_REASONS.SERVICE_UNAVAILABLE);

      const isOoh = method === "LOCKER" || method === "PUDO";
      if (isOoh && (!ooh?.oohId || ooh.oohType !== OOH_TYPE[method])) {
        throw unavailable(SAMEDAY_PRICING_REASONS.SERVICE_UNAVAILABLE);
      }

      // resolveParcels: { parcels } | { reason } (sau direct lista, în teste)
      const resolved = await resolveParcels({ group, method });
      if (resolved?.reason === SAMEDAY_PRICING_REASONS.PARCEL_OVERSIZED) throw unavailable(SAMEDAY_PRICING_REASONS.PARCEL_OVERSIZED);
      const parcels = cleanParcels(Array.isArray(resolved) ? resolved : resolved?.parcels);
      if (!parcels) throw unavailable(SAMEDAY_PRICING_REASONS.PARCEL_UNKNOWN);

      const { party, blockers } = await pickupFor(group.vendorId);
      if (!party || blockers?.length) throw unavailable(SAMEDAY_PRICING_REASONS.PICKUP_MISSING);

      if (outage && outage.until > now()) throw unavailable(outage.reason);

      const { ctx, config } = platform;
      const input = {
        serviceId,
        pickupPointId: config.pickupPointId,
        contactPersonId: config.contactPersonId,
        parcels,
        // ramburs: neinclus în estimare (suma finală depinde chiar de transport)
        codAmount: 0,
        declaredValue: 0,
        recipient: recipientFor({ method, address, place, ooh }),
        thirdParty: await withPlaceIds(ctx, party),
        oohLastMile: isOoh ? ooh.oohId : null,
      };

      const form = buildSamedayAwbForm(input, { forEstimate: true });
      const key = crypto
        .createHash("sha256")
        .update(JSON.stringify([ctx.accountId, ctx.publicConfig?.environment || "production", group.vendorId, form.toString()]))
        .digest("hex");
      let cents = cached(key);
      if (cents == null) {
        const estimate = await estimateWithTimeout(ctx, input);
        cents = carrierCostCentsFromEstimate(estimate);
        if (cents == null) throw unavailable(SAMEDAY_PRICING_REASONS.INVALID_RESPONSE);
        remember(key, cents);
      }
      return { amountCents: cents, carrierCostCents: cents, source: "SAMEDAY" };
    } catch (e) {
      const reason = fallbackReasonForError(e);
      if (OUTAGE_REASONS.has(reason) && !(outage && outage.until > now())) outage = { reason, until: now() + outageCooldownMs };
      // fără date personale / secrete în log: doar motivul și vendorul
      if (![SAMEDAY_PRICING_REASONS.NOT_CONFIGURED, SAMEDAY_PRICING_REASONS.PARCEL_UNKNOWN, SAMEDAY_PRICING_REASONS.PARCEL_OVERSIZED].includes(reason)) {
        log(`[shipping] tarif Sameday indisponibil (${reason}) pentru vendor ${group?.vendorId || "?"}`);
      }
      throw e instanceof ShippingPricingUnavailable ? e : unavailable(reason);
    }
  }

  price._clearCache = () => {
    priceCache.clear();
    ctxCache = { value: undefined, at: 0 };
    outage = null;
  };
  return price;
}

let singleton = null;

/** Sursa principală de preț folosită de checkout (cu flagul Sameday pornit). */
export function getPrimaryShippingPricer() {
  if (!singleton) singleton = createSamedayCheckoutPricer();
  return singleton;
}
