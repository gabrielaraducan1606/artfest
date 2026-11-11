// src/pages/Checkout/addresses/addressBook.js
//
// Logica (fără React) a agendei de adrese din checkout: alegerea adresei de
// pornire, maparea pe formularul de checkout și textele afișate.
// Serverul (/api/me/addresses) e sursa de adevăr; aici doar prezentare.

export const ADDRESS_LABELS = Object.freeze({ HOME: "Acasă", WORK: "Birou", OTHER: "Altă adresă" });

const norm = (v) => String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Adresa cu care pornește checkout-ul:
 *  - păstrează alegerea din tab (refresh / rerender) dacă încă există;
 *  - o singură adresă -> ea;
 *  - mai multe -> cea implicită (altfel prima din listă);
 *  - niciuna -> null (se deschide „Adaugă adresă”).
 */
export function pickInitialAddress(addresses = [], previousId = null) {
  const list = Array.isArray(addresses) ? addresses : [];
  if (!list.length) return null;
  if (previousId) {
    const kept = list.find((a) => a.id === previousId);
    if (kept) return kept;
  }
  if (list.length === 1) return list[0];
  return list.find((a) => a.isDefault) || list[0];
}

/** Adresa salvată -> câmpurile formularului de checkout (emailul rămâne al clientului). */
export function addressToShipping(address, previous = {}) {
  if (!address) return previous;
  return {
    ...previous,
    firstName: address.firstName || "",
    lastName: address.lastName || "",
    name: `${address.lastName || ""} ${address.firstName || ""}`.trim(),
    phone: address.phone || "",
    county: address.county || "",
    city: address.city || "",
    postalCode: address.postalCode || "",
    street: address.street || "",
    notes: address.notes || "",
    // ID-urile Sameday doar dacă serverul le-a validat; altfel serverul lucrează cu textul
    samedayCountyId: address.samedayValidated ? address.samedayCountyId ?? null : null,
    samedayCityId: address.samedayValidated ? address.samedayCityId ?? null : null,
  };
}

/** Formularul de checkout (ex. ce a tastat un guest) -> corpul pentru POST /api/me/addresses. */
export function shippingToAddressInput(shipping = {}, label = "HOME") {
  return {
    label,
    firstName: shipping.firstName || "",
    lastName: shipping.lastName || "",
    phone: shipping.phone || "",
    county: shipping.county || "",
    city: shipping.city || "",
    street: shipping.street || "",
    postalCode: shipping.postalCode || "",
    notes: shipping.notes || "",
    samedayCountyId: shipping.samedayCountyId ?? null,
    samedayCityId: shipping.samedayCityId ?? null,
  };
}

/** Are formularul o adresă completă (de oferit „Salvează această adresă în cont”)? */
export function isShippingComplete(shipping = {}) {
  return Boolean(
    norm(shipping.firstName) && norm(shipping.lastName) && norm(shipping.phone) && norm(shipping.county) && norm(shipping.city) && norm(shipping.street)
  );
}

/** Aceeași adresă (destinatar + loc), indiferent de majuscule / spații. */
export function sameAddress(a = {}, b = {}) {
  return ["firstName", "lastName", "phone", "county", "city", "street", "postalCode"].every((k) => norm(a[k]) === norm(b[k]));
}

/** Adresa din formular corespunde unei adrese salvate? (atunci nu oferim salvarea) */
export function findMatchingAddress(addresses = [], shipping = {}) {
  return (addresses || []).find((a) => sameAddress(a, shipping)) || null;
}

/** „Str. Lalelelor 7, Cluj-Napoca, Cluj” - județul afișat cu numele, nu cu codul. */
export function addressLine(address, countyName = "") {
  if (!address) return "";
  return [address.street, address.city, countyName || address.county].filter(Boolean).join(", ");
}

export function recipientLine(address) {
  if (!address) return "";
  return [`${address.firstName || ""} ${address.lastName || ""}`.trim(), address.phone].filter(Boolean).join(" · ");
}

/** Ultimul punct folosit, pe metodă: { LOCKER: {status, location?, previous?}, PUDO: … } */
export function lastOohByMethod(items = []) {
  const out = {};
  for (const item of items || []) {
    if (item && (item.method === "LOCKER" || item.method === "PUDO")) out[item.method] = item;
  }
  return out;
}
