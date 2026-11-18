// src/pages/Checkout/delivery/shippingQuote.js
//
// Prețul transportului afișat la checkout când livrarea Sameday e activă:
// îl calculează SERVERUL (/api/checkout/quote | /guest/quote) - tariful
// Sameday sau, dacă nu e disponibil, tariful de rezervă al magazinului.
// Frontend-ul primește doar prețul pe magazin (fără cost curier / sursă /
// payload Sameday) și îl afișează; la plasare serverul îl recalculează.

import { buildSelectionsPayload, effectiveSelection, missingLocations } from "./deliveryState.js";

export const QUOTE_DEBOUNCE_MS = 600;

/** Doar câmpurile adresei care contează pentru tarif. */
export function quoteAddress(a = {}) {
  return {
    firstName: a.firstName || "",
    lastName: a.lastName || "",
    name: a.name || "",
    phone: a.phone || "",
    email: a.email || "",
    county: a.county || "",
    city: a.city || "",
    street: a.street || "",
    postalCode: a.postalCode || "",
    samedayCountyId: a.samedayCountyId ?? null,
    samedayCityId: a.samedayCityId ?? null,
  };
}

/**
 * Corpul cererii de quote. Magazinele cu easybox / Sameday Point fără locație
 * aleasă sunt cerute ca „adresă” doar ca să putem calcula restul; prețul lor
 * NU se afișează până la alegerea locației.
 */
export function buildQuoteRequest({ groupKeys, selections, methods, address, guestItems = null }) {
  const missing = missingLocations(groupKeys, selections, methods);
  const payload = buildSelectionsPayload(groupKeys, selections, methods);
  // modul de livrare rămâne (doar locația lipsește)
  for (const key of missing) payload[key] = { method: "HOME", ...(payload[key]?.fulfillment ? { fulfillment: payload[key].fulfillment } : {}) };
  const body = { address: quoteAddress(address), selections: payload, ...(guestItems ? { items: guestItems } : {}) };
  return { body, missing };
}

/**
 * Cheia cererii de quote (o cerere nouă doar când se schimbă). Lista locațiilor lipsă intră în cheie:
 * easybox ales fără locație trimite același corp ca „la adresă”, dar prețul afișat
 * trebuie să devină „Alege locația”, nu tariful la adresă.
 */
export function quoteRequestKey({ isGuest, cartKey, refreshKey = 0, request }) {
  return request ? JSON.stringify([isGuest, cartKey, refreshKey, request.body, request.missing]) : "";
}

export const SHIPPING_UNAVAILABLE_MESSAGE =
  "Nu putem calcula acum costul transportului pentru acest magazin. Încearcă din nou în câteva minute.";

/**
 * Răspunsul serverului -> { [serviceId]: { price, qualifiesFreeShipping } }.
 * Magazin fără niciun tarif (Sameday indisponibil + fără tarif de rezervă):
 * { unavailable: true, message } - doar acel magazin, fără preț inventat.
 */
export function readQuote(data) {
  const byGroup = {};
  for (const s of Array.isArray(data?.shipments) ? data.shipments : []) {
    if (s?.serviceId == null) continue;
    // modul de livrare: cel ales / preselectat + opțiunile magazinului (prețul fiecăreia)
    const mode = {
      selectedFulfillment: typeof s.selectedFulfillment === "string" ? s.selectedFulfillment : null,
      preselected: Boolean(s.preselected),
      options: readOptions(s.fulfillmentOptions),
      samedayUnavailable: s.samedayUnavailable?.message ? { code: String(s.samedayUnavailable.code || ""), message: String(s.samedayUnavailable.message) } : null,
    };
    if (s.priceUnavailable) {
      byGroup[String(s.serviceId)] = { unavailable: true, message: String(s.priceUnavailableMessage || SHIPPING_UNAVAILABLE_MESSAGE), ...mode };
      continue;
    }
    const price = Number(s.price);
    if (!Number.isFinite(price) || price < 0) continue;
    byGroup[String(s.serviceId)] = { price, qualifiesFreeShipping: Boolean(s.qualifiesFreeShipping), ...mode };
  }
  return byGroup;
}

const priceOrNull = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v));

/** Opțiunile de livrare ale unui magazin (doar ce afișăm; serverul recalculează la plasare). */
function readOptions(raw) {
  const out = {};
  const vendor = raw?.VENDOR_COURIER;
  if (vendor) out.VENDOR_COURIER = { available: true, price: priceOrNull(vendor.price), qualifiesFreeShipping: Boolean(vendor.qualifiesFreeShipping) };
  const sameday = raw?.ARTFEST_SAMEDAY;
  if (sameday) {
    out.ARTFEST_SAMEDAY = {
      available: Boolean(sameday.available),
      price: priceOrNull(sameday.price),
      message: sameday.message ? String(sameday.message) : null,
      methods: Array.isArray(sameday.methods) ? sameday.methods.filter((m) => ["HOME", "LOCKER", "PUDO"].includes(m)) : ["HOME"],
    };
  }
  return out;
}

/**
 * Selecțiile trimise la PLASARE: modul de livrare explicit pentru fiecare magazin
 * (cel afișat clientului) + prețul transportului văzut de client, în bani. Serverul
 * recalculează și refuză (409) dacă prețul s-a schimbat - nimic nu e acceptat din frontend.
 */
export function buildPlaceSelections({ groupKeys, selections, methods, quote }) {
  const payload = buildSelectionsPayload(groupKeys, selections, methods);
  for (const key of groupKeys) {
    const hit = quote?.status === "ready" ? quote.byGroup?.[key] : null;
    const fulfillment = effectiveSelection(selections, key, methods).fulfillment || hit?.selectedFulfillment || null;
    if (fulfillment) payload[key] = { ...payload[key], fulfillment };
    if (hit && !hit.unavailable && Number.isFinite(hit.price)) payload[key].expectedShippingCents = Math.round(hit.price * 100);
  }
  return payload;
}

/**
 * Transportul unui magazin din starea quote-ului.
 * pending: "loading" (se calculează) | "location" (alege locația) |
 *          "unavailable" (se confirmă la plasare) | "blocked" (magazinul fără tarif acum) |
 *          null (preț final).
 */
export function quotedShipping(quote, groupKey) {
  if (quote?.missing?.includes(groupKey)) return { pending: "location", finalShipping: null, qualifiesFreeShipping: false };
  const hit = quote?.status === "ready" ? quote.byGroup?.[groupKey] : null;
  if (hit?.unavailable) return { pending: "blocked", finalShipping: null, qualifiesFreeShipping: false, blockedMessage: hit.message };
  if (hit) return { pending: null, finalShipping: hit.price, qualifiesFreeShipping: hit.qualifiesFreeShipping };
  return { pending: quote?.status === "error" ? "unavailable" : "loading", finalShipping: null, qualifiesFreeShipping: false };
}

const PENDING_LABELS = {
  loading: "Calculăm tariful…",
  location: "Alege locația",
  unavailable: "Se confirmă la plasare",
  blocked: "Indisponibil momentan",
};

/** Textul prețului (fără detalii tehnice; tariful de rezervă arată ca orice preț). */
export function shippingPriceLabel(shipping, formatMoney) {
  if (shipping?.pending) return PENDING_LABELS[shipping.pending] || PENDING_LABELS.loading;
  if (shipping?.qualifiesFreeShipping) return "Gratuit";
  return formatMoney(shipping?.finalShipping ?? 0);
}
